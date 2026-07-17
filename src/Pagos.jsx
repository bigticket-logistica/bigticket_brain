import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { descargarExcelMultihoja, fechaHoyOperativa, fechaOperativaOffset, sb } from "./shared";

function BotonDescargarExcel({ onClick, disabled, label = "Descargar Excel" }) {
  return (
    <button onClick={onClick} disabled={disabled} className="btn-blue"
      style={{
        padding: "7px 14px", fontSize: 11, fontWeight: 600,
        background: "#1a3a6b", color: "#fff", border: "none",
        borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, fontFamily: "Geist, sans-serif",
        whiteSpace: "nowrap",
      }}>
      📥 {label}
    </button>
  );
}

function TorreTresPilares() {
  // ─── Estado ───
  // Calcula "ayer" en huso horario LOCAL del navegador (no UTC).
  // toISOString() convierte a UTC y puede saltar 1 día cuando estás en MX (UTC-6) a la tarde.
  const ayer = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  })();

  const [fecha, setFecha] = useState(ayer);
  const [scFiltro, setScFiltro] = useState("");
  const [resumen, setResumen] = useState(null);
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [bucketSeleccionado, setBucketSeleccionado] = useState(null);
  const [excelDesde, setExcelDesde] = useState(ayer);
  const [excelHasta, setExcelHasta] = useState(ayer);
  const [excelBusy, setExcelBusy] = useState(false);
  // ▶ Historial expandido por travel_id
  const [travelExpandido, setTravelExpandido] = useState(null);
  const [historial, setHistorial] = useState({});

  // ─── Carga ───
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [resumenRes, filasRes] = await Promise.all([
          sb.rpc("get_torre_resumen", { fecha_desde: fecha, fecha_hasta: fecha }),
          sb.rpc("get_torre_3_pilares", {
            fecha_desde: fecha,
            fecha_hasta: fecha,
            sc_filtro: scFiltro || null,
          }),
        ]);
        if (!alive) return;
        if (resumenRes.error) throw resumenRes.error;
        if (filasRes.error) throw filasRes.error;
        setResumen(resumenRes.data);
        setFilas(filasRes.data || []);
      } catch (e) {
        if (alive) setError(e.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [fecha, scFiltro, refreshKey]);

  // ▶ Toggle expandir + cargar historial del travel
  const toggleHistorial = useCallback(async (travelId) => {
    if (travelExpandido === travelId) {
      setTravelExpandido(null);
      return;
    }
    setTravelExpandido(travelId);
    if (historial[travelId]?.data) return;
    setHistorial(prev => ({ ...prev, [travelId]: { loading: true } }));
    try {
      const { data, error } = await sb.rpc("get_historial_travel", {
        p_travel_id: travelId,
        p_fecha: fecha,
      });
      if (error) throw error;
      setHistorial(prev => ({ ...prev, [travelId]: { loading: false, data: data || [] } }));
    } catch (e) {
      setHistorial(prev => ({ ...prev, [travelId]: { loading: false, error: e.message || String(e) } }));
    }
  }, [travelExpandido, historial, fecha]);

  // ─── Definición de buckets (orden + colores + descripciones) ───
  const BUCKETS = [
    { id: "1_OK",                          label: "Operó OK",           color: "#047857", bg: "#d1fae5",  desc: "Cadena completa cumplida" },
    { id: "2A_RF1_VENCIDO",             label: "🚨 RF1 vencido",      color: "#b91c1c", bg: "#fee2e2", desc: "Aceptado sin asignar · lockDate venció · multa MELI" },
    { id: "2B_RF1_EVITADO",             label: "✅ RF1 evitado",          color: "#047857", bg: "#d1fae5", desc: "Draft AM rescatado a done PM · victoria operativa" },
    { id: "3_RF2_NO_SHOW",                 label: "🚨 RF2 NO SHOW",     color: "#b91c1c", bg: "#fee2e2",  desc: "Driver no salió · BT cobra al transporte" },
    { id: "5_CANCEL_MELI_POST_ASIGNACION", label: "Cancel MELI post",   color: "#b45309", bg: "#fef3c7",  desc: "Asignado y luego cancelado por MELI" },
    { id: "6_CAMBIO_PLACA",                label: "Cambio de placa",    color: "#7c2d12", bg: "#fed7aa",  desc: "Operó con placa distinta" },
    { id: "7_PARCIAL",                     label: "Parcial",            color: "#7c2d12", bg: "#fed7aa",  desc: "Operó solo algunas placas asignadas" },
    { id: "8_PENDING_ROSTEREADO",          label: "Pending rostereado", color: "#9333ea", bg: "#f3e8ff",  desc: "MELI rostereó sin BT aceptar · revisar" },
    { id: "9_REJECTED_LIMPIO",             label: "Rechazado limpio",   color: "#475569", bg: "#f1f5f9",  desc: "BT rechazó · sin penalidad" },
    { id: "10_PENDING_SIN_RESPUESTA",      label: "⚠️ Pending sin respuesta", color: "#b45309", bg: "#fef3c7", desc: "BT no aceptó ni rechazó a tiempo" },
    { id: "97_FALTA_SCRAPER_PM",           label: "⚠️ Falta scraper PM", color: "#9f1239", bg: "#ffe4e6",  desc: "No se capturó rostering PM · alerta crítica" },
    { id: "99_OTRO",                       label: "Otro",               color: "#475569", bg: "#f1f5f9",  desc: "Caso no clasificado · investigar" },
  ];

  // ─── KPIs derivados ───
  const kpis = useMemo(() => {
    if (!resumen?.totales) return null;
    const t = resumen.totales;
    const total = t.total_travels || 0;
    const aceptadas = t.pilar1_aceptadas || 0;
    const asignadas = t.pilar2_asignadas || 0;
    const ok = t.ok || 0;
    return {
      total, aceptadas, asignadas, ok,
      rf1: t.rf1 || 0,
      rf2: t.rf2_noshow || 0,
      cancelTardia: t.cancel_meli_tardia || 0,
      cancelPost: t.cancel_meli_post || 0,
      cambioPlaca: t.cambio_placa || 0,
      parcial: t.parcial || 0,
      pendingRost: t.pending_rostereado || 0,
      rejected: t.rejected || 0,
      otro: t.otro || 0,
      sddOk: t.sdd_ok || 0,
      variableOk: t.variable_ok || 0,
      pctAsignacion: aceptadas > 0 ? (asignadas / aceptadas * 100) : null,
      pctOperacion: asignadas > 0 ? (ok / asignadas * 100) : null,
      pctCadena: aceptadas > 0 ? (ok / aceptadas * 100) : null,
    };
  }, [resumen]);

  // ─── Conteos por bucket ───
  const conteos = useMemo(() => {
    const m = {};
    BUCKETS.forEach(b => m[b.id] = 0);
    filas.forEach(f => {
      if (m[f.bucket] !== undefined) m[f.bucket]++;
      else m["99_OTRO"]++;
    });
    return m;
  }, [filas]);

  // ─── Filas filtradas por bucket clickeado ───
  const filasMostrar = useMemo(() => {
    if (!bucketSeleccionado) return filas.filter(f => f.bucket !== "9_REJECTED_LIMPIO");
    return filas.filter(f => f.bucket === bucketSeleccionado);
  }, [filas, bucketSeleccionado]);

  // ─── SCs únicas para el selector ───
  const scsDisponibles = useMemo(() => {
    const s = new Set();
    filas.forEach(f => { if (f.sc) s.add(f.sc); });
    return [...s].sort();
  }, [filas]);

  // ─── Color para % ───
  const colorPct = (pct) => {
    if (pct === null || pct === undefined) return "#94a3b8";
    if (pct >= 95) return "#047857";
    if (pct >= 85) return "#0891b2";
    if (pct >= 70) return "#ca8a04";
    return "#b91c1c";
  };

  // ─── Descarga Excel ───
  const descargarExcel = async () => {
    if (!excelDesde || !excelHasta) { alert("Elegí el rango de fechas para el Excel."); return; }
    const desde = excelDesde <= excelHasta ? excelDesde : excelHasta;
    const hasta = excelHasta >= excelDesde ? excelHasta : excelDesde;
    setExcelBusy(true);
    try {
      // Traer TODO el rango desde las RPC (no solo el día en pantalla)
      const [resR, filR] = await Promise.all([
        sb.rpc("get_torre_resumen", { fecha_desde: desde, fecha_hasta: hasta }),
        sb.rpc("get_torre_3_pilares", { fecha_desde: desde, fecha_hasta: hasta, sc_filtro: scFiltro || null }),
      ]);
      if (resR.error) throw resR.error;
      if (filR.error) throw filR.error;
      const filasR = filR.data || [];
      const resumenR = resR.data;
      const headers = [
        "Fecha", "SC", "Vehículo", "Flota", "Bucket",
        "Travel ID", "Request ID",
        "Travel Status", "Assignment Status", "Categoría P3",
        "Driver", "CURP", "Placa",
        "Driver AM", "Placa AM", "Cambio intradía",
        "Placas planif", "Placas operadas",
        "Cargados", "Entregados", "% Entrega",
        "Diagnóstico P3",
      ];
      const datos = [headers, ...filasR.map(f => [
        f.fecha, f.sc || "", f.vehiculo || "", f.flota || "", f.bucket,
        f.travel_id, f.request_id || "",
        f.travel_status || "", f.assignment_status || "", f.categoria_p3 || "",
        f.driver_name || "", f.driver_curp || "", f.vehicle_plate || "",
        f.driver_id_am || "", f.vehicle_plate_am || "", f.cambio_intradia || "",
        f.placas_planificadas || 0, f.placas_operadas || 0,
        f.total_cargados || 0, f.total_entregados || 0, f.pct_entregado || 0,
        f.diagnostico_p3 || "",
      ])];
      const porSC = [["SC", "OK", "RF1", "RF2 NoShow", "Cancel MELI", "Pending Rost", "Total"]];
      (resumenR?.por_sc || []).forEach(x => {
        porSC.push([x.sc, x.ok, x.rf1_vencido || 0, x.rf2, x.cancel_meli, x.pending_rost, x.total]);
      });
      await descargarExcelMultihoja(
        [
          { nombre: "Detalle", datos },
          { nombre: "Por SC", datos: porSC },
        ],
        `torre_3pilares_${desde === hasta ? desde : desde + "_a_" + hasta}`
      );
    } catch (e) {
      alert("Error al generar el Excel: " + (e.message || e));
    } finally {
      setExcelBusy(false);
    }
  };

  // ─── Formato fecha legible ───
  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const dias = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  let fechaTexto = fecha;
  if (fecha) {
    const [y, m, d] = fecha.split("-").map(Number);
    const fobj = new Date(y, m - 1, d);
    fechaTexto = `${dias[fobj.getDay()]} ${d} de ${meses[m - 1]} de ${y}`;
  }

  if (loading) {
    return <div className="pg" style={{ padding: 60, textAlign: "center", color: "#888" }}>Cargando Torre de Control de Pagos…</div>;
  }
  if (error) {
    return <div className="pg" style={{ padding: 40, color: "#c0392b" }}>Error: {error}</div>;
  }

  return (
    <div className="pg">

      {/* ─── HEADER ─── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">Torre de Control de Pagos</div>
          <div className="sec-sub">
            3 Pilares · Compromiso MELI × Rostering × Operación · {fechaTexto}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Fecha</label>
          <input
            type="date"
            value={fecha}
            max={ayer}
            onChange={(e) => { setFecha(e.target.value); setBucketSeleccionado(null); }}
            style={{
              padding: "6px 10px", fontSize: 12,
              border: "1px solid #e4e7ec", borderRadius: 6,
              fontFamily: "'Geist', sans-serif",
            }}
          />
          <select
            value={scFiltro}
            onChange={(e) => { setScFiltro(e.target.value); setBucketSeleccionado(null); }}
            style={{
              padding: "6px 10px", fontSize: 12,
              border: "1px solid #e4e7ec", borderRadius: 6,
              fontFamily: "'Geist', sans-serif", minWidth: 120,
            }}
          >
            <option value="">Todas las SCs</option>
            {scsDisponibles.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            style={{
              padding: "6px 12px", fontSize: 12, fontWeight: 600,
              background: "#fff", color: "#1a3a6b",
              border: "1px solid #e4e7ec", borderRadius: 6, cursor: "pointer",
              fontFamily: "'Geist', sans-serif",
            }}
            title="Recargar"
          >↻ Refrescar</button>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Excel · rango:</span>
          <input type="date" value={excelDesde} onChange={e => setExcelDesde(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid #e4e7ec", fontSize: 12, color: "#1a1a1a" }} />
          <span style={{ fontSize: 11, color: "#888" }}>a</span>
          <input type="date" value={excelHasta} onChange={e => setExcelHasta(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid #e4e7ec", fontSize: 12, color: "#1a1a1a" }} />
          <button onClick={descargarExcel} disabled={excelBusy}
            style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid #16a34a", background: excelBusy ? "#9ca3af" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: excelBusy ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Geist', sans-serif" }}>
            {excelBusy ? "⏳ Generando..." : "📥 Descargar Excel"}
          </button>
        </div>
      </div>

      {/* ─── 3 PILARES · TARJETAS GRANDES ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        {/* Pilar 1 */}
        <div className="form-card" style={{ marginBottom: 0, padding: 20, borderTop: "4px solid #1a3a6b" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Pilar 1 · Compromiso
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1, marginBottom: 8, color: "#1a3a6b" }}>
            {kpis?.aceptadas ?? 0}
          </div>
          <div style={{ fontSize: 12, color: "#334155", marginBottom: 4 }}>
            Aceptadas por BT
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
            De {kpis?.total ?? 0} travels totales · MELI ofreció + BT respondió
          </div>
        </div>

        {/* Pilar 2 */}
        <div className="form-card" style={{ marginBottom: 0, padding: 20, borderTop: `4px solid ${colorPct(kpis?.pctAsignacion)}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Pilar 2 · Rostering
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1, color: "#1a3a6b" }}>
              {kpis?.asignadas ?? 0}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: colorPct(kpis?.pctAsignacion) }}>
              {kpis?.pctAsignacion !== null ? `${kpis.pctAsignacion.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#334155", marginBottom: 4 }}>
            Asignadas (done con driver+placa)
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
            Cobertura del compromiso · captura AM rostering MELI
          </div>
        </div>

        {/* Pilar 3 */}
        <div className="form-card" style={{ marginBottom: 0, padding: 20, borderTop: `4px solid ${colorPct(kpis?.pctOperacion)}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Pilar 3 · Ejecución
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1, color: "#1a3a6b" }}>
              {kpis?.ok ?? 0}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: colorPct(kpis?.pctOperacion) }}>
              {kpis?.pctOperacion !== null ? `${kpis.pctOperacion.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#334155", marginBottom: 4 }}>
            Operaron OK
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
            Cadena completa · driver+placa salió y entregó · SDD: {kpis?.sddOk ?? 0} · Var: {kpis?.variableOk ?? 0}
          </div>
        </div>
      </div>

      {/* ─── % CADENA TOTAL ─── */}
      <div className="form-card" style={{
        marginBottom: 16, padding: 16,
        background: "linear-gradient(135deg, #1a3a6b 0%, #0f2647 100%)",
        color: "#fff",
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 20, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.8, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              % Cadena cumplida
            </div>
            <div style={{ fontSize: 42, fontWeight: 700, lineHeight: 1 }}>
              {kpis?.pctCadena !== null ? `${kpis.pctCadena.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.6 }}>
            De {kpis?.aceptadas ?? 0} compromisos, {kpis?.ok ?? 0} se cumplieron en los 3 Pilares.
            <br/>
            <span style={{ opacity: 0.7 }}>Fórmula: Operadas OK ÷ Aceptadas BT</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2 }}>Red flags</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{(kpis?.rf1 ?? 0) + (kpis?.rf2 ?? 0)}</div>
            <div style={{ fontSize: 10, opacity: 0.8 }}>RF1: {kpis?.rf1 ?? 0} · RF2: {kpis?.rf2 ?? 0}</div>
          </div>
        </div>
      </div>

      {/* ─── 9 BUCKETS · GRID ─── */}
      <div style={{ marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="form-title" style={{ marginBottom: 0 }}>Distribución por bucket</div>
        {bucketSeleccionado && (
          <button
            onClick={() => setBucketSeleccionado(null)}
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600,
              background: "#fff", color: "#1a3a6b",
              border: "1px solid #e4e7ec", borderRadius: 6, cursor: "pointer",
            }}
          >× Limpiar filtro</button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 20 }}>
        {BUCKETS.map(b => {
          const n = conteos[b.id] || 0;
          const seleccionado = bucketSeleccionado === b.id;
          return (
            <div
              key={b.id}
              onClick={() => setBucketSeleccionado(seleccionado ? null : b.id)}
              style={{
                background: n > 0 ? b.bg : "#fafafa",
                border: seleccionado ? `2px solid ${b.color}` : `0.5px solid #e4e7ec`,
                borderRadius: 12, padding: 12, cursor: "pointer",
                opacity: n === 0 ? 0.5 : 1,
                transition: "all 0.15s",
                position: "relative",
              }}
              title={b.longDesc || b.desc}
            >
              {/* ⓘ ícono de info en esquina superior derecha */}
              <span
                style={{
                  position: "absolute", top: 6, right: 8,
                  fontSize: 13, color: b.color, opacity: 0.55, fontWeight: 600,
                  cursor: "help",
                }}
                title={b.longDesc || b.desc}
              >ⓘ</span>
              <div style={{ fontSize: 11, fontWeight: 700, color: b.color, marginBottom: 4, lineHeight: 1.3, paddingRight: 20 }}>
                {b.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: b.color, lineHeight: 1 }}>
                {n}
              </div>
              <div style={{ fontSize: 9, color: "#64748b", marginTop: 4, lineHeight: 1.3 }}>
                {b.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── RANKING POR SC ─── */}
      <div className="form-card" style={{ marginBottom: 20 }}>
        <div className="form-title" style={{ marginBottom: 4 }}>Ranking por Service Center</div>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>
          Click en una SC para filtrar el detalle abajo · pasa el cursor sobre cada columna para ver su definición
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e4e7ec" }}>
                <th style={{ padding: "8px 6px", textAlign: "left",   fontWeight: 600, color: "#64748b" }}>SC</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#047857" }}>OK</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#b91c1c" }}>RF1</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#b91c1c" }}>RF2 NoShow</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#b45309" }}>Cancel MELI</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#7c2d12" }}>Cambio placa</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#7c2d12" }}>Parcial</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#9333ea" }}>Pending Rost</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#1e40af" }}>Rech SDD</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#475569" }}>Rech SPOT</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 700, color: "#1a3a6b", borderLeft: "2px solid #e4e7ec" }}>Total</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#0891b2", borderLeft: "2px dashed #cbd5e1" }} title="Cambios entre primera y última captura del día · métrica aparte, no suma al total">ℹ Cambio intradía</th>
              </tr>
            </thead>
            <tbody>
              {(resumen?.por_sc || []).map(s => (
                <tr
                  key={s.sc}
                  onClick={() => { setScFiltro(s.sc === scFiltro ? "" : s.sc); setBucketSeleccionado(null); }}
                  style={{
                    borderBottom: "0.5px solid #f1f5f9",
                    background: s.sc === scFiltro ? "#fef3c7" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <td style={{ padding: "6px 6px", fontWeight: 600 }}>{s.sc}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", color: s.ok > 0 ? "#047857" : "#94a3b8" }} title="Rutas que cumplieron la cadena completa: aceptado + rosterizado + operado">{s.ok}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", color: (s.rf1_vencido || 0) > 0 ? "#b91c1c" : "#94a3b8", fontWeight: (s.rf1_vencido || 0) > 0 ? 700 : 400 }} title="Aceptado por BT pero NO rosterizado a tiempo · multa MELI">{s.rf1_vencido || 0}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", color: s.rf2 > 0 ? "#b91c1c" : "#94a3b8", fontWeight: s.rf2 > 0 ? 700 : 400 }} title="Rosterizado completo pero driver NO salió · BT cobra al transporte">{s.rf2}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", color: s.cancel_meli > 0 ? "#b45309" : "#94a3b8" }} title="MELI canceló la ruta DESPUÉS de que BT la rosterizó · no es culpa BT">{s.cancel_meli}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", color: (s.cambio_placa || 0) > 0 ? "#7c2d12" : "#94a3b8" }} title="Operó con placa distinta a la rosterizada">{s.cambio_placa || 0}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", color: (s.parcial || 0) > 0 ? "#7c2d12" : "#94a3b8" }} title="Operó pero entregó solo parte de los envíos">{s.parcial || 0}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", color: s.pending_rost > 0 ? "#9333ea" : "#94a3b8", fontWeight: s.pending_rost > 0 ? 700 : 400 }} title="MELI rosterió la ruta pero BT nunca confirmó aceptación">{s.pending_rost}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", color: (s.rejected_sdd || 0) > 0 ? "#1e40af" : "#94a3b8", fontWeight: (s.rejected_sdd || 0) > 0 ? 600 : 400 }} title="Rechazos SDD limpios (BT rechazó antes del plazo)">{s.rejected_sdd || 0}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", color: (s.rejected_spot || 0) > 0 ? "#475569" : "#94a3b8" }} title="Rechazos Variable/SPOT limpios">{s.rejected_spot || 0}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", fontWeight: 700, color: "#1a3a6b", borderLeft: "2px solid #e4e7ec" }}>{s.total}</td>
                  <td style={{ padding: "6px 6px", textAlign: "center", color: (s.cambios_intradia || 0) > 0 ? "#0891b2" : "#94a3b8", fontWeight: (s.cambios_intradia || 0) > 0 ? 600 : 400, borderLeft: "2px dashed #cbd5e1", fontStyle: "italic" }} title="Métrica aparte: no suma al total">{s.cambios_intradia || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── DETALLE ─── */}
      <div className="form-card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="form-title" style={{ marginBottom: 4 }}>
              Detalle
              {bucketSeleccionado && (
                <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b", marginLeft: 8 }}>
                  · {BUCKETS.find(b => b.id === bucketSeleccionado)?.label}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              {filasMostrar.length} filas
              {!bucketSeleccionado && " (excluyendo Rechazados limpios)"}
              {scFiltro && ` · filtro: ${scFiltro}`}
            </div>
          </div>
          {/* Filtro SC propio del detalle */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Filtrar SC:</label>
            <select
              value={scFiltro || ""}
              onChange={(e) => { setScFiltro(e.target.value); setBucketSeleccionado(null); }}
              style={{
                padding: "5px 10px", fontSize: 12, borderRadius: 6,
                border: "1px solid #cbd5e1", background: "#fff",
                color: "#1a3a6b", fontWeight: 600, cursor: "pointer", minWidth: 110
              }}>
              <option value="">Todas las SCs</option>
              {(resumen?.por_sc || []).map(s => (
                <option key={s.sc} value={s.sc}>{s.sc}</option>
              ))}
            </select>
            {scFiltro && (
              <button
                onClick={() => { setScFiltro(""); setBucketSeleccionado(null); }}
                style={{
                  padding: "5px 10px", fontSize: 11, borderRadius: 6,
                  border: "1px solid #b91c1c", background: "#fff",
                  color: "#b91c1c", fontWeight: 600, cursor: "pointer"
                }}>
                ✕ Limpiar
              </button>
            )}
          </div>
        </div>
        <div style={{ overflowX: "auto", maxHeight: 480, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ position: "sticky", top: 0, background: "#fff", boxShadow: "0 1px 0 #e4e7ec" }}>
              <tr>
                <th style={{ padding: "8px 4px", textAlign: "center", fontWeight: 600, color: "#64748b", width: 24 }} title="Click en cada fila para ver historial"></th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Bucket</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>SC</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Vehículo</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Flota</th>
                <th style={{ padding: "8px 6px", textAlign: "right", fontWeight: 600, color: "#64748b" }}>Travel ID</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Driver</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Placa</th>
                <th style={{ padding: "8px 6px", textAlign: "right", fontWeight: 600, color: "#64748b" }}>% Entrega</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#0891b2" }} title="Cambio entre AM y PM">Cambio AM→PM</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Diagnóstico</th>
              </tr>
            </thead>
            <tbody>
              {filasMostrar.length === 0 && (
                <tr><td colSpan={11} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Sin filas que mostrar</td></tr>
              )}
              {filasMostrar.map((f, i) => {
                const b = BUCKETS.find(bb => bb.id === f.bucket);
                const isExpanded = travelExpandido === f.travel_id;
                const hist = historial[f.travel_id];
                return (
                  <Fragment key={`${f.travel_id}-${i}`}>
                    <tr style={{
                      borderBottom: "0.5px solid #f1f5f9",
                      background: isExpanded ? "#f0f9ff" : "transparent",
                      cursor: "pointer"
                    }} onClick={() => toggleHistorial(f.travel_id)}>
                      <td style={{ padding: "6px 4px", textAlign: "center", color: "#64748b", fontSize: 11, userSelect: "none" }}>
                        {isExpanded ? "▼" : "▶"}
                      </td>
                      <td style={{ padding: "6px 6px" }}>
                        <span style={{
                          background: b?.bg || "#f1f5f9", color: b?.color || "#475569",
                          padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}>
                          {b?.label || f.bucket}
                        </span>
                      </td>
                      <td style={{ padding: "6px 6px", fontWeight: 600 }}>{f.sc || "—"}</td>
                      <td style={{ padding: "6px 6px", color: "#475569" }}>{f.vehiculo || "—"}</td>
                      <td style={{ padding: "6px 6px" }}>
                        {f.flota && (
                          <span style={{
                            background: f.flota === "SDD" ? "#dbeafe" : "#f1f5f9",
                            color: f.flota === "SDD" ? "#1e40af" : "#475569",
                            padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                          }}>{f.flota}</span>
                        )}
                      </td>
                      <td style={{ padding: "6px 6px", textAlign: "right", fontFamily: "monospace", color: "#64748b" }}>{f.travel_id}</td>
                      <td style={{ padding: "6px 6px", color: "#334155" }}>{f.driver_name || "—"}</td>
                      <td style={{ padding: "6px 6px", fontFamily: "monospace", color: "#475569" }}>{f.vehicle_plate || "—"}</td>
                      <td style={{ padding: "6px 6px", textAlign: "right", color: "#475569" }}>
                        {f.pct_entregado !== null && f.pct_entregado !== undefined ? `${Number(f.pct_entregado).toFixed(1)}%` : "—"}
                      </td>
                      <td style={{ padding: "6px 6px", fontSize: 10 }}>{f.cambio_intradia ? (
                        <span style={{ background: "#cffafe", color: "#155e75", padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600 }}>{f.cambio_intradia}</span>
                      ) : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                      <td style={{ padding: "6px 6px", color: "#64748b", fontSize: 10 }}>{f.diagnostico_p3 || "—"}</td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={11} style={{ padding: 0, background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                          <div style={{ padding: "12px 20px" }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#1a3a6b", marginBottom: 8 }}>
                              🕐 Historial del travel {f.travel_id} · {f.sc} · {fecha}
                            </div>
                            {hist?.loading && (
                              <div style={{ fontSize: 11, color: "#64748b", padding: 8 }}>Cargando historial…</div>
                            )}
                            {hist?.error && (
                              <div style={{ fontSize: 11, color: "#b91c1c", padding: 8 }}>Error: {hist.error}</div>
                            )}
                            {hist?.data && hist.data.length === 0 && (
                              <div style={{
                                padding: 12,
                                background: "#fef9c3",
                                border: "1px solid #fde68a",
                                borderRadius: 8,
                                fontSize: 11,
                                color: "#78350f",
                                lineHeight: 1.5,
                              }}>
                                <div style={{ fontWeight: 700, marginBottom: 6, color: "#92400e" }}>
                                  ⚠️ Sin historial de rostering
                                </div>
                                <div style={{ marginBottom: 6 }}>
                                  Este travel NO aparece en <code style={{ background: "#fff", padding: "1px 4px", borderRadius: 3, fontSize: 10 }}>meli_rostering_planificado</code> en ninguna de las 18 capturas del día.
                                </div>
                                <div style={{ marginBottom: 6 }}>
                                  <strong>Interpretación:</strong> BT aceptó el travel (P1) pero NUNCA completó el rostering. No se asignó driver ni placa.
                                </div>
                                <div style={{ fontSize: 10, color: "#78350f" }}>
                                  Datos disponibles:
                                  <ul style={{ marginTop: 4, marginBottom: 0, paddingLeft: 18 }}>
                                    <li>Travel ID: <strong>{f.travel_id}</strong></li>
                                    <li>SC: <strong>{f.sc || "—"}</strong></li>
                                    <li>Vehículo: <strong>{f.vehiculo || "—"}</strong></li>
                                    <li>Flota: <strong>{f.flota || "—"}</strong></li>
                                    <li>Estado P1: <strong>{f.travel_status || "—"}</strong></li>
                                    {f.lockdate_str && <li>lockDate: <strong>{f.lockdate_str}</strong></li>}
                                  </ul>
                                </div>
                                {f.bucket === "2A_RF1_VENCIDO" && (
                                  <div style={{ marginTop: 8, padding: 6, background: "#fee2e2", borderRadius: 4, color: "#991b1b", fontWeight: 600 }}>
                                    🚨 RF1 vencido = multa MELI segura por no completar el rostering antes del lockDate.
                                  </div>
                                )}
                                {f.bucket === "4_CANCEL_MELI_PRE_ASIGNACION" && (
                                  <div style={{ marginTop: 8, padding: 6, background: "#f1f5f9", borderRadius: 4, color: "#475569", fontWeight: 600 }}>
                                    ⚪ MELI canceló antes de que BT asignara. Sin impacto operativo.
                                  </div>
                                )}
                              </div>
                            )}
                            {hist?.data && hist.data.length > 0 && (
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                                  <thead>
                                    <tr style={{ borderBottom: "1px solid #cbd5e1", background: "#fff" }}>
                                      <th style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Captura</th>
                                      <th style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Hora MX</th>
                                      <th style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Driver</th>
                                      <th style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Placa</th>
                                      <th style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Assign</th>
                                      <th style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Travel St</th>
                                      <th style={{ padding: "6px 6px", textAlign: "center", fontWeight: 600, color: "#64748b" }}>Lock</th>
                                      <th style={{ padding: "6px 6px", textAlign: "right", fontWeight: 600, color: "#64748b" }} title="Minutos hasta lockDate">Min lock</th>
                                      <th style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#0891b2" }}>Cambios</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {hist.data.map((h, hi) => (
                                      <tr key={hi} style={{
                                        borderBottom: "0.5px solid #e4e7ec",
                                        background: h.cambio_vs_anterior ? "#fef9c3" : "transparent"
                                      }}>
                                        <td style={{ padding: "4px 6px", fontWeight: 600, color: "#1a3a6b" }}>{h.captura}</td>
                                        <td style={{ padding: "4px 6px", fontFamily: "monospace", color: "#64748b" }}>{h.hora_mx}</td>
                                        <td style={{ padding: "4px 6px", color: "#334155" }}>{h.driver_name || "—"}</td>
                                        <td style={{ padding: "4px 6px", fontFamily: "monospace", color: "#475569" }}>{h.vehicle_plate || "—"}</td>
                                        <td style={{ padding: "4px 6px" }}>
                                          {h.assignment_status === "done" && <span style={{ background: "#d1fae5", color: "#047857", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>done</span>}
                                          {h.assignment_status === "draft" && <span style={{ background: "#fef3c7", color: "#b45309", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>draft</span>}
                                          {!h.assignment_status && <span style={{ color: "#cbd5e1" }}>—</span>}
                                        </td>
                                        <td style={{ padding: "4px 6px" }}>
                                          {h.travel_status === "finished" && <span style={{ background: "#dbeafe", color: "#1e40af", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>finished</span>}
                                          {h.travel_status === "started" && <span style={{ background: "#d1fae5", color: "#047857", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>started</span>}
                                          {h.travel_status === "created" && <span style={{ background: "#f1f5f9", color: "#475569", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>created</span>}
                                          {h.travel_status === "canceled" && <span style={{ background: "#fee2e2", color: "#b91c1c", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>canceled</span>}
                                          {!h.travel_status && <span style={{ color: "#cbd5e1" }}>—</span>}
                                        </td>
                                        <td style={{ padding: "4px 6px", textAlign: "center" }}>
                                          {h.locked ? "🔒" : ""}
                                        </td>
                                        <td style={{
                                          padding: "4px 6px", textAlign: "right", fontFamily: "monospace",
                                          color: h.min_a_lockdate < 0 ? "#b91c1c" : h.min_a_lockdate < 60 ? "#c2410c" : "#64748b",
                                          fontWeight: h.min_a_lockdate < 60 ? 600 : 400
                                        }}>
                                          {h.min_a_lockdate !== null && h.min_a_lockdate !== undefined ? `${h.min_a_lockdate}'` : "—"}
                                        </td>
                                        <td style={{ padding: "4px 6px", color: "#1a3a6b", fontWeight: 600, fontSize: 10 }}>
                                          {h.cambio_vs_anterior || ""}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── FOOTER · fuente ─── */}
      <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", marginTop: 4 }}>
        Fuente: vw_torre_3_pilares · meli_travel_requests × meli_rostering_planificado × vw_rostering_vs_operativo
      </div>

    </div>
  );
}

const BUCKETS_LABELS = {
  "1_OK": "OK",
  "2A_RF1_VENCIDO": "RF1 vencido",
  "2B_RF1_EVITADO": "RF1 evitado",
  "3_RF2_NO_SHOW": "RF2 No Show",
  "5_CANCEL_MELI_POST_ASIGNACION": "Cancel MELI",
  "4_CANCEL_MELI_PRE_ASIGNACION": "Cancel MELI pre",
  "6_CAMBIO_PLACA": "Cambio placa",
  "7_PARCIAL": "Parcial",
  "8_PENDING_ROSTEREADO": "Pending Rost",
  "9_REJECTED_LIMPIO": "Rechazado",
  "10_PENDING_SIN_RESPUESTA": "Pending sin respuesta",
  "97_FALTA_SCRAPER_PM": "Falta scraper PM",
  "99_OTRO": "Otro",
};

function colorBucket(bucket) {
  if (!bucket) return "#64748b";
  if (bucket.includes("OK")) return "#047857";
  if (bucket.includes("NO_SHOW") || bucket.includes("RF2")) return "#b91c1c";
  if (bucket.includes("CANCEL")) return "#b45309";
  if (bucket.includes("CAMBIO") || bucket.includes("PARCIAL")) return "#7c2d12";
  if (bucket.includes("PENDING")) return "#9333ea";
  if (bucket.includes("REJECTED")) return "#475569";
  return "#64748b";
}

function TorreControlSC({ scId, fecha }) {
  const [resumen, setResumen] = useState(null);
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState(false);          // colapsado por defecto
  const [bucketSel, setBucketSel] = useState(null);       // chip seleccionado para filtrar

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [resR, filR] = await Promise.all([
          sb.rpc("get_torre_resumen", { fecha_desde: fecha, fecha_hasta: fecha }),
          sb.rpc("get_torre_3_pilares", { fecha_desde: fecha, fecha_hasta: fecha, sc_filtro: scId }),
        ]);
        if (cancel) return;
        const porSc = (resR.data?.por_sc || []).find((x) => x.sc === scId) || null;
        setResumen(porSc);
        setFilas(filR.data || []);
      } catch (e) {
        console.error("Error torre SC:", e);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [scId, fecha]);

  if (loading) return <div style={{ fontSize: 12, color: "#9ca3af", padding: 8 }}>Cargando torre de control…</div>;
  if (!resumen && filas.length === 0) return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>📊 Torre de Control · {scId}</div>
      <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>Sin datos de torre para este día.</div>
    </div>
  );

  // Conteo real por bucket desde las filas (más confiable que el resumen)
  const cuentaBucket = (bucketsArr) => filas.filter((f) => bucketsArr.includes(f.bucket)).length;
  const cuentaIntradia = filas.filter((f) => f.cambio_intradia && String(f.cambio_intradia).trim() !== "").length;

  // Cada chip mapea a uno o más buckets reales (para filtrar el detalle al clickear)
  const chips = filas.length > 0 ? [
    { id: "ok",        label: "OK",            color: "#047857", buckets: ["1_OK"] },
    { id: "rf1",       label: "RF1 venc",      color: "#b91c1c", buckets: ["2A_RF1_VENCIDO"] },
    { id: "rf1ev",     label: "RF1 evitado",   color: "#047857", buckets: ["2B_RF1_EVITADO"] },
    { id: "rf2",       label: "RF2 NoShow",    color: "#b91c1c", buckets: ["3_RF2_NO_SHOW"] },
    { id: "cancel",    label: "Cancel MELI",   color: "#b45309", buckets: ["4_CANCEL_MELI_PRE_ASIGNACION", "5_CANCEL_MELI_POST_ASIGNACION"] },
    { id: "cambio",    label: "Cambio placa",  color: "#7c2d12", buckets: ["6_CAMBIO_PLACA"] },
    { id: "parcial",   label: "Parcial",       color: "#7c2d12", buckets: ["7_PARCIAL"] },
    { id: "pending",   label: "Pending Rost",  color: "#9333ea", buckets: ["8_PENDING_ROSTEREADO"] },
    { id: "rechazado", label: "Rechazado",     color: "#475569", buckets: ["9_REJECTED_LIMPIO"] },
    { id: "intradia",  label: "Cambios intradía", color: "#0891b2", buckets: null, esIntradia: true },
  ].map((c) => ({ ...c, val: c.esIntradia ? cuentaIntradia : cuentaBucket(c.buckets) })) : [];

  // Filas filtradas según el chip seleccionado
  const chipActivo = chips.find((c) => c.id === bucketSel);
  let filasMostrar = filas;
  if (chipActivo) {
    if (chipActivo.esIntradia) {
      filasMostrar = filas.filter((f) => f.cambio_intradia && String(f.cambio_intradia).trim() !== "");
    } else if (chipActivo.buckets) {
      filasMostrar = filas.filter((f) => chipActivo.buckets.includes(f.bucket));
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
      {/* Encabezado colapsable */}
      <button onClick={() => setAbierto((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 700, color: "#374151" }}>
        <span>{abierto ? "▼" : "▶"}</span>
        📊 Torre de Control · {scId}
        {filas.length > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af" }}>({filas.length} rutas)</span>}
      </button>

      {abierto && (
        <div style={{ marginTop: 8 }}>
          {/* Chips clickeables */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {chips.map((c) => {
              const sel = bucketSel === c.id;
              const clickable = (c.buckets || c.esIntradia) && c.val > 0;
              return (
                <span key={c.id}
                  onClick={() => { if (clickable) setBucketSel(sel ? null : c.id); }}
                  style={{
                    fontSize: 11, padding: "3px 9px", borderRadius: 5, fontWeight: 700,
                    cursor: clickable ? "pointer" : "default",
                    background: sel ? c.color : (c.val > 0 ? "#fff" : "#f8fafc"),
                    color: sel ? "#fff" : (c.val > 0 ? c.color : "#cbd5e1"),
                    border: `1px solid ${sel ? c.color : (c.val > 0 ? c.color + "44" : "#e5e7eb")}`,
                  }}>
                  {c.label}: {c.val}
                </span>
              );
            })}
            <span onClick={() => setBucketSel(null)}
              style={{ fontSize: 11, padding: "3px 9px", borderRadius: 5, fontWeight: 700, background: bucketSel ? "#e5e7eb" : "#1a3a6b", color: bucketSel ? "#374151" : "#fff", cursor: "pointer" }}
              title="Ver todas">
              Total: {filas.length}
            </span>
          </div>

          {/* Detalle ruta por ruta (filtrado por chip) */}
          <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>
            {chipActivo ? `Mostrando: ${chipActivo.label} (${filasMostrar.length})` : `Todas las rutas (${filasMostrar.length})`}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: "5px 6px", textAlign: "left" }}>Ruta</th>
                  <th style={{ padding: "5px 6px", textAlign: "left" }}>Estado</th>
                  <th style={{ padding: "5px 6px", textAlign: "left" }}>Chofer</th>
                  <th style={{ padding: "5px 6px", textAlign: "left" }}>Placa</th>
                  <th style={{ padding: "5px 6px", textAlign: "center" }}>Carg.</th>
                  <th style={{ padding: "5px 6px", textAlign: "center" }}>Entr.</th>
                  <th style={{ padding: "5px 6px", textAlign: "center" }}>%</th>
                  <th style={{ padding: "5px 6px", textAlign: "left" }}>Cambio intradía</th>
                </tr>
              </thead>
              <tbody>
                {filasMostrar.map((f, i) => (
                  <tr key={i} style={{ borderBottom: "0.5px solid #f1f5f9" }}>
                    <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>{f.travel_id}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 700, color: colorBucket(f.bucket) }}>
                      {BUCKETS_LABELS[f.bucket] || f.bucket}
                    </td>
                    <td style={{ padding: "4px 6px" }}>{f.driver_name || "—"}</td>
                    <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>{f.vehicle_plate || "—"}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}>{f.total_cargados || 0}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}>{f.total_entregados || 0}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}>{f.pct_entregado != null ? f.pct_entregado + "%" : "—"}</td>
                    <td style={{ padding: "4px 6px", color: f.cambio_intradia ? "#0891b2" : "#cbd5e1" }}>{f.cambio_intradia || "—"}</td>
                  </tr>
                ))}
                {filasMostrar.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 12, textAlign: "center", color: "#9ca3af" }}>Sin rutas en este estado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function semanaISOBrain(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date - firstThursday) / (7 * 24 * 60 * 60 * 1000));
}

function PatentesNuevasSC({ scId, decididoPor }) {
  const [placas, setPlacas] = useState([]); // {placa, chofer, empresa, guardando, guardada, error}
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState(false);

  const normPlaca = (p) => String(p || "").trim().toUpperCase().replace(/^(SDD|MLP|SPOT)-/, "");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const fecha = fechaOperativaOffset(0); // HOY MX
      const [snapR, flotaR] = await Promise.all([
        sb.from("logistic_ayudantes_snapshots")
          .select("id_ruta, placa, driver_name, hora_snapshot")
          .eq("service_center_id", scId).eq("fecha", fecha)
          .order("hora_snapshot", { ascending: false }),
        sb.from("vw_flota_panel")
          .select("placa, activo")
          .eq("service_center_id", scId).eq("activo", true),
      ]);
      const placasFlota = new Set((flotaR.data || []).map((f) => normPlaca(f.placa)));
      const choferPorPlaca = new Map();
      const operaron = new Set();
      const vistas = new Set();
      for (const r of snapR.data || []) {
        if (r.id_ruta && vistas.has(r.id_ruta)) continue;
        if (r.id_ruta) vistas.add(r.id_ruta);
        const norm = normPlaca(r.placa);
        if (!norm) continue;
        operaron.add(norm);
        if (r.driver_name && !choferPorPlaca.has(norm)) choferPorPlaca.set(norm, r.driver_name);
      }
      const nuevas = [...operaron]
        .filter((p) => !placasFlota.has(p))
        .map((p) => ({ placa: p, chofer: choferPorPlaca.get(p) || "", empresa: "", guardando: false, guardada: false, error: null }));
      setPlacas(nuevas);
    } catch (e) {
      console.error("Error patentes nuevas SC:", e);
      setPlacas([]);
    } finally {
      setLoading(false);
    }
  }, [scId]);

  useEffect(() => { cargar(); }, [cargar]);

  function actualizar(idx, campo, valor) {
    setPlacas((prev) => prev.map((p, i) => (i === idx ? { ...p, [campo]: valor } : p)));
  }

  async function registrar(idx) {
    const it = placas[idx];
    if (!it.empresa.trim()) { actualizar(idx, "error", "Indicá la empresa"); return; }
    actualizar(idx, "guardando", true);
    actualizar(idx, "error", null);
    try {
      const sem = semanaISOBrain(new Date());
      const payload = {
        placa: it.placa,
        service_center_id: scId,
        numero_semana: sem,
        empresa_transporte: it.empresa.trim(),
        flota_tipo: "PLANTA",
        responsable_carga: decididoPor || "Panel Consolidaciones",
        fecha_carga: new Date().toISOString(),
        es_compartida_entre_scs: false,
        tripulacion: [{ cargo: "CHOFER", nombre: it.chofer.trim(), curp: null }],
        activo: true,
      };
      const { error } = await sb.from("flota_vehiculos_bt")
        .upsert(payload, { onConflict: "placa,service_center_id,numero_semana" });
      if (error) throw error;
      actualizar(idx, "guardada", true);
    } catch (e) {
      console.error("Error registrando placa:", e);
      actualizar(idx, "error", e.message || "No se pudo guardar");
    } finally {
      actualizar(idx, "guardando", false);
    }
  }

  if (loading) return <div style={{ fontSize: 12, color: "#9ca3af", padding: 8 }}>Cargando patentes nuevas…</div>;
  if (placas.length === 0) return null; // sin patentes nuevas, no mostrar nada

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
      <button onClick={() => setAbierto((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>
        <span>{abierto ? "▼" : "▶"}</span>
        ⚠️ Patentes nuevas detectadas hoy
        <span style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af" }}>({placas.length})</span>
      </button>
      {abierto && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, color: "#6b7280" }}>
            Operaron hoy en {scId} pero no están en el inventario de flota. Registralas para incorporarlas.
          </div>
          {placas.map((it, idx) => (
            <div key={it.placa} style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 6, padding: 10 }}>
              <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{it.placa}</div>
              {it.guardada ? (
                <div style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ Registrada en la flota</div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>Chofer {it.chofer && "(sugerido)"}</div>
                    <input value={it.chofer} onChange={(e) => actualizar(idx, "chofer", e.target.value)}
                      placeholder="Nombre del chofer" disabled={it.guardando}
                      style={{ width: "100%", padding: "5px 8px", borderRadius: 5, border: "1px solid #d1d5db", fontSize: 12 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>Empresa que presta servicio</div>
                    <input value={it.empresa} onChange={(e) => actualizar(idx, "empresa", e.target.value)}
                      placeholder="Razón social del transportista" disabled={it.guardando}
                      style={{ width: "100%", padding: "5px 8px", borderRadius: 5, border: "1px solid #d1d5db", fontSize: 12 }} />
                  </div>
                  <button onClick={() => registrar(idx)} disabled={it.guardando}
                    style={{ padding: "6px 12px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: it.guardando ? "wait" : "pointer" }}>
                    {it.guardando ? "Guardando…" : "Registrar a la flota"}
                  </button>
                </div>
              )}
              {it.error && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{it.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AmbulanciasSC({ scId, fecha }) {
  const [ambulancias, setAmbulancias] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await sb.from("vw_ambulancias_diario")
          .select("ruta_origen, driver_origen, patente_origen, ruta_destino, driver_destino, patente_destino, paquetes_traspasados, patron, hora_inicio_mx, hora_fin_mx, ciudades, receptor_conocido")
          .eq("service_center_id", scId).eq("fecha", fecha);
        if (cancel) return;
        setAmbulancias(data || []);
      } catch (e) {
        console.error("Error ambulancias SC:", e);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [scId, fecha]);

  if (loading) return <div style={{ fontSize: 12, color: "#9ca3af", padding: 8 }}>Cargando ambulancias…</div>;
  if (ambulancias.length === 0) return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>🚑 Ambulancias ({fecha})</div>
      <div style={{ fontSize: 12, color: "#9ca3af" }}>Sin ambulancias registradas este día.</div>
    </div>
  );

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>
        🚑 Ambulancias · {scId} ({ambulancias.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {ambulancias.map((a, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: 9, fontSize: 11 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
              <span style={{ fontSize: 9, background: "#fee2e2", color: "#b91c1c", padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>{a.patron || "rescate"}</span>
              <span style={{ fontWeight: 700, color: "#374151" }}>{a.paquetes_traspasados || 0} paquetes traspasados</span>
              {a.ciudades && <span style={{ color: "#9ca3af" }}>· {a.ciudades}</span>}
            </div>
            <div style={{ color: "#4b5563" }}>
              <strong>Origen:</strong> {a.driver_origen || "—"} ({a.patente_origen || "—"}) · ruta {a.ruta_origen || "—"}
            </div>
            <div style={{ color: "#4b5563" }}>
              <strong>Destino:</strong> {a.driver_destino || "—"} ({a.patente_destino || "—"}) · ruta {a.ruta_destino || "—"}
            </div>
            {(a.hora_inicio_mx || a.hora_fin_mx) && (
              <div style={{ color: "#9ca3af", marginTop: 2 }}>
                {a.hora_inicio_mx || "?"} → {a.hora_fin_mx || "?"} (MX)
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtFechaHoraMX(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Mexico_City",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso)) + " hrs";
  } catch { return iso; }
}

function PaquetesHelper({ idRuta, helperNombre, fecha }) {
  const [paquetes, setPaquetes] = useState(undefined);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        // Traemos TODOS los paquetes de la ruta (sin filtrar por nombre, que no
        // coincide entre el nombre limpio y el crudo). Luego agrupamos por persona.
        const { data } = await sb.from("vw_entregas_por_helper")
          .select("paquete, hora_entrega, city, state, lat, lng, suplantacion, helper_nombre, chofer")
          .eq("id_ruta", idRuta).eq("fecha", fecha)
          .order("hora_entrega", { ascending: true });
        if (!cancel) setPaquetes(data || []);
      } catch (e) {
        console.error("Error paquetes ruta:", e);
        if (!cancel) setPaquetes([]);
      }
    })();
    return () => { cancel = true; };
  }, [idRuta, fecha]);

  if (paquetes === undefined) return <div style={{ fontSize: 10, color: "#9ca3af", padding: "4px 8px" }}>Cargando paquetes…</div>;
  if (paquetes.length === 0) return <div style={{ fontSize: 10, color: "#9ca3af", padding: "4px 8px" }}>Sin paquetes registrados para esta ruta.</div>;

  const horaMX = (ts) => {
    try {
      return new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
    } catch { return "—"; }
  };

  // Agrupar paquetes por helper_nombre (quién lo entregó)
  const porPersona = new Map();
  for (const p of paquetes) {
    const key = p.helper_nombre || "(sin helper)";
    if (!porPersona.has(key)) porPersona.set(key, []);
    porPersona.get(key).push(p);
  }
  const grupos = [...porPersona.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div style={{ margin: "4px 0 4px 20px", padding: 8, background: "#f8fafc", borderRadius: 6, border: "1px solid #e5e7eb" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", marginBottom: 6 }}>
        {paquetes.length} paquete(s) entregado(s) en la ruta · {grupos.length} persona(s)
      </div>
      {grupos.map(([persona, pks], gi) => (
        <div key={gi} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#1e3a5f", marginBottom: 3, display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 9, background: "#fef3c7", color: "#92400e", padding: "1px 6px", borderRadius: 3 }}>HELPER</span>
            {persona}
            <span style={{ color: "#9ca3af", fontWeight: 600 }}>· {pks.length} paquete(s)</span>
          </div>
          <div style={{ overflowX: "auto", maxHeight: 200, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0 }}>
                  <th style={{ padding: "4px 6px", textAlign: "left" }}>#</th>
                  <th style={{ padding: "4px 6px", textAlign: "left" }}>Paquete</th>
                  <th style={{ padding: "4px 6px", textAlign: "center" }}>Hora (MX)</th>
                  <th style={{ padding: "4px 6px", textAlign: "left" }}>Ciudad</th>
                  <th style={{ padding: "4px 6px", textAlign: "center" }}>Ubicación</th>
                </tr>
              </thead>
              <tbody>
                {pks.map((p, i) => (
                  <tr key={i} style={{ borderBottom: "0.5px solid #f1f5f9" }}>
                    <td style={{ padding: "3px 6px", color: "#9ca3af" }}>{i + 1}</td>
                    <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>{p.paquete}</td>
                    <td style={{ padding: "3px 6px", textAlign: "center" }}>{horaMX(p.hora_entrega)}</td>
                    <td style={{ padding: "3px 6px" }}>{p.city || "—"}{p.state ? `, ${p.state}` : ""}</td>
                    <td style={{ padding: "3px 6px", textAlign: "center" }}>
                      {p.lat && p.lng ? (
                        <a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer"
                          style={{ color: "#1e3a5f", textDecoration: "underline" }}>📍 mapa</a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function RutasHelperAprobar({ scId, fecha, decididoPor }) {
  const [rutas, setRutas] = useState([]); // agrupado por id_ruta
  const [decisiones, setDecisiones] = useState({}); // travel_id → 'aprobado' | 'rechazado'
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(null);
  const [abierto, setAbierto] = useState(false); // colapsado por defecto
  const [helperAbierto, setHelperAbierto] = useState(null); // "{idRuta}_{idx}" del helper expandido
  const [motivos, setMotivos] = useState({}); // travel_id → motivo de rechazo
  const [notificando, setNotificando] = useState(null); // travel_id en proceso de notificar
  const [notificados, setNotificados] = useState({}); // travel_id → true si ya se notificó

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [chR, aprobR] = await Promise.all([
          // Detalle de helpers desde vw_control_helper_diario (nombres, %, monto, zona)
          sb.from("vw_control_helper_diario")
            .select("id_ruta, sc, cluster, vehiculo, placa, zona, helper_flag, es_chofer, chofer_nombre, helper_nombre_limpio, helper_pct, helper_idx, helper_count, pkgs_helper, pkgs_total, monto_mxn, autorizado")
            .eq("sc", scId).eq("fecha", fecha).eq("helper_flag", true)
            .order("id_ruta", { ascending: true }).order("helper_idx", { ascending: true }),
          sb.from("aprobaciones_helper")
            .select("travel_id, decision, motivo_rechazo, notificado_at")
            .eq("service_center_id", scId).eq("fecha", fecha),
        ]);
        if (cancel) return;

        // Agrupar por id_ruta
        const porRuta = new Map();
        for (const f of chR.data || []) {
          if (!porRuta.has(f.id_ruta)) {
            const vehLower = String(f.vehiculo || "").toLowerCase();
            const esForanea = String(f.zona || "").toLowerCase().includes("foran");
            const bloqueada = esForanea && vehLower.includes("small van");
            porRuta.set(f.id_ruta, {
              id_ruta: f.id_ruta,
              cluster: f.cluster,
              vehiculo: f.vehiculo,
              placa: f.placa,
              zona: f.zona,
              monto_mxn: f.monto_mxn,
              bloqueada,
              personas: [],
            });
          }
          porRuta.get(f.id_ruta).personas.push({
            nombre: f.es_chofer ? f.chofer_nombre : f.helper_nombre_limpio,
            es_chofer: f.es_chofer,
            pct: f.helper_pct,
            pkgs: f.pkgs_helper,
          });
        }
        const lista = [...porRuta.values()].sort((a, b) => {
          if (!!a.bloqueada !== !!b.bloqueada) return a.bloqueada ? -1 : 1;
          return String(a.id_ruta).localeCompare(String(b.id_ruta));
        });
        setRutas(lista);

        const dec = {};
        const mot = {};
        const notif = {};
        for (const a of aprobR.data || []) {
          dec[String(a.travel_id)] = a.decision;
          if (a.motivo_rechazo) mot[String(a.travel_id)] = a.motivo_rechazo;
          if (a.notificado_at) notif[String(a.travel_id)] = a.notificado_at;
        }
        setDecisiones(dec);
        setMotivos(mot);
        setNotificados(notif);
      } catch (e) {
        console.error("Error cargando rutas helper:", e);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [scId, fecha]);

  async function decidir(ruta, decision) {
    const tid = String(ruta.id_ruta);
    setGuardando(tid);
    try {
      const payload = {
        service_center_id: scId,
        fecha,
        travel_id: ruta.id_ruta,
        vehicle_plate: ruta.placa || null,
        driver_name: (ruta.personas.find((p) => p.es_chofer) || {}).nombre || null,
        vehiculo: ruta.vehiculo || null,
        cluster: ruta.cluster || null,
        bloqueada: !!ruta.bloqueada,
        decision,
        motivo_rechazo: decision === "rechazado" ? (motivos[tid] || null) : null,
        decidido_por: decididoPor || null,
        decidido_at: new Date().toISOString(),
      };
      const { error } = await sb.from("aprobaciones_helper")
        .upsert(payload, { onConflict: "service_center_id,fecha,travel_id" });
      if (error) throw error;
      setDecisiones((prev) => ({ ...prev, [tid]: decision }));
    } catch (e) {
      console.error("Error guardando decisión:", e);
      alert("No se pudo guardar la decisión: " + (e.message || e));
    } finally {
      setGuardando(null);
    }
  }

  // URL del webhook de n8n (path: notificar-rechazo-helper)
  const WEBHOOK_RECHAZO = "https://bigticket2026.app.n8n.cloud/webhook/notificar-rechazo-helper";

  async function notificar(ruta) {
    const tid = String(ruta.id_ruta);
    setNotificando(tid);
    try {
      // Buscar el supervisor del SC (nombre, email, teléfono)
      const { data: sup } = await sb.from("vw_supervisores_panel")
        .select("nombre, email, telefono, scs_asignados")
        .contains("scs_asignados", JSON.stringify([scId])).limit(1).maybeSingle();

      const helper = ruta.personas.find((p) => !p.es_chofer);
      const chofer = ruta.personas.find((p) => p.es_chofer);

      const payload = {
        sc: scId,
        fecha,
        helper_nombre: helper ? helper.nombre : "",
        chofer: chofer ? chofer.nombre : "",
        ruta: String(ruta.id_ruta),
        motivo: motivos[tid] || "",
        supervisor_nombre: sup?.nombre || "",
        supervisor_email: sup?.email || "",
        supervisor_telefono: sup?.telefono || "",
      };

      const resp = await fetch(WEBHOOK_RECHAZO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error("El webhook respondió " + resp.status);

      const ahoraISO = new Date().toISOString();
      // Registrar la notificación Y el motivo en la base (así el motivo siempre
      // queda guardado, sin importar si se escribió antes o después de rechazar)
      await sb.from("aprobaciones_helper")
        .update({ notificado_at: ahoraISO, motivo_rechazo: motivos[tid] || null })
        .eq("service_center_id", scId).eq("fecha", fecha).eq("travel_id", ruta.id_ruta);

      setNotificados((prev) => ({ ...prev, [tid]: ahoraISO }));
    } catch (e) {
      console.error("Error notificando:", e);
      alert("No se pudo enviar la notificación: " + (e.message || e));
    } finally {
      setNotificando(null);
    }
  }

  if (loading) return <div style={{ fontSize: 12, color: "#9ca3af", padding: 8 }}>Cargando rutas con helper…</div>;
  if (rutas.length === 0) return <div style={{ fontSize: 12, color: "#9ca3af", padding: 8 }}>Sin rutas con helper este día.</div>;

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
      <button onClick={() => setAbierto((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 700, color: "#374151" }}>
        <span>{abierto ? "▼" : "▶"}</span>
        🧑‍🔧 Rutas con ayudante — aprobar pago
        <span style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af" }}>({rutas.length})</span>
      </button>
      {abierto && (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {rutas.map((r) => {
          const tid = String(r.id_ruta);
          const dec = decisiones[tid];
          const enCurso = guardando === tid;
          // Filosofía 1: bloqueada sin decisión = se muestra como rechazada por defecto
          const rechazadoVisual = dec === "rechazado" || (r.bloqueada && !dec);
          const aprobadoVisual = dec === "aprobado";
          return (
            <div key={tid} style={{
              background: "#fff",
              border: `1px solid ${aprobadoVisual ? "#86efac" : rechazadoVisual ? "#fca5a5" : "#e5e7eb"}`,
              borderRadius: 6, padding: 10,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12 }}>{r.id_ruta}</span>
                    {r.cluster && <span style={{ fontSize: 9, background: "#e2e8f0", color: "#475569", padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>{r.cluster}</span>}
                    {r.bloqueada && <span style={{ fontSize: 9, background: "#fee2e2", color: "#b91c1c", padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>⚠ BLOQUEADA</span>}
                    {r.monto_mxn != null && <span style={{ fontSize: 9, background: "#dcfce7", color: "#166534", padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>${r.monto_mxn} MXN</span>}
                  </div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
                    {r.placa && <span style={{ fontFamily: "monospace" }}>{r.placa}</span>}
                    {r.vehiculo && <span> · {r.vehiculo}</span>}
                    {r.zona && <span> · {r.zona}</span>}
                  </div>
                  {/* Personas: chofer + helpers con su % */}
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                    {r.personas.map((p, i) => (
                      <div key={i} style={{ fontSize: 11, color: "#4b5563", display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 9, background: p.es_chofer ? "#dbeafe" : "#fef3c7", color: p.es_chofer ? "#1e40af" : "#92400e", padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>
                          {p.es_chofer ? "CHOFER" : "HELPER"}
                        </span>
                        <span style={{ fontWeight: 600 }}>{p.nombre || "—"}</span>
                        {p.pct && <span style={{ marginLeft: "auto", fontWeight: 700, color: "#374151" }}>{p.pct}</span>}
                      </div>
                    ))}
                  </div>
                  {/* Ver paquetes entregados (toda la ruta, agrupado por persona) */}
                  <button onClick={() => setHelperAbierto(helperAbierto === r.id_ruta ? null : r.id_ruta)}
                    style={{ marginTop: 6, fontSize: 11, color: "#1e3a5f", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0, textDecoration: "underline" }}>
                    {helperAbierto === r.id_ruta ? "▲ ocultar paquetes" : "▼ ver paquetes entregados"}
                  </button>
                  {helperAbierto === r.id_ruta && (
                    <PaquetesHelper idRuta={r.id_ruta} fecha={fecha} />
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button onClick={() => decidir(r, "aprobado")} disabled={enCurso}
                    style={{
                      padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: enCurso ? "wait" : "pointer",
                      border: aprobadoVisual ? "2px solid #16a34a" : "1px solid #d1d5db",
                      background: aprobadoVisual ? "#16a34a" : "#fff",
                      color: aprobadoVisual ? "#fff" : "#16a34a",
                    }}>✓ Aprobar</button>
                  <button onClick={() => decidir(r, "rechazado")} disabled={enCurso}
                    style={{
                      padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: enCurso ? "wait" : "pointer",
                      border: rechazadoVisual ? "2px solid #dc2626" : "1px solid #d1d5db",
                      background: rechazadoVisual ? "#dc2626" : "#fff",
                      color: rechazadoVisual ? "#fff" : "#dc2626",
                    }}>✗ Rechazar</button>
                </div>
              </div>
              {r.bloqueada && !dec && (
                <div style={{ marginTop: 8, fontSize: 10, color: "#b91c1c", fontStyle: "italic" }}>
                  ⚠ Bloqueada por defecto (Small Van foránea) — no se paga salvo que apruebes.
                </div>
              )}
              {/* Si está rechazado */}
              {rechazadoVisual && (
                notificados[tid] ? (
                  /* Ya se notificó: mostrar el registro de lo enviado */
                  <div style={{ marginTop: 8, padding: 8, background: "#f0fdf4", borderRadius: 6, border: "1px solid #bbf7d0" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", marginBottom: 4 }}>
                      ✓ Rechazo notificado al supervisor
                    </div>
                    {motivos[tid] && motivos[tid].trim() && (
                      <div style={{ fontSize: 12, color: "#374151", marginBottom: 3 }}>
                        <strong>Motivo enviado:</strong> {motivos[tid]}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "#6b7280" }}>
                      📲 Enviado el {fmtFechaHoraMX(notificados[tid])}
                    </div>
                  </div>
                ) : (
                  /* Aún no notificado: campo de motivo + botón */
                  <div style={{ marginTop: 8, padding: 8, background: "#fef2f2", borderRadius: 6, border: "1px solid #fecaca" }}>
                    <textarea
                      value={motivos[tid] || ""}
                      onChange={(e) => setMotivos((prev) => ({ ...prev, [tid]: e.target.value }))}
                      onBlur={(e) => {
                        // Guardar el motivo en la base al salir del campo. Usamos upsert
                        // por si la fila aún no existe (motivo escrito antes de rechazar).
                        const txt = e.target.value;
                        const choferRow = r.personas.find((p) => p.es_chofer);
                        sb.from("aprobaciones_helper")
                          .upsert({
                            service_center_id: scId,
                            fecha,
                            travel_id: r.id_ruta,
                            vehicle_plate: r.placa || null,
                            driver_name: choferRow ? choferRow.nombre : null,
                            vehiculo: r.vehiculo || null,
                            cluster: r.cluster || null,
                            bloqueada: !!r.bloqueada,
                            decision: "rechazado",
                            motivo_rechazo: txt || null,
                            decidido_por: decididoPor || null,
                            decidido_at: new Date().toISOString(),
                          }, { onConflict: "service_center_id,fecha,travel_id" })
                          .then(() => {}, (err) => console.error("Error guardando motivo:", err));
                      }}
                      placeholder="Motivo del rechazo (opcional)…"
                      rows={2}
                      style={{ width: "100%", fontSize: 12, padding: "6px 8px", borderRadius: 5, border: "1px solid #d1d5db", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                      <button onClick={() => notificar(r)} disabled={notificando === tid}
                        style={{
                          padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 6,
                          cursor: notificando === tid ? "wait" : "pointer",
                          border: "none", background: "#1e3a5f", color: "#fff",
                        }}>
                        {notificando === tid ? "Enviando…" : "📲 Notificar (WhatsApp + correo)"}
                      </button>
                      <span style={{ fontSize: 10, color: "#9ca3af" }}>Avisa al supervisor del SC</span>
                    </div>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

function FormularioInicialSC({ scId, fecha }) {
  const [row, setRow] = useState(undefined); // undefined=cargando, null=sin datos
  const [verAyudantes, setVerAyudantes] = useState(false);
  useEffect(() => {
    let cancel = false;
    setVerAyudantes(false);
    (async () => {
      try {
        const { data } = await sb.from("vw_bitacora_panel")
          .select("*").eq("service_center_id", scId).eq("fecha", fecha).maybeSingle();
        if (!cancel) setRow(data || null);
      } catch (e) { if (!cancel) setRow(null); }
    })();
    return () => { cancel = true; };
  }, [scId, fecha]);

  if (row === undefined) return <div style={{ fontSize: 12, color: "#9ca3af" }}>Cargando formulario…</div>;
  if (row === null) return <div style={{ fontSize: 12, color: "#9ca3af" }}>El supervisor no completó el formulario del {fecha}.</div>;

  const siNo = (v) => v === true ? "Sí" : v === false ? "No" : "—";
  const cnt = (arr) => Array.isArray(arr) ? arr.length : 0;
  const ayudantes = Array.isArray(row.declarado_ayudantes_detalle) ? row.declarado_ayudantes_detalle : [];
  const noshowPatentes = Array.isArray(row.declarado_noshow_patentes) ? row.declarado_noshow_patentes : [];
  const adj = (row.justificaciones_adjuntos && typeof row.justificaciones_adjuntos === "object") ? row.justificaciones_adjuntos : {};

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>
        📝 Formulario del supervisor ({fecha})
        {row.estado_dia && <span style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", marginLeft: 6 }}>· {row.estado_dia}</span>}
      </div>
      {/* Jornada SIN OPERACIÓN — color especial + motivo del supervisor */}
      {row.sin_operacion === true && (
        <div style={{ background: "#fff7ed", border: "2px solid #f59e0b", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#92400e" }}>🚫 JORNADA SIN OPERACIÓN</div>
          <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>El supervisor marcó este día como sin operación. Los ítems no aplican.</div>
          {row.sin_operacion_motivo && String(row.sin_operacion_motivo).trim()
            ? <div style={{ fontSize: 12, color: "#7c2d12", marginTop: 6, fontStyle: "italic", whiteSpace: "pre-wrap" }}>💬 {row.sin_operacion_motivo}</div>
            : <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, marginTop: 6 }}>(sin motivo cargado)</div>}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>

        {/* 1 · Ayudantes con detalle expandible */}
        <div style={{ fontSize: 12, padding: "5px 8px", background: "#fff", border: "1px solid #eef0f3", borderRadius: 5 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontWeight: 600, color: "#374151" }}>1 · Ayudantes</span>
            {ayudantes.length > 0 && (
              <button onClick={() => setVerAyudantes((v) => !v)}
                style={{ fontSize: 10, color: "#1e3a5f", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}>
                {verAyudantes ? "▲ ocultar" : `▼ ver ${ayudantes.length} ruta(s)`}
              </button>
            )}
            <span style={{ marginLeft: "auto", fontWeight: 700, color: declColor(siNo(row.declarado_ayudantes_si_no)) }}>{siNo(row.declarado_ayudantes_si_no)}</span>
          </div>
          {verAyudantes && ayudantes.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
              {ayudantes.map((a, i) => (
                <div key={i} style={{ fontSize: 11, color: "#4b5563", padding: "3px 6px", background: "#f8fafc", borderRadius: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{a.placa}</span>
                  {a.cluster && <span style={{ fontSize: 9, background: "#e2e8f0", color: "#475569", padding: "0 5px", borderRadius: 3, fontWeight: 700 }}>{a.cluster}</span>}
                  <span>{a.chofer || "—"}</span>
                  {a.vehiculo && <span style={{ color: "#9ca3af" }}>· {a.vehiculo}</span>}
                  {a.bloqueada && <span style={{ fontSize: 9, background: "#fee2e2", color: "#b91c1c", padding: "0 5px", borderRadius: 3, fontWeight: 700 }}>BLOQUEADA</span>}
                </div>
              ))}
            </div>
          )}
          {row.ayudantes_justificacion?.trim() && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, fontStyle: "italic" }}>💬 {row.ayudantes_justificacion}</div>}
          {Array.isArray(adj.ayudantes) && adj.ayudantes.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", marginTop: 4 }}>
              {adj.ayudantes.map((f, i) => <FotoLink key={i} path={typeof f === "string" ? f : f?.path} />)}
            </div>
          )}
        </div>

        {/* 2 · Ambulancias (detalle completo: patente a pagar, justificación y fotos) */}
        <ItemAmbulancias row={row} />

        {/* 3 · Cancelaciones */}
        <ItemCancelaciones row={row} adjCancelaciones={adj.cancelaciones || []} />

        {/* 4 · No Show con patentes */}
        <ItemSimple nombre="4 · No Show" valor={siNo(row.declarado_noshow_si_no)}
          detalle={noshowPatentes.length > 0 ? `Patentes: ${noshowPatentes.map((p) => (typeof p === "string" ? p : p.placa || p.patente || "")).filter(Boolean).join(", ")}` : null}
          justif={row.noshow_justificacion}
          fotos={adj.noshow} />

        {/* 5 · PNR */}
        <ItemSimple nombre="5 · PNR"
          valor={siNo(row.declarado_pnr_si_no)}
          detalle={row.declarado_pnr_si_no === true
            ? ((row.declarado_pnr_casos_abiertos != null || row.declarado_pnr_cantidad_total != null)
                ? `${row.declarado_pnr_casos_abiertos ?? 0} abierto(s) de ${row.declarado_pnr_cantidad_total ?? 0} total`
                : "Declaró PNR (sin cantidades)")
            : null}
          justif={row.pnr_justificacion}
          fotos={adj.pnr} />
      </div>
    </div>
  );
}

const TERCEROS_HISTORICO_DESDE = "2026-07-01";

function ItemTercerosBitacora({ scId, fecha }) {
  const hoyMX = useMemo(() => {
    const mx = new Date(Date.now() - 6 * 60 * 60 * 1000);
    return mx.toISOString().split("T")[0];
  }, []);
  const esHoy = fecha === hoyMX;
  const hayHistorico = !esHoy && fecha >= TERCEROS_HISTORICO_DESDE && fecha < hoyMX;
  const [filas, setFilas] = useState(undefined);   // undefined=cargando
  const [cambios, setCambios] = useState([]);      // movimientos del día

  useEffect(() => {
    let cancel = false;
    // Movimientos del día (cualquier fecha)
    (async () => {
      try {
        const { data, error } = await sb.rpc("get_terceros_cambios_dia", { p_sc: scId, p_fecha: fecha });
        if (error) throw error;
        if (!cancel) setCambios(Array.isArray(data) ? data : []);
      } catch (e) { if (!cancel) setCambios([]); }
    })();
    // Detalle placa a placa
    if (!esHoy && !hayHistorico) { setFilas(null); return () => { cancel = true; }; }
    setFilas(undefined);
    (async () => {
      try {
        const rpc = esHoy ? "get_terceros_confirmacion_sc" : "get_terceros_confirmacion_historico";
        const { data, error } = await sb.rpc(rpc, { p_sc: scId, p_fecha: fecha });
        if (error) throw error;
        if (!cancel) setFilas(Array.isArray(data) ? data : []);
      } catch (e) { if (!cancel) setFilas([]); }
    })();
    return () => { cancel = true; };
  }, [scId, fecha, esHoy, hayHistorico]);

  // Índice de movimientos por placa (para pintar el warning en su fila)
  const cambiosPorPlaca = useMemo(() => {
    const m = {};
    for (const c of cambios) {
      const k = String(c.placa || "").toUpperCase().trim();
      (m[k] = m[k] || []).push(c);
    }
    return m;
  }, [cambios]);

  const total = Array.isArray(filas) ? filas.length : 0;
  const confirmadas = Array.isArray(filas) ? filas.filter((f) => f.confirmado_hoy).length : 0;
  const completo = total > 0 && confirmadas === total;
  const resumenColor = total === 0 ? "#9ca3af" : completo ? "#16a34a" : confirmadas === 0 ? "#dc2626" : "#d97706";
  const nWarn = cambios.length;

  const WarningChip = ({ c }) => {
    const esCambio = c.empresa_anterior &&
      String(c.empresa_anterior).toUpperCase().trim() !== String(c.empresa_nueva || "").toUpperCase().trim();
    return (
      <div style={{ fontSize: 10.5, marginTop: 3, padding: "3px 8px", borderRadius: 4, lineHeight: 1.5,
                    background: c.es_empresa_nueva ? "#fef2f2" : "#fffbeb",
                    border: `1px solid ${c.es_empresa_nueva ? "#fecaca" : "#fde68a"}`,
                    color: c.es_empresa_nueva ? "#b91c1c" : "#92400e" }}>
        {esCambio && (
          <span>⚠ Cambio de empresa: <strong>{c.empresa_anterior}</strong> → <strong>{c.empresa_nueva}</strong></span>
        )}
        {!esCambio && c.es_empresa_nueva && (
          <span>⚠ Empresa nueva registrada: <strong>{c.empresa_nueva}</strong>{c.rfc ? ` (RFC ${c.rfc})` : ""}</span>
        )}
        {!esCambio && !c.es_empresa_nueva && c.es_cambio_sc && (
          <span>⚠ Traslado de SC: <strong>{c.sc_anterior}</strong> → este SC ({c.empresa_nueva})</span>
        )}
        {esCambio && c.es_empresa_nueva && (
          <span style={{ marginLeft: 6, fontWeight: 800 }}>· empresa NUEVA no certificada</span>
        )}
        {c.es_cambio_sc && esCambio && (
          <span style={{ marginLeft: 6 }}>· venía de {c.sc_anterior}</span>
        )}
        {c.supervisor && <span style={{ marginLeft: 6, color: "#9ca3af" }}>({c.supervisor})</span>}
      </div>
    );
  };

  const FilaPlaca = ({ f }) => {
    const certificada = !f.es_pendiente;
    const warns = cambiosPorPlaca[String(f.placa || "").toUpperCase().trim()] || [];
    return (
      <div style={{ fontSize: 11, color: "#4b5563", padding: "3px 6px", background: warns.length ? "#fffdf5" : "#f8fafc", borderRadius: 4 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{f.placa}</span>
          <span>{f.empresa_actual || "— sin empresa —"}</span>
          {f.rfc && <span style={{ fontSize: 9, background: "#e2e8f0", color: "#475569", padding: "0 5px", borderRadius: 3, fontWeight: 700 }}>RFC {f.rfc}</span>}
          <span style={{ fontSize: 9, padding: "0 5px", borderRadius: 3, fontWeight: 700, background: certificada ? "#dcfce7" : "#fee2e2", color: certificada ? "#166534" : "#b91c1c" }}>
            {certificada ? "Certificada" : "No certificada"}
          </span>
          <span style={{ marginLeft: "auto", fontWeight: 700, color: f.confirmado_hoy ? "#16a34a" : "#9ca3af" }}>
            {f.confirmado_hoy ? "✓ confirmada" : "pendiente"}
          </span>
        </div>
        {warns.map((c, k) => <WarningChip key={k} c={c} />)}
      </div>
    );
  };

  return (
    <div style={{ fontSize: 12, padding: "5px 8px", background: "#fff", border: "1px solid #eef0f3", borderRadius: 5 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontWeight: 600, color: "#374151" }}>6 · Confirmación de Terceros</span>
        {nWarn > 0 && (
          <span style={{ fontSize: 10, fontWeight: 800, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", padding: "1px 7px", borderRadius: 9 }}>
            ⚠ {nWarn} movimiento{nWarn === 1 ? "" : "s"}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontWeight: 700, color: resumenColor }}>
          {filas === undefined ? "…"
            : esHoy ? `${confirmadas}/${total}`
            : hayHistorico ? (total > 0 ? `${total} ✓` : "—")
            : "—"}
        </span>
      </div>

      {!esHoy && !hayHistorico && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, fontStyle: "italic" }}>
          El detalle de Terceros está disponible desde el {TERCEROS_HISTORICO_DESDE}.
        </div>
      )}

      {hayHistorico && Array.isArray(filas) && (
        <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 4, fontStyle: "italic" }}>
          Fecha pasada: se listan las placas confirmadas ese día (las no confirmadas no se historizan).
        </div>
      )}

      {(esHoy || hayHistorico) && filas === undefined && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>Cargando terceros…</div>
      )}

      {(esHoy || hayHistorico) && Array.isArray(filas) && filas.length === 0 && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
          {esHoy ? "Sin placas rosterizadas hoy para este SC." : "Sin confirmaciones registradas ese día para este SC."}
        </div>
      )}

      {(esHoy || hayHistorico) && Array.isArray(filas) && filas.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
          {filas.map((f, i) => <FilaPlaca key={i} f={f} />)}
        </div>
      )}

      {/* Movimientos de placas que no aparecen en la lista de arriba */}
      {Array.isArray(filas) && cambios.filter((c) => !(filas || []).some((f) =>
        String(f.placa || "").toUpperCase().trim() === String(c.placa || "").toUpperCase().trim())).length > 0 && (
        <div style={{ marginTop: 6 }}>
          {cambios.filter((c) => !(filas || []).some((f) =>
            String(f.placa || "").toUpperCase().trim() === String(c.placa || "").toUpperCase().trim())).map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, marginTop: 5 }}>{c.placa}</span>
              <div style={{ flex: 1 }}><WarningChip c={c} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function declColor(v) {
  return v === "Sí" ? "#b45309" : v === "No" ? "#16a34a" : "#9ca3af";
}

function ItemAmbulancias({ row }) {
  const siNoVal = row.declarado_ambulancias_si_no;
  const detalle = Array.isArray(row.declarado_ambulancias_detalle) ? row.declarado_ambulancias_detalle : [];
  const valorTxt = siNoVal === true ? "Sí" : siNoVal === false ? "No" : "—";

  return (
    <div style={{ fontSize: 12, padding: "5px 8px", background: "#fff", border: "1px solid #eef0f3", borderRadius: 5 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontWeight: 600, color: "#374151" }}>2 · Ambulancias</span>
        <span style={{ marginLeft: "auto", fontWeight: 700, color: declColor(valorTxt) }}>{valorTxt}</span>
      </div>
      {/* Texto general del ítem (compat. bitácoras viejas) */}
      {row.ambulancias_justificacion && row.ambulancias_justificacion.trim() && (
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, fontStyle: "italic" }}>💬 {row.ambulancias_justificacion}</div>
      )}
      {/* Detalle por ruta: patente que paga + ruta/placa + chofer + justificación + fotos */}
      {detalle.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, color: "#4b5563", fontWeight: 600 }}>{detalle.length} ambulancia(s):</div>
          {detalle.map((d, i) => {
            const adjuntos = Array.isArray(d.adjuntos)
              ? d.adjuntos.map((a) => (typeof a === "string" ? a : a?.path)).filter(Boolean)
              : [];
            return (
              <div key={i} style={{ padding: "6px 8px", background: "#f8fafc", borderRadius: 5, border: "1px solid #eef0f3" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 9, background: "#dbeafe", color: "#1e3a5f", padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>{i + 1}</span>
                  {d.patente_ambulancia
                    ? <span style={{ fontSize: 10, background: "#fef3c7", color: "#92400e", padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>💰 paga: <span style={{ fontFamily: "monospace" }}>{d.patente_ambulancia}</span></span>
                    : <span style={{ fontSize: 10, color: "#dc2626", fontWeight: 600 }}>(sin patente a pagar)</span>}
                  {d.id_ruta && <span style={{ fontSize: 10, color: "#6b7280" }}>ruta {d.id_ruta}</span>}
                  {d.placa && <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 11, color: "#374151" }}>{d.placa}</span>}
                  {d.cluster && <span style={{ fontSize: 9, background: "#e2e8f0", color: "#475569", padding: "0 5px", borderRadius: 3, fontWeight: 700 }}>{d.cluster}</span>}
                  {d.chofer && <span style={{ fontSize: 11, color: "#4b5563" }}>· {d.chofer}</span>}
                </div>
                {d.justificacion && String(d.justificacion).trim()
                  ? <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3, fontStyle: "italic" }}>💬 {d.justificacion}</div>
                  : <div style={{ fontSize: 10, color: "#dc2626", marginTop: 3 }}>(sin justificación)</div>}
                {adjuntos.length > 0
                  ? <div style={{ display: "flex", flexWrap: "wrap", marginTop: 4 }}>{adjuntos.map((p, j) => <FotoLink key={j} path={p} />)}</div>
                  : <div style={{ fontSize: 10, color: "#dc2626", marginTop: 3 }}>(sin foto/PDF)</div>}
              </div>
            );
          })}
        </div>
      )}
      {detalle.length === 0 && siNoVal === true && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>Declaró ambulancias pero sin detalle cargado.</div>
      )}
    </div>
  );
}

function ItemCancelaciones({ row, adjCancelaciones }) {
  const siNoVal = row.declarado_cancelaciones_si_no;
  const detalle = Array.isArray(row.declarado_cancelaciones_detalle) ? row.declarado_cancelaciones_detalle : [];
  const fotosViejas = Array.isArray(row.declarado_cancelaciones_fotos) ? row.declarado_cancelaciones_fotos : [];
  const valorTxt = siNoVal === true ? "SI" : siNoVal === false ? "NO" : "—";

  return (
    <div style={{ fontSize: 12, padding: "5px 8px", background: "#fff", border: "1px solid #eef0f3", borderRadius: 5 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontWeight: 600, color: "#374151" }}>3 · Cancelaciones MELI</span>
        <span style={{ marginLeft: "auto", fontWeight: 700, color: declColor(valorTxt) }}>{valorTxt}</span>
      </div>
      {row.cancelaciones_justificacion && row.cancelaciones_justificacion.trim() && (
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, fontStyle: "italic" }}>💬 {row.cancelaciones_justificacion}</div>
      )}
      {/* Detalle nuevo: una fila por cancelacion con patente + prueba */}
      {detalle.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontSize: 11, color: "#4b5563", fontWeight: 600 }}>{detalle.length} cancelación(es):</div>
          {detalle.map((d, i) => (
            <div key={i} style={{ padding: "4px 8px", background: "#f8fafc", borderRadius: 5, border: "1px solid #eef0f3" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 9, background: "#fee2e2", color: "#b91c1c", padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>{i + 1}</span>
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: "#1e3a5f" }}>{d.patente || "(sin patente)"}</span>
                <div style={{ marginLeft: "auto" }}>
                  {d.foto?.path ? <FotoLink path={d.foto.path} /> : <span style={{ fontSize: 10, color: "#9ca3af" }}>sin prueba</span>}
                </div>
              </div>
              {d.justificacion && String(d.justificacion).trim()
                ? <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3, fontStyle: "italic" }}>💬 {d.justificacion}</div>
                : <div style={{ fontSize: 10, color: "#dc2626", marginTop: 3 }}>(sin justificación)</div>}
            </div>
          ))}
        </div>
      )}
      {/* Fallback: bitacoras viejas sin detalle, muestra las fotos sueltas */}
      {detalle.length === 0 && (fotosViejas.length > 0 || adjCancelaciones.length > 0) && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 2 }}>{fotosViejas.length} foto(s) adjuntas</div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {[...fotosViejas, ...adjCancelaciones].map((f, i) => {
              const p = typeof f === "string" ? f : f?.path;
              return p ? <FotoLink key={i} path={p} /> : null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemSimple({ nombre, valor, detalle, justif, fotos }) {
  const paths = Array.isArray(fotos) ? fotos.map((f) => (typeof f === "string" ? f : f?.path)).filter(Boolean) : [];
  return (
    <div style={{ fontSize: 12, padding: "5px 8px", background: "#fff", border: "1px solid #eef0f3", borderRadius: 5 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontWeight: 600, color: "#374151" }}>{nombre}</span>
        <span style={{ marginLeft: "auto", fontWeight: 700, color: declColor(valor) }}>{valor}</span>
      </div>
      {detalle && <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>{detalle}</div>}
      {justif && justif.trim() && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, fontStyle: "italic" }}>💬 {justif}</div>}
      {paths.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 4 }}>
          {paths.map((p, i) => <FotoLink key={i} path={p} />)}
        </div>
      )}
    </div>
  );
}

const BUCKET_BITACORA = "bitacora-cancelaciones-meli";

function FotoLink({ path }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data, error } = await sb.storage.from(BUCKET_BITACORA).createSignedUrl(path, 3600);
        if (cancel) return;
        if (error || !data?.signedUrl) setErr(true);
        else setUrl(data.signedUrl);
      } catch { if (!cancel) setErr(true); }
    })();
    return () => { cancel = true; };
  }, [path]);

  const nombre = String(path).split("/").pop();
  const esPdf = /\.pdf$/i.test(nombre);
  if (err) return <span style={{ fontSize: 11, color: "#dc2626" }}>⚠ {nombre} (no disponible)</span>;
  if (!url) return <span style={{ fontSize: 11, color: "#9ca3af" }}>Cargando {nombre}…</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#1e3a5f", textDecoration: "none", border: "1px solid #d1d5db", borderRadius: 5, padding: "3px 8px", marginRight: 6, marginBottom: 4, background: "#fff" }}>
      {esPdf ? "📄" : "🖼"} {nombre.length > 22 ? nombre.slice(0, 22) + "…" : nombre}
    </a>
  );
}

function PanelControlSupervisores() {
  const [fecha, setFecha] = useState(() => {
    // Hoy en MX (UTC-6)
    const mx = new Date(Date.now() - 6 * 60 * 60 * 1000);
    return mx.toISOString().split("T")[0];
  });
  const [supervisores, setSupervisores] = useState([]);
  const [bitHoy, setBitHoy] = useState({});   // {scId: row}
  const [bitAyer, setBitAyer] = useState({});  // {scId: row}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandido, setExpandido] = useState(new Set());
  const [filtroSc, setFiltroSc] = useState("");  // "" = todos
  const [filtroEvento, setFiltroEvento] = useState("todos");  // todos|bitacora|helper|torre|ambulancias|patentes
  const [terceros6, setTerceros6] = useState({});   // {scId: {total, confirmadas, completo}}
  const [t6Activo, setT6Activo] = useState(false);  // true solo cuando la fecha seleccionada es HOY (MX)
  const [refrescando, setRefrescando] = useState(false); // refresh silencioso (no desmonta la tabla)
  const [tick, setTick] = useState(0);              // fuerza recarga de los detalles expandidos

  // Fecha anterior (D-1) respecto a la seleccionada
  const fechaAyer = useMemo(() => {
    const d = new Date(fecha + "T12:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }, [fecha]);

  const cargar = useCallback(async (silencioso = false) => {
    if (silencioso) setRefrescando(true);
    else setLoading(true);
    setError(null);
    try {
      const [supsR, hoyR, ayerR] = await Promise.all([
        sb.from("vw_supervisores_panel")
          .select("nombre, email, telefono, scs_asignados, rol"),
        sb.from("vw_bitacora_panel").select("*").eq("fecha", fecha),
        sb.from("vw_bitacora_panel").select("*").eq("fecha", fechaAyer),
      ]);
      if (supsR.error) throw supsR.error;

      // Armar lista plana: 1 entrada por SC (un supervisor puede tener varios)
      const lista = [];
      for (const s of supsR.data || []) {
        const scs = Array.isArray(s.scs_asignados) ? s.scs_asignados : [];
        for (const sc of scs) {
          lista.push({ sc: String(sc), nombre: s.nombre, email: s.email, telefono: s.telefono, rol: s.rol });
        }
      }
      lista.sort((a, b) => a.sc.localeCompare(b.sc));

      const idxHoy = {};
      for (const r of hoyR.data || []) idxHoy[r.service_center_id] = r;
      const idxAyer = {};
      for (const r of ayerR.data || []) idxAyer[r.service_center_id] = r;

      // ── Item 6 · Confirmación de Terceros ──────────────────────────
      // HOY: get_terceros_confirmacion_sc (rostering en vivo → X/Y exacto).
      // FECHA PASADA: get_terceros_resumen_dia (log diario). No conocemos el
      // total rosterizado histórico, así que se cuenta como completo cuando
      // hay al menos una confirmación registrada ese día para el SC.
      const mxHoy = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().split("T")[0];
      const esHoy = fecha === mxHoy;
      const t6Idx = {};
      const scsUnicos = Array.from(new Set(lista.map((x) => x.sc)));
      const res = await Promise.all(scsUnicos.map(async (sc) => {
        try {
          if (esHoy) {
            const { data, error } = await sb.rpc("get_terceros_confirmacion_sc", { p_sc: sc, p_fecha: mxHoy });
            if (error) throw error;
            const fs = Array.isArray(data) ? data : [];
            const total = fs.length;
            const confirmadas = fs.filter((f) => f.confirmado_hoy).length;
            return { sc, t: { total, confirmadas, completo: total === 0 || confirmadas === total } };
          } else {
            const { data, error } = await sb.rpc("get_terceros_resumen_dia", { p_sc: sc, p_fecha: fecha });
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            const confirmadas = Number(row?.confirmadas || 0);
            if (!row?.tiene_datos) return { sc, t: null };
            return { sc, t: { total: confirmadas, confirmadas, completo: true } };
          }
        } catch { return { sc, t: null }; }
      }));
      for (const r of res) if (r.t) t6Idx[r.sc] = r.t;

      setTerceros6(t6Idx);
      setT6Activo(true); // el resumen aplica tanto para hoy como para fechas pasadas con datos
      setSupervisores(lista);
      setBitHoy(idxHoy);
      setBitAyer(idxAyer);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
      setRefrescando(false);
    }
  }, [fecha, fechaAyer]);

  useEffect(() => { cargar(); }, [cargar]);

  // ─── Cálculo de estado HOY: cuántos de los 5 ítems declaró ──────────
  function estadoHoy(row) {
    if (!row) return { completados: 0, total: 5, items: itemsVacios(), sinOperacion: false, motivo: "" };
    const items = {
      ayudantes: row.declarado_ayudantes_si_no !== null && row.declarado_ayudantes_si_no !== undefined,
      ambulancias: row.declarado_ambulancias_si_no !== null && row.declarado_ambulancias_si_no !== undefined,
      cancelaciones: row.declarado_cancelaciones_si_no !== null && row.declarado_cancelaciones_si_no !== undefined,
      noshow: row.declarado_noshow_si_no !== null && row.declarado_noshow_si_no !== undefined,
      pnr: row.declarado_pnr_si_no !== null && row.declarado_pnr_si_no !== undefined,
    };
    const completados = Object.values(items).filter(Boolean).length;
    return { completados, total: 5, items, sinOperacion: row.sin_operacion === true, motivo: row.sin_operacion_motivo || "" };
  }
  function itemsVacios() {
    return { ayudantes: false, ambulancias: false, cancelaciones: false, noshow: false, pnr: false };
  }

  // Item 6 (terceros) de un SC: null = sin datos (fecha sin confirmaciones)
  function item6De(sc) {
    if (!t6Activo) return null;
    return terceros6[sc] || null;
  }

  // ─── Cálculo de estado D-1: conciliación de ayer ────────────────────
  function estadoD1(row) {
    if (!row) return { estado: "sin_datos", label: "Sin datos", color: "#9ca3af", confirmada: false, difsSinJustif: 0 };
    const confirmada = !!row.conciliacion_d1_confirmada_at;
    // Diferencias sin justificar: estados de justificación en 'pendiente'
    const estadosJustif = [
      row.ayudantes_estado_justif, row.ambulancias_estado_justif,
      row.cancelaciones_estado_justif, row.noshow_estado_justif, row.pnr_estado_justif,
    ];
    const difsSinJustif = estadosJustif.filter((e) => e === "pendiente").length;

    if (confirmada) return { estado: "ok", label: "Confirmada", color: "#16a34a", confirmada, difsSinJustif };
    if (difsSinJustif > 0) return { estado: "pendiente", label: "Pendiente", color: "#dc2626", confirmada, difsSinJustif };
    // Tiene datos pero ni confirmó ni tiene difs pendientes → parcial
    return { estado: "parcial", label: "Parcial", color: "#d97706", confirmada, difsSinJustif };
  }

  function toggle(sc) {
    setExpandido((prev) => {
      const n = new Set(prev);
      if (n.has(sc)) n.delete(sc); else n.add(sc);
      return n;
    });
  }

  // ─── Totales para el resumen ────────────────────────────────────────
  const totales = useMemo(() => {
    let completaronHoy = 0, conciliaronD1 = 0;
    for (const s of supervisores) {
      const eh = estadoHoy(bitHoy[s.sc]);
      const t6 = item6De(s.sc);
      const totalItems = t6 ? 6 : 5;
      const done = eh.completados + (t6 && t6.completo ? 1 : 0);
      if (done === totalItems || eh.sinOperacion) completaronHoy++;
      const ed = estadoD1(bitAyer[s.sc]);
      if (ed.estado === "ok") conciliaronD1++;
    }
    return { completaronHoy, conciliaronD1, total: supervisores.length };
  }, [supervisores, bitHoy, bitAyer, terceros6, t6Activo]);

  const NOMBRES_ITEMS = {
    ayudantes: "Ayudantes", ambulancias: "Ambulancias",
    cancelaciones: "Cancelaciones", noshow: "No Show", pnr: "PNR",
  };

  return (
    <div className="pg">
      <div className="sec-title">Consolidaciones Bitácora por SC</div>
      <div className="sec-sub">Torre de control, rutas con helper, ambulancias y bitácora del supervisor · por SC</div>

      {/* Barra de control: fecha + refrescar */}
      <div className="form-card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Fecha:</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>SC:</label>
          <select value={filtroSc} onChange={(e) => setFiltroSc(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
            <option value="">Todos</option>
            {supervisores.map((s) => <option key={s.sc} value={s.sc}>{s.sc}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Evento:</label>
          <select value={filtroEvento} onChange={(e) => setFiltroEvento(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
            <option value="todos">Todos</option>
            <option value="bitacora">Bitácora del supervisor</option>
            <option value="helper">Rutas con helper</option>
            <option value="torre">Torre de Control</option>
            <option value="ambulancias">Ambulancias</option>
            <option value="patentes">Patentes nuevas</option>
          </select>
        </div>
        <button onClick={() => { setTick((t) => t + 1); cargar(true); }} disabled={refrescando}
          style={{ padding: "6px 14px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: refrescando ? "wait" : "pointer", opacity: refrescando ? 0.7 : 1 }}>
          {refrescando ? "⏳ Actualizando…" : "🔄 Refrescar"}
        </button>
        <div style={{ marginLeft: "auto", fontSize: 13, color: "#374151" }}>
          <strong>{totales.completaronHoy}/{totales.total}</strong> completaron Hoy
        </div>
      </div>

      {error && (
        <div className="form-card" style={{ background: "#fef2f2", border: "1px solid #fecaca", marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#991b1b" }}>Error: {error}</div>
        </div>
      )}

      {loading ? (
        <div className="form-card" style={{ textAlign: "center", padding: 40, color: "#666" }}>
          Cargando estados…
        </div>
      ) : (
        <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={thPanel()}>SC</th>
                <th style={thPanel()}>Supervisor</th>
                <th style={thPanel("center")}>Hoy ({fecha})</th>
                <th style={thPanel("center")}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {supervisores.filter((s) => !filtroSc || s.sc === filtroSc).map((s) => {
                const eh = estadoHoy(bitHoy[s.sc]);
                const ed = estadoD1(bitAyer[s.sc]);
                const abierto = expandido.has(s.sc);
                const sinOp = eh.sinOperacion;
                const t6 = item6De(s.sc);
                const totalItems = t6 ? 6 : 5;
                const completadosItems = eh.completados + (t6 && t6.completo ? 1 : 0);
                const hoyColor = sinOp ? "#b45309" : completadosItems === totalItems ? "#16a34a" : completadosItems === 0 ? "#dc2626" : "#d97706";
                return (
                  <Fragment key={s.sc}>
                    <tr style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: sinOp ? "#fff7ed" : undefined }} onClick={() => toggle(s.sc)}>
                      <td style={{ ...tdPanel(), fontFamily: "monospace", fontWeight: 700 }}>{s.sc}</td>
                      <td style={tdPanel()}>{s.nombre || "—"}</td>
                      <td style={{ ...tdPanel("center"), fontWeight: 700, color: hoyColor }}>
                        {sinOp
                          ? "🚫 Sin op."
                          : `${completadosItems === totalItems ? "✅" : completadosItems === 0 ? "❌" : "🟡"} ${completadosItems}/${totalItems}`}
                      </td>
                      <td style={tdPanel("center")}>
                        <span style={{ fontSize: 11, color: "#6b7280" }}>{abierto ? "▲ cerrar" : "▼ ver"}</span>
                      </td>
                    </tr>
                    {abierto && (
                      <tr style={{ background: "#fafbfc" }}>
                        <td key={tick} colSpan={4} style={{ padding: 14 }}>
                          {/* Checklist de los 6 ítems: deja claro cuál está completado */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                            {[
                              { n: "1 · Ayudantes", ok: sinOp || eh.items.ayudantes },
                              { n: "2 · Ambulancias", ok: sinOp || eh.items.ambulancias },
                              { n: "3 · Cancelaciones MELI", ok: sinOp || eh.items.cancelaciones },
                              { n: "4 · No Show", ok: sinOp || eh.items.noshow },
                              { n: "5 · PNR", ok: sinOp || eh.items.pnr },
                              { n: "6 · Confirmación de Terceros", ok: !!(t6 && t6.completo), na: !t6 },
                            ].map((it, k) => (
                              <span key={k} style={{
                                fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 14,
                                border: `1px solid ${it.na ? "#e5e7eb" : it.ok ? "#bbf7d0" : "#fecaca"}`,
                                background: it.na ? "#f9fafb" : it.ok ? "#f0fdf4" : "#fef2f2",
                                color: it.na ? "#9ca3af" : it.ok ? "#166534" : "#b91c1c",
                              }}>
                                {it.na ? "—" : it.ok ? "✓" : "○"} {it.n}
                                {it.n.startsWith("6") && t6 && ` (${t6.confirmadas}/${t6.total})`}
                              </span>
                            ))}
                          </div>

                          {/* Formulario inicial del supervisor (del día elegido) */}
                          {(filtroEvento === "todos" || filtroEvento === "bitacora") && (
                            <FormularioInicialSC scId={s.sc} fecha={fecha} />
                          )}

                          {/* ─── 6 · Confirmación de Terceros (independiente del formulario) ─── */}
                          {(filtroEvento === "todos" || filtroEvento === "bitacora") && (
                            <div style={{ marginTop: 8 }}>
                              <ItemTercerosBitacora scId={s.sc} fecha={fecha} />
                            </div>
                          )}

                          {/* ─── Rutas con helper (mismo día) ─── */}
                          {(filtroEvento === "todos" || filtroEvento === "helper") && (
                            <RutasHelperAprobar scId={s.sc} fecha={fecha} decididoPor={null} />
                          )}

                          {/* ─── Torre de Control del SC (mismo día) ─── */}
                          {(filtroEvento === "todos" || filtroEvento === "torre") && (
                            <TorreControlSC scId={s.sc} fecha={fecha} />
                          )}

                          {/* ─── Ambulancias del SC (mismo día) ─── */}
                          {(filtroEvento === "todos" || filtroEvento === "ambulancias") && (
                            <AmbulanciasSC scId={s.sc} fecha={fecha} />
                          )}

                          {/* ─── Patentes nuevas del SC (hoy) ─── */}
                          {(filtroEvento === "todos" || filtroEvento === "patentes") && (
                            <PatentesNuevasSC scId={s.sc} decididoPor={null} />
                          )}

                          {/* Contacto (para el WhatsApp futuro) */}
                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #e5e7eb", fontSize: 11, color: "#6b7280" }}>
                            📧 {s.email || "sin email"} · 📱 {s.telefono || "sin teléfono cargado"}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {supervisores.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 30, textAlign: "center", color: "#9ca3af" }}>No hay supervisores activos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function thPanel(align = "left") {
  return { padding: "10px 12px", textAlign: align, fontSize: 12, fontWeight: 700, color: "#374151" };
}

function tdPanel(align = "left") {
  return { padding: "10px 12px", textAlign: align, color: "#1f2937" };
}

function PoolMeliAmbulancias() {
  const [fecha, setFecha] = useState(fechaOperativaOffset(-1)); // ayer por defecto
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scFiltro, setScFiltro] = useState("TODOS");
  const [infoPatron, setInfoPatron] = useState(false); // tooltip de la columna Patrón
  const [excelDesde, setExcelDesde] = useState(fechaOperativaOffset(-1));
  const [excelHasta, setExcelHasta] = useState(fechaOperativaOffset(-1));
  const [excelBusy, setExcelBusy] = useState(false);

  // ─── Carga del día seleccionado ─────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error } = await sb
          .from("vw_ambulancias_diario")
          .select("*")
          .eq("fecha", fecha)
          .order("paquetes_traspasados", { ascending: false })
          .limit(5000);
        if (!alive) return;
        if (error) throw error;
        setFilas(data || []);
      } catch (e) {
        if (alive) setError(e.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [fecha]);

  const scsDisponibles = useMemo(() => {
    const set = new Set(filas.map(f => f.service_center_id).filter(Boolean));
    return ["TODOS", ...Array.from(set).sort()];
  }, [filas]);

  const filasFiltradas = useMemo(() =>
    filas.filter(f => scFiltro === "TODOS" || f.service_center_id === scFiltro),
    [filas, scFiltro]);

  const kpis = useMemo(() => {
    const traspasos = filasFiltradas.length;
    const paquetes = filasFiltradas.reduce((s, f) => s + (f.paquetes_traspasados || 0), 0);
    const conReceptor = filasFiltradas.filter(f => f.receptor_conocido).length;
    const swaps = filasFiltradas.filter(f => f.patron === "swap_reciproco").length;
    const sinReceptor = filasFiltradas
      .filter(f => !f.receptor_conocido)
      .reduce((s, f) => s + (f.paquetes_traspasados || 0), 0);
    return { traspasos, paquetes, conReceptor, swaps, sinReceptor };
  }, [filasFiltradas]);

  function ambEtiquetaPatron(p) {
    if (p === "swap_reciproco") return "Swap recíproco";
    if (p === "rescate_masivo") return "Rescate masivo";
    return "Rescate";
  }
  function ambColorPatron(p) {
    if (p === "swap_reciproco") return { bg: "#eef2ff", fg: "#3730a3" };
    if (p === "rescate_masivo") return { bg: "#fee2e2", fg: "#991b1b" };
    return { bg: "#fef3c7", fg: "#92400e" };
  }

  const exportarExcel = async () => {
    if (!excelDesde || !excelHasta) { alert("Elegí el rango de fechas para el Excel."); return; }
    const desde = excelDesde <= excelHasta ? excelDesde : excelHasta;
    const hasta = excelHasta >= excelDesde ? excelHasta : excelDesde;
    setExcelBusy(true);
    try {
      // Traer TODO el rango desde la vista (no solo el día en pantalla)
      const { data, error } = await sb
        .from("vw_ambulancias_diario")
        .select("*")
        .gte("fecha", desde).lte("fecha", hasta)
        .order("fecha")
        .order("paquetes_traspasados", { ascending: false })
        .limit(100000);
      if (error) throw error;
      const rango = (data || []).filter(f => scFiltro === "TODOS" || f.service_center_id === scFiltro);

      const headers = [
        "Fecha", "SC",
        "Ruta origen", "ENTREGÓ (driver)", "Patente origen",
        "Ruta destino", "RECIBIÓ (driver)", "Patente destino", "Receptor conocido",
        "Paquetes", "Patrón", "Hora inicio MX", "Hora fin MX", "Zona",
      ];
      const datos = rango.map(f => [
        f.fecha, f.service_center_id,
        f.ruta_origen, f.driver_origen || "—", f.patente_origen || "—",
        f.ruta_destino, f.driver_destino || "—", f.patente_destino || "—",
        f.receptor_conocido ? "Sí" : "No",
        f.paquetes_traspasados, ambEtiquetaPatron(f.patron),
        f.hora_inicio_mx, f.hora_fin_mx, f.ciudades || "—",
      ]);
      const totalPkgs = rango.reduce((acc, f) => acc + (f.paquetes_traspasados || 0), 0);
      const conReceptor = rango.filter(f => f.receptor_conocido).length;
      const swaps = rango.filter(f => f.patron === "swap_reciproco").length;
      const resumen = [
        ["Reporte", "Ambulancias · Entrega → Recibe"],
        ["Desde", desde], ["Hasta", hasta], ["SC", scFiltro],
        [""],
        ["Traspasos", rango.length], ["Paquetes traspasados", totalPkgs],
        ["Traspasos con receptor identificado", conReceptor],
        ["Swaps recíprocos", swaps],
      ];
      await descargarExcelMultihoja(
        [{ nombre: "Resumen", datos: resumen }, { nombre: "Detalle", datos: [headers, ...datos] }],
        `ambulancias_${desde === hasta ? desde : desde + "_a_" + hasta}`
      );
    } catch (e) {
      alert("Error al generar el Excel: " + (e.message || e));
    } finally {
      setExcelBusy(false);
    }
  };

  // Bloque "persona": nombre + (ruta · patente). Reusado para origen y destino.
  const ambPersona = ({ nombre, ruta, patente, origenDato, fechaDato }) => {
    // Solo es "desconocido" si no hay nombre de ninguna fuente
    if (!nombre) {
      return (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#c0392b" }}>Receptor desconocido</div>
          <div style={{ fontSize: 10.5, color: "#94a3b8" }}>ruta {ruta} · no scrapeada</div>
        </div>
      );
    }
    // Si el dato es histórico (no del día), lo marcamos como estimado
    const esEstimado = origenDato === "historico";
    let fechaTxt = "";
    if (esEstimado && fechaDato) {
      try {
        const d = new Date(fechaDato + "T12:00:00");
        fechaTxt = ` ${d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit" })}`;
      } catch { /* noop */ }
    }
    return (
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>
          {nombre}
          {esEstimado && (
            <span title={`Último driver conocido de esta ruta${fechaTxt ? " (" + fechaTxt.trim() + ")" : ""}. La ruta de rescate no se scrapea, este dato es el más reciente disponible.`}
              style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: "#fef3c7", color: "#92400e", textTransform: "uppercase", letterSpacing: 0.3 }}>
              est.{fechaTxt}
            </span>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
          ruta {ruta}{patente ? ` · ${patente}` : ""}
        </div>
      </div>
    );
  };

  const thAmb = (align) => ({
    padding: "8px 12px", fontSize: 10, color: "#6B7280", textTransform: "uppercase",
    letterSpacing: 0.4, fontWeight: 600, textAlign: align,
  });

  return (
    <div className="pg">
      <div className="sec-title">Ambulancias</div>
      <div className="sec-sub">Traspasos internos de paquetes ruta→ruta · quién entregó → quién recibió · conteo deduplicado</div>

      {/* Filtros */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Fecha de operación</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {[
            { l: "Ayer", fn: () => setFecha(fechaOperativaOffset(-1)) },
            { l: "Hoy", fn: () => setFecha(fechaHoyOperativa()) },
            { l: "-2 días", fn: () => setFecha(fechaOperativaOffset(-2)) },
            { l: "-3 días", fn: () => setFecha(fechaOperativaOffset(-3)) },
            { l: "-7 días", fn: () => setFecha(fechaOperativaOffset(-7)) },
          ].map(({ l, fn }) => (
            <button key={l} onClick={fn} style={{ padding: "5px 12px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#f8fafc", color: "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12 }} />
          <select value={scFiltro} onChange={e => setScFiltro(e.target.value)}
            style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12, fontWeight: 600, color: "#1a3a6b", cursor: "pointer" }}>
            {scsDisponibles.map(sc => (
              <option key={sc} value={sc}>{sc === "TODOS" ? "Todos los SC" : sc}</option>
            ))}
          </select>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Excel · rango:</span>
          <input type="date" value={excelDesde} onChange={e => setExcelDesde(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid #e4e7ec", fontSize: 12, color: "#1a1a1a" }} />
          <span style={{ fontSize: 11, color: "#888" }}>a</span>
          <input type="date" value={excelHasta} onChange={e => setExcelHasta(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid #e4e7ec", fontSize: 12, color: "#1a1a1a" }} />
          <button onClick={exportarExcel} disabled={excelBusy}
            style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid #16a34a", background: excelBusy ? "#9ca3af" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: excelBusy ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {excelBusy ? "⏳ Generando..." : "📥 Descargar Excel"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>⚠ {error}</div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#666", fontSize: 13 }}>Cargando ambulancias…</div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
            {[
              { label: "Traspasos", valor: kpis.traspasos, sub: "ruta → ruta", color: "#1a1a1a" },
              { label: "Paquetes movidos", valor: kpis.paquetes, sub: "deduplicados", color: "#1a3a6b" },
              { label: "Con receptor", valor: kpis.conReceptor, sub: "identificamos quién recibió", color: "#16a34a" },
              { label: "Swaps recíprocos", valor: kpis.swaps, sub: "rebalanceo entre hermanas", color: "#1a1a1a" },
              { label: "Sin receptor", valor: kpis.sinReceptor, sub: "pkgs · ruta sin scrapear", color: kpis.sinReceptor > 0 ? "#c0392b" : "#16a34a" },
            ].map((k) => (
              <div key={k.label} style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>{k.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: k.color, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{Number(k.valor).toLocaleString("es-MX")}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {filasFiltradas.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12 }}>
              Sin ambulancias para esta fecha y filtro.
            </div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                    <th style={thAmb("left")}>SC</th>
                    <th style={thAmb("left")}>Entregó (origen)</th>
                    <th style={thAmb("center")}>Paquetes</th>
                    <th style={thAmb("left")}>Recibió (destino)</th>
                    <th style={thAmb("left")}>Hora MX</th>
                    <th style={thAmb("left")}>Zona</th>
                    <th style={{ ...thAmb("left"), position: "relative" }}>
                      Patrón
                      <span
                        onMouseEnter={() => setInfoPatron(true)}
                        onMouseLeave={() => setInfoPatron(false)}
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 14, height: 14, marginLeft: 5, borderRadius: "50%",
                          border: "1px solid #94a3b8", color: "#64748b", fontSize: 9,
                          fontWeight: 700, cursor: "help", verticalAlign: "middle",
                          textTransform: "none", letterSpacing: 0,
                        }}>i</span>
                      {infoPatron && (
                        <div style={{
                          position: "absolute", top: "100%", left: 0, zIndex: 20, marginTop: 4,
                          width: 300, background: "#fff", border: "1px solid #e4e7ec",
                          borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                          padding: "10px 12px", textTransform: "none", letterSpacing: 0,
                          fontWeight: 400, color: "#1a1a1a", fontSize: 11, lineHeight: 1.5,
                        }}>
                          <div style={{ fontWeight: 700, color: "#1a3a6b", marginBottom: 6, fontSize: 11 }}>¿Qué significa cada patrón?</div>
                          <div style={{ marginBottom: 6 }}>
                            <span style={{ fontWeight: 700, color: "#991b1b" }}>Rescate masivo</span>: traspaso en un solo sentido de muchos paquetes (≥30) hacia una ruta de rescate dedicada. Una ruta que no dio abasto y mandó su carga a otra.
                          </div>
                          <div style={{ marginBottom: 6 }}>
                            <span style={{ fontWeight: 700, color: "#92400e" }}>Rescate</span>: traspaso en un solo sentido de pocos paquetes (&lt;30) a otra ruta.
                          </div>
                          <div>
                            <span style={{ fontWeight: 700, color: "#3730a3" }}>Swap recíproco</span>: rebalanceo entre rutas hermanas del mismo SC el mismo día; se pasan paquetes en ambos sentidos (A→B y B→A).
                          </div>
                        </div>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filasFiltradas.map((f, i) => {
                    const cp = ambColorPatron(f.patron);
                    return (
                      <tr key={`${f.ruta_origen}-${f.ruta_destino}-${i}`}
                        style={{ borderBottom: i === filasFiltradas.length - 1 ? "none" : "1px solid #e4e7ec" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 700, color: "#1a3a6b" }}>{f.service_center_id || "—"}</td>
                        <td style={{ padding: "10px 12px" }}>{ambPersona({ nombre: f.driver_origen, ruta: f.ruta_origen, patente: f.patente_origen })}</td>
                        <td style={{ padding: "10px 12px", textAlign: "center", whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-block", minWidth: 30, padding: "3px 10px", borderRadius: 14, background: "#1a3a6b", color: "#fff", fontWeight: 800, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{f.paquetes_traspasados}</span>
                          <div style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1, marginTop: 2 }}>→</div>
                        </td>
                        <td style={{ padding: "10px 12px" }}>{ambPersona({ nombre: f.driver_destino, ruta: f.ruta_destino, patente: f.patente_destino, origenDato: f.receptor_origen_dato, fechaDato: f.receptor_fecha_dato })}</td>
                        <td style={{ padding: "10px 12px", color: "#666", fontVariantNumeric: "tabular-nums" }}>
                          {f.hora_inicio_mx}{f.hora_fin_mx && f.hora_fin_mx !== f.hora_inicio_mx ? `–${f.hora_fin_mx}` : ""}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#666", maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                          title={`${f.ciudades || ""}${f.num_cps > 1 ? " · " + f.num_cps + " CP" : ""}`}>
                          {f.ciudades || "—"}{f.num_cps > 1 && <span style={{ color: "#94a3b8" }}> · {f.num_cps} CP</span>}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: cp.bg, color: cp.fg, textTransform: "uppercase", letterSpacing: 0.3 }}>{ambEtiquetaPatron(f.patron)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {kpis.sinReceptor > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: "#64748b", lineHeight: 1.6, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: "10px 14px" }}>
              <strong style={{ color: "#c0392b" }}>Sin receptor:</strong> {kpis.sinReceptor} paquetes llegaron a rutas de rescate que aún no scrapeamos, por eso no aparece quién recibió ni su patente. Para cerrarlo hay que capturar esas rutas destino en snapshots.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function _fechaUtcSem(iso) { return new Date(String(iso).slice(0, 10) + "T12:00:00Z"); }

function semanaInventario(fechaIso) {
  if (!fechaIso) return null;
  const d = _fechaUtcSem(fechaIso);
  if (isNaN(d.getTime())) return null;
  const off = (d.getUTCDay() + 6) % 7;
  const lunes = new Date(d.getTime() - off * 86400000);
  const ancla = _fechaUtcSem("2026-06-01");
  return 24 + Math.round((lunes.getTime() - ancla.getTime()) / (7 * 86400000));
}

function rangoSemanaInventario(sem) {
  const ancla = _fechaUtcSem("2026-06-01");
  const inicio = new Date(ancla.getTime() + (Number(sem) - 24) * 7 * 86400000);
  const fin = new Date(inicio.getTime() + 6 * 86400000);
  return { inicio, fin };
}

function etiquetaSemanaInventario(sem) {
  const M = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const { inicio, fin } = rangoSemanaInventario(sem);
  const di = inicio.getUTCDate(), mi = M[inicio.getUTCMonth()];
  const df = fin.getUTCDate(), mf = M[fin.getUTCMonth()];
  return mi === mf ? (di + "\u2013" + df + " " + mi) : (di + " " + mi + " \u2013 " + df + " " + mf);
}

function semanaInventarioEsActual(sem) {
  return semanaInventario(new Date().toISOString().slice(0, 10)) === Number(sem);
}

const SIN_EMPRESA = "SIN EMPRESA ASOCIADA";

const TRANSP_FORM_VACIO = { id: null, nombre: "", rfc: "", estado: "Activo", correo_to: "", correo_cc: "", correo_bcc: "", notas: "" };

const LOGO_PREFACTURA_B64 = "data:image/png;base64,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";

function HistorialPagoMX({ usuario }) {
  const [semana, setSemana] = useState(() => { const s = semanaInventario(fechaOperativaOffset(0)); return s != null ? s - 1 : 24; });
  const [loading, setLoading] = useState(false);
  const [d, setD] = useState({ prefacturas: [], eventos: [], saldos: [], reportes: [], noCreadas: [] });
  const fmtMon = (v) => "$ " + Math.round(Number(v || 0)).toLocaleString("es-CL");
  const fmtDT = (s) => { if (!s) return "\u2014"; try { return new Date(s).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (e) { return String(s).slice(0, 16); } };
  const cargar = async (sem) => {
    setLoading(true);
    try {
      const [pf, ev, sd, rc, res] = await Promise.all([
        sb.from("conciliaciones_terceros").select("*").eq("semana", sem),
        sb.from("conciliaciones_terceros_historial").select("*").eq("semana", sem).order("creado_at", { ascending: false }).limit(500),
        sb.from("saldos_pendientes_terceros").select("*").eq("estado", "pendiente"),
        sb.from("reportes_cierre").select("*").eq("semana", sem).order("generado_at", { ascending: false }),
        sb.rpc("get_conciliacion_terceros_resumen", { p_semana: sem }),
      ]);
      const prefacturas = pf.data || [];
      const creadas = new Set(prefacturas.map(r => `${r.empresa_nombre}||${r.service_center}`));
      const noCreadas = (res.data || []).filter(r => r.empresa && r.empresa !== "SIN EMPRESA" && Number(r.n_viajes || 0) > 0 && !creadas.has(`${r.empresa}||${r.service_center}`));
      setD({ prefacturas, eventos: ev.data || [], saldos: sd.data || [], reportes: rc.data || [], noCreadas });
    } catch (e) { console.error("historial pago:", e); }
    setLoading(false);
  };
  useEffect(() => { cargar(semana); }, [semana]);
  const descargarReporte = (rc) => {
    try {
      if (!rc.archivo_base64) return alert("Este reporte no tiene archivo guardado.");
      const bin = atob(rc.archivo_base64); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = rc.nombre_archivo || `reporte_sem${rc.semana}.xlsx`; a.click();
    } catch (e) { alert("No se pudo descargar: " + (e.message || e)); }
  };
  const porEstado = (st) => d.prefacturas.filter(r => (r.estado || "borrador") === st).length;
  const totNeto = d.prefacturas.reduce((s, r) => s + Number(r.total_neto || 0), 0);
  const totBruto = d.prefacturas.reduce((s, r) => s + Number(r.total_bruto || 0), 0);
  const evLabel = { crear: "Creada", recalcular: "Recalculada", editar: "Editada", cerrar: "Cerrada", cerrar_pendiente: "Cerrada (pendiente)", reabrir: "Reabierta", enviar: "Enviada", quitar_importados: "Quit\u00f3 importados", reporte_cierre: "Reporte de cierre", traspaso_salida: "Traspaso (salida)", traspaso_entrada: "Traspaso (entrada)" };
  const tbl = { width: "100%", borderCollapse: "collapse", fontSize: 12, background: "#fff" };
  const th = { textAlign: "left", padding: "6px 8px", color: "#64748b", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid #e4e7ec" };
  const tdS = { padding: "6px 8px", borderBottom: "1px solid #f1f5f9" };
  const btn = { padding: "4px 10px", border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 };
  const Seccion = ({ titulo, children }) => (<div style={{ marginBottom: 18 }}><div style={{ fontSize: 13, fontWeight: 800, color: "#1a3a6b", marginBottom: 8 }}>{titulo}</div><div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>{children}</div></div>);
  const Vacio = ({ txt }) => <div style={{ padding: 16, color: "#94a3b8", fontSize: 12 }}>{txt}</div>;
  const card = (label, val, color) => (<div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: "12px 14px", minWidth: 110 }}><div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", fontWeight: 700 }}>{label}</div><div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div></div>);
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#1a3a6b" }}>Historial de Pago</div>
        <button onClick={() => setSemana(s => s - 1)} style={{ padding: "6px 10px", border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>‹</button>
        <div style={{ textAlign: "center" }}><div style={{ fontWeight: 800, color: "#1a3a6b" }}>Semana {semana}</div><div style={{ fontSize: 11, color: "#64748b" }}>{etiquetaSemanaInventario(semana)}</div></div>
        <button onClick={() => setSemana(s => s + 1)} style={{ padding: "6px 10px", border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>›</button>
        <button onClick={() => cargar(semana)} style={{ padding: "6px 12px", border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>↻ Actualizar</button>
      </div>
      {loading ? <div style={{ color: "#64748b" }}>Cargando…</div> : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            {card("Creadas", d.prefacturas.length, "#1a3a6b")}
            {card("Cerradas", porEstado("cerrada"), "#166534")}
            {card("Enviadas", porEstado("enviada"), "#1e40af")}
            {card("Pend. concil.", porEstado("pendiente_conciliacion"), "#9a3412")}
            {card("Borrador", porEstado("borrador"), "#854d0e")}
            {card("No creadas", d.noCreadas.length, "#dc2626")}
            {card("Neto", fmtMon(totNeto), "#16a34a")}
            {card("Bruto", fmtMon(totBruto), "#0f172a")}
          </div>
          <Seccion titulo={`Reportes de cierre (${d.reportes.length})`}>
            {d.reportes.length === 0 ? <Vacio txt={`A\u00fan no se gener\u00f3 el informe de cierre de esta semana (se crea al "Cerrar todo").`} /> : (
              <table style={tbl}><thead><tr>{["Generado", "Por", "Prefacturas", "Bruto", "Enviado", "Destinatarios", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{d.reportes.map(rc => (<tr key={rc.id}>
                <td style={tdS}>{fmtDT(rc.generado_at)}</td><td style={tdS}>{rc.generado_por || "\u2014"}</td><td style={tdS}>{rc.n_prefacturas}</td>
                <td style={{ ...tdS, textAlign: "right" }}>{fmtMon(rc.total_bruto)}</td><td style={tdS}>{rc.enviado ? "\u2705" : "\u26A0\uFE0F no"}</td>
                <td style={{ ...tdS, fontSize: 10, color: "#64748b", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rc.destinatarios}</td>
                <td style={tdS}><button onClick={() => descargarReporte(rc)} style={btn}>⬇ Descargar</button></td>
              </tr>))}</tbody></table>
            )}
          </Seccion>
          <Seccion titulo={`Saldos pendientes de conciliaci\u00f3n (${d.saldos.length})`}>
            {d.saldos.length === 0 ? <Vacio txt="No hay saldos negativos arrastr\u00e1ndose." /> : (
              <table style={tbl}><thead><tr>{["Empresa", "SC", "Origen sem.", "Saldo pendiente", "Estado"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{d.saldos.map(s => (<tr key={s.id}>
                <td style={tdS}>{s.empresa_nombre}</td><td style={tdS}>{s.service_center}</td><td style={tdS}>{s.semana_origen}</td>
                <td style={{ ...tdS, textAlign: "right", color: "#dc2626", fontWeight: 700 }}>{fmtMon(s.saldo_pendiente)}</td><td style={tdS}>{s.estado}</td>
              </tr>))}</tbody></table>
            )}
          </Seccion>
          {d.noCreadas.length > 0 && (
          <Seccion titulo={`Operaron sin prefactura creada (${d.noCreadas.length})`}>
            <table style={tbl}><thead><tr>{["Empresa", "SC", "Viajes", "Neto"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{d.noCreadas.map((r, i) => (<tr key={i}>
              <td style={tdS}>{r.empresa}</td><td style={tdS}>{r.service_center}</td><td style={tdS}>{r.n_viajes}</td><td style={{ ...tdS, textAlign: "right" }}>{fmtMon(r.total_neto)}</td>
            </tr>))}</tbody></table>
          </Seccion>
          )}
          <Seccion titulo={`Bit\u00e1cora de cambios (${d.eventos.length})`}>
            {d.eventos.length === 0 ? <Vacio txt="Sin eventos registrados esta semana." /> : (
              <table style={tbl}><thead><tr>{["Fecha", "Empresa", "SC", "Evento", "Usuario", "Neto", "L\u00edquido"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{d.eventos.map(e => (<tr key={e.id}>
                <td style={tdS}>{fmtDT(e.creado_at)}</td><td style={tdS}>{e.empresa_nombre}</td><td style={tdS}>{e.service_center}</td>
                <td style={tdS}><span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 8, background: "#f1f5f9", color: "#334155" }}>{evLabel[e.evento] || e.evento}</span></td>
                <td style={tdS}>{e.usuario || "\u2014"}</td>
                <td style={{ ...tdS, textAlign: "right" }}>{e.total_neto != null ? fmtMon(e.total_neto) : "\u2014"}</td>
                <td style={{ ...tdS, textAlign: "right" }}>{e.liquido_pago != null ? fmtMon(e.liquido_pago) : "\u2014"}</td>
              </tr>))}</tbody></table>
            )}
          </Seccion>
        </>
      )}
    </div>
  );
}

function ConciliacionTercerosMX({ usuario }) {
  const [semana, setSemana] = useState(() => {
    const s = semanaInventario(fechaOperativaOffset(0));
    return s != null ? s - 1 : 24; // por defecto: última semana cerrada
  });
  const [resumen, setResumen] = useState([]);          // 1 fila por empresa+SC
  const [ajustesEmp, setAjustesEmp] = useState({});    // norm(empresa) -> n cambios (ediciones + importados + ajustes)
  const [ajustesSC, setAjustesSC] = useState({});      // norm(empresa)||norm(sc) -> n ajustes
  const [loading, setLoading] = useState(true);
  const [expandida, setExpandida] = useState(null);    // nombre de empresa abierta
  const [detalles, setDetalles] = useState({});        // empresa -> filas (todos los SC)
  const [auxMap, setAuxMap] = useState({});            // id_ruta -> { decision, motivo } (aprobaciones_helper)
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [transportistas, setTransportistas] = useState([]); // prefacturas_transportistas_mx
  const [parametros, setParametros] = useState([]);         // prefacturas_parametros_mx
  const [formTransp, setFormTransp] = useState(null);  // null = modal cerrado
  const [guardandoTransp, setGuardandoTransp] = useState(false);
  const [asignacionSel, setAsignacionSel] = useState({}); // placa -> empresa
  const [asignando, setAsignando] = useState(null);
  const [cerrando, setCerrando] = useState(null);      // "empresa||SC" en proceso
  const [msg, setMsg] = useState(null);
  const [cobrosPorSC, setCobrosPorSC] = useState({});   // empresa -> { sc: cobros }
  const [saldosPorSC, setSaldosPorSC] = useState({});   // "empresa||sc" -> { pendiente, semanaOrigen } (arrastre de negativos)
  const [placasViejas, setPlacasViejas] = useState({}); // placa -> primera semana que apareció sin empresa (anteriores)
  const [aplicManual, setAplicManual] = useState({}); // "empresa||scDestino" -> [{ origenSC, origenSem, monto, origenKey }] (saldos de otro SC aplicados a mano)
  const [pausados, setPausados] = useState([]); // rutas con pago pausado (Listado de Pagos), pendientes de liberar
  const cargarPausados = async () => {
    try {
      const { data } = await sb.from("maestro_jornada_mx").select("id, fecha, driver_name, placa, id_ruta, service_center_id, pago_neto, pausa_motivo, pausa_por, pausa_at").eq("pausado", true).order("fecha", { ascending: false }).limit(3000);
      setPausados(data || []);
    } catch (e) { console.error("pausados concil:", e); setPausados([]); }
  };
  useEffect(() => { cargarPausados(); }, []);
  const activarPausado = async (r) => {
    if (!confirm(`\u00bfActivar (liberar) el pago de ${r.driver_name || r.placa} \u00b7 ruta ${r.id_ruta} del ${r.fecha}?`)) return;
    try {
      const por = (usuario && (usuario.nombre || usuario.email)) || "Brain";
      const { error } = await sb.from("maestro_jornada_mx").update({ pausado: false, liberado_at: new Date().toISOString(), liberado_por: por }).eq("id", r.id);
      if (error) throw error;
      cargarPausados();
    } catch (e) { alert("Error activando: " + (e.message || e)); }
  };
  const pausadosSet = new Set((pausados || []).map(p => String(p.id_ruta)));
  const [formLinea, setFormLinea] = useState(null);     // alta de línea (ajuste/viaje) o null
  const [guardandoEdit, setGuardandoEdit] = useState(null); // clave empresa||sc en proceso
  const [seleccion, setSeleccion] = useState(() => new Set()); // claves cerradas marcadas para envío masivo
  const [enviando, setEnviando] = useState(null);              // clave o "__lote__"
  const [modalEnvio, setModalEnvio] = useState(null);          // confirmación de envío individual
  const [repRows, setRepRows] = useState(null);                // rutas con ID repetido en la semana
  const [consolidadas, setConsolidadas] = useState(() => new Set()); // claves empresa||sc||id_ruta ya consolidadas
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [repBusy, setRepBusy] = useState(false);
  const [consolidando, setConsolidando] = useState(null);      // id_ruta | "__todas__"
  const [traspRows, setTraspRows] = useState(null);            // placas en 2+ empresas en la semana
  const [traspBusy, setTraspBusy] = useState(false);
  const [trasp, setTrasp] = useState(null);                    // modal traspasador { placa, cargando, grupos, sel, destino }
  const [traspasando, setTraspasando] = useState(false);
  const [asuntoLote, setAsuntoLote] = useState(() => { try { return localStorage.getItem("conc_mx_asunto") || ASUNTO_DEFAULT; } catch { return ASUNTO_DEFAULT; } });
  const [cuerpoLote, setCuerpoLote] = useState(() => { try { return localStorage.getItem("conc_mx_cuerpo") || CUERPO_DEFAULT; } catch { return CUERPO_DEFAULT; } });
  const [editorCorreoOpen, setEditorCorreoOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem("conc_mx_asunto", asuntoLote); } catch {} }, [asuntoLote]);
  useEffect(() => { try { localStorage.setItem("conc_mx_cuerpo", cuerpoLote); } catch {} }, [cuerpoLote]);
  const aplicarVarsCorreo = (txt, empresa, sc, periodo, operacion) => String(txt || "").replace(/\{TRANSPORTISTA\}/g, empresa || "").replace(/\{CECO\}/g, sc || "").replace(/\{PERIODO\}/g, periodo || "").replace(/\{OPERACION\}/g, operacion || "");

  const norm = (s) => String(s || "").trim().toUpperCase();
  const fmtMon = (v) => "$ " + Math.round(Number(v || 0)).toLocaleString("es-CL");
  const fmtPct = (v) => (v == null ? "—" : Number(v).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%");
  const fmtKm = (v) => (v == null ? "—" : Number(v).toLocaleString("es-CL", { maximumFractionDigits: 1 }));
  const fmtFactor = (v) => Number(v || 0).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtFechaDDMM = (iso) => { const s = String(iso || "").slice(0, 10); const [y, m, d] = s.split("-"); return d && m && y ? `${d}-${m}-${y}` : s; };

  const transpPorNorm = useMemo(() => {
    const m = {}; for (const t of transportistas) m[norm(t.nombre)] = t; return m;
  }, [transportistas]);
  const paramPorSC = useMemo(() => {
    const m = {}; for (const p of parametros) m[norm(p.ceco)] = p; return m;
  }, [parametros]);

  const cargarResumen = async (sem) => {
    setLoading(true); setMsg(null);
    try {
      const { data, error } = await sb.rpc("get_conciliacion_terceros_resumen", { p_semana: sem });
      if (error) throw error;
      const base = data || [];
      setResumen(base);
      // Una sola lectura de conciliaciones guardadas: (a) cuenta ajustes; (b) muestra empresas creadas a mano que el resumen no trae
      try {
        const { data: concs } = await sb.from("conciliaciones_terceros").select("*").eq("semana", sem);
        const mapE = {}, mapS = {};
        const have = new Set(base.map(r => `${norm(r.empresa)}||${norm(r.service_center)}`));
        const extra = [];
        for (const c of (concs || [])) {
          const det = Array.isArray(c.detalle) ? c.detalle : [];
          const nA = det.filter(d => d && !d._saldo && (d._editado || d.es_manual || d.origen === "ajuste")).length;
          if (nA) { mapE[norm(c.empresa_nombre)] = (mapE[norm(c.empresa_nombre)] || 0) + nA; mapS[`${norm(c.empresa_nombre)}||${norm(c.service_center)}`] = nA; }
          const k = `${norm(c.empresa_nombre)}||${norm(c.service_center)}`;
          if (!have.has(k)) {
            const tt = transpPorNorm[norm(c.empresa_nombre)] || {};
            extra.push({ empresa: c.empresa_nombre, service_center: c.service_center,
              n_viajes: c.n_viajes != null ? c.n_viajes : det.length, n_no_pago: c.n_no_pago != null ? c.n_no_pago : det.filter(d => d.es_no_pago).length,
              total_neto: c.total_neto || 0, total_bruto: c.total_bruto || 0, neto_guardado: c.total_neto || 0, bruto_guardado: c.total_bruto || 0,
              estado_conciliacion: c.estado || "borrador", tiene_ajustes: !!c.tiene_ajustes, supervisor: null,
              rfc: tt.rfc || "", correo_to: tt.correo_to || "", enviado_at: c.enviado_at || null });
          }
        }
        // Arrastre de negativos: mostrar empresas con saldo pendiente aunque no tengan viajes esta semana
        const saldoMap = await cargarSaldos(sem);
        await cargarPlacasViejas(sem);
        const have2 = new Set([...base, ...extra].map(r => `${norm(r.empresa)}||${norm(r.service_center)}`));
        for (const k in saldoMap) {
          if (have2.has(k)) continue;
          const sObj = saldoMap[k]; const tt = transpPorNorm[norm(sObj.empresa)] || {};
          extra.push({ empresa: sObj.empresa, service_center: sObj.sc, n_viajes: 0, n_no_pago: 0, total_neto: 0, total_bruto: 0, neto_guardado: 0, bruto_guardado: 0,
            estado_conciliacion: "pendiente_conciliacion", tiene_ajustes: false, supervisor: null, rfc: tt.rfc || "", correo_to: tt.correo_to || "", enviado_at: null, _soloSaldo: true });
        }
        setAjustesEmp(mapE); setAjustesSC(mapS);
        if (extra.length) setResumen([...base, ...extra]);
      } catch (er) { console.error("conteo/merge conciliaciones:", er); setAjustesEmp({}); setAjustesSC({}); }
    } catch (e) {
      console.error("resumen conciliación:", e);
      setMsg({ ok: false, txt: "Error cargando resumen: " + (e.message || e) });
      setResumen([]);
    }
    setLoading(false);
  };

  const cargarMaestros = async () => {
    try {
      const [t, p] = await Promise.all([
        sb.from("prefacturas_transportistas_mx").select("*").order("nombre"),
        sb.from("prefacturas_parametros_mx").select("*").order("ceco"),
      ]);
      setTransportistas(t.data || []);
      setParametros(p.data || []);
    } catch (e) { console.error("maestros prefacturas:", e); }
  };

  useEffect(() => { cargarResumen(semana); setConsolidadas(new Set()); cargarRepetidas(semana); cargarAux(semana); setExpandida(null); setDetalles({}); setAsignacionSel({}); setTrasp(null); setTraspRows(null); cargarTraspasos(semana); }, [semana]);
  useEffect(() => { cargarMaestros(); }, []);

  const cargarDetalle = async (empresa) => {
    if (detalles[empresa]) return;
    setLoadingDetalle(true);
    try {
      // p_sc = null -> trae todos los SC de la empresa; agrupamos en cliente
      const { data, error } = await sb.rpc("get_conciliacion_terceros_detalle", { p_semana: semana, p_empresa: empresa, p_sc: null });
      if (error) throw error;
      let filas = (data || []).map(d => ({ ...d, _id: lineaId(d), origen: d.origen || "motor" }));
      const { data: conc } = await sb.from("conciliaciones_terceros")
        .select("service_center, detalle, total_cobros").eq("empresa_nombre", empresa).eq("semana", semana);
      if (conc && conc.length) {
        const cobros = {}; for (const c of conc) cobros[c.service_center] = Number(c.total_cobros || 0);
        setCobrosPorSC(prev => ({ ...prev, [empresa]: cobros }));
        const editados = conc.filter(c => Array.isArray(c.detalle) && c.detalle.length);
        if (editados.length) {
          const scs = new Set(editados.map(c => c.service_center));
          filas = filas.filter(f => !scs.has(f.service_center_id || "SIN SC"));
          for (const c of editados) for (const ln of c.detalle) filas.push({ ...ln, _id: ln._id || lineaId(ln), origen: ln.origen || "motor" });
        }
      }
      setDetalles(prev => ({ ...prev, [empresa]: filas }));
    } catch (e) {
      console.error("detalle conciliación:", e);
      setMsg({ ok: false, txt: "Error cargando detalle de " + empresa + ": " + (e.message || e) });
    }
    setLoadingDetalle(false);
  };

  const toggleEmpresa = (empresa) => {
    if (expandida === empresa) { setExpandida(null); return; }
    setExpandida(empresa); cargarDetalle(empresa);
  };

  const refrescarTodo = async () => {
    setDetalles({}); setAsignacionSel({});
    await Promise.all([cargarResumen(semana), cargarMaestros()]);
  };

  // ── Agregar las filas de empresa+SC del resumen en un objeto por empresa ──
  const empresasAgrupadas = useMemo(() => {
    const out = {}; // empresa -> { filasSC:[], totalNeto, totalBruto, nViajes, nNoPago, nPlacas:Set }
    for (const r of resumen) {
      if (!out[r.empresa]) out[r.empresa] = { empresa: r.empresa, filasSC: [], totalNeto: 0, totalBruto: 0, totalIva: 0, nViajes: 0, nNoPago: 0, placas: new Set(), rfc: r.rfc, correo_to: r.correo_to };
      const g = out[r.empresa];
      g.filasSC.push(r);
      g.totalNeto += Number((r.neto_guardado != null ? r.neto_guardado : r.total_neto) || 0);
      g.totalBruto += Number((r.bruto_guardado != null ? r.bruto_guardado : r.total_bruto) || 0);
      g.totalIva += Number(r.iva_16 || 0);
      g.nViajes += Number(r.n_viajes || 0);
      g.nNoPago += Number(r.n_no_pago || 0);
    }
    // n_placas a nivel empresa: sumamos placas distintas (aprox: suma de SC, puede repetir placa entre SC)
    for (const g of Object.values(out)) g.nPlacas = g.filasSC.reduce((s, f) => s + Number(f.n_placas || 0), 0);
    const arr = Object.values(out);
    arr.sort((a, b) => (a.empresa === SIN_EMPRESA ? -1 : b.empresa === SIN_EMPRESA ? 1 : b.totalNeto - a.totalNeto));
    return arr;
  }, [resumen]);

  const claveCierre = (empresa, sc) => `${empresa}||${sc}`;

  // ── Edición de líneas: capa de ajuste sobre el detalle del motor ──
  const lineaId = (d) => d._id || `m|${String(d.fecha||"").slice(0,10)}|${d.placa||""}|${d.id_ruta||""}|${d.service_center_id||""}`;
  const recalcSC = (filas, cobros) => {
    const reales = (filas || []).filter(d => !d._saldo);
    const neto = Math.round((filas || []).reduce((s, d) => s + Number(d.monto || 0), 0) * 100) / 100;
    const neg = neto < 0;
    const iva = neg ? 0 : Math.round(neto * 0.16 * 100) / 100;
    const bruto = neg ? neto : Math.round(neto * 1.16 * 100) / 100;
    const c = Number(cobros || 0);
    const liquido = Math.round((bruto - c) * 100) / 100;
    return { neto, iva, bruto, cobros: c, liquido, negativo: neg, nViajes: reales.length, nNoPago: reales.filter(d => d.es_no_pago).length };
  };
  const cobrosDe = (empresa, sc) => Number((cobrosPorSC[empresa] || {})[sc] || 0);
  const saldoPrevioDe = (empresa, sc) => Number((saldosPorSC[`${norm(empresa)}||${norm(sc)}`] || {}).pendiente || 0);
  const saldoEmpresa = (empresa) => Object.entries(saldosPorSC).reduce((s, [k, v]) => s + (k.startsWith(norm(empresa) + "||") ? Number(v.pendiente || 0) : 0), 0);
  const saldoInfoDe = (empresa, sc) => saldosPorSC[`${norm(empresa)}||${norm(sc)}`] || null;
  const consolidarSaldoManual = async (empresa, sc) => {
    const si = saldoInfoDe(empresa, sc); const monto = si ? si.pendiente : 0;
    const motivo = window.prompt(`Consolidar (eliminar) el saldo de ${empresa} \u00b7 ${sc}: ${fmtMon(monto)}.\n\nQueda cerrado por acuerdo: deja de arrastrarse y ya no afecta los netos.\n\nMotivo del acuerdo:`, "");
    if (motivo === null) return;
    try {
      const { data: row } = await sb.from("saldos_pendientes_terceros").select("*").eq("empresa_nombre", empresa).eq("service_center", sc).maybeSingle();
      if (!row) { alert("No se encontr\u00f3 el saldo en la base."); return; }
      const det = (row.detalle && typeof row.detalle === "object") ? row.detalle : {};
      det.liquidado_hasta = semana; det.consolidado_manual = true; det.motivo_consolidacion = motivo || ""; det.consolidado_por = (usuario && (usuario.nombre || usuario.email)) || "Brain";
      const { error } = await sb.from("saldos_pendientes_terceros").update({ estado: "consolidado", saldo_pendiente: 0, semana_conciliacion: semana, conciliado_at: new Date().toISOString(), detalle: det }).eq("id", row.id);
      if (error) throw error;
      // borrar la prefactura negativa (pendiente_conciliacion) de esta semana si existe
      await sb.from("conciliaciones_terceros").delete().eq("empresa_nombre", empresa).eq("service_center", sc).eq("semana", semana).eq("estado", "pendiente_conciliacion");
      try { await logEvento(empresa, sc, "consolidar_saldo", { neto: monto }, { estado: "consolidado", detalle: { manual: true, motivo } }); } catch (e) {}
      setMsg({ ok: true, txt: `Saldo de ${empresa} \u00b7 ${sc} consolidado (${fmtMon(monto)}). Ya no se arrastra ni suma.` });
      await cargarResumen(semana);
    } catch (e) { alert("Error consolidando: " + (e.message || e)); }
  };
  const netoSCneteado = (empresa, rSC, esSin) => {
    const det = detalles[empresa];
    if (det) {
      const base = det.filter(d => (d.service_center_id || "SIN SC") === rSC.service_center && !pausadosSet.has(String(d.id_ruta)));
      const full = filasConSaldoLine(empresa, rSC.service_center, base);
      return recalcSC(full, esSin ? 0 : cobrosDe(empresa, rSC.service_center)).neto;
    }
    const nv = Number(rSC.neto_guardado != null ? rSC.neto_guardado : rSC.total_neto) || 0;
    if (esSin) return nv;
    const prev = saldoPrevioDe(empresa, rSC.service_center);
    const man = lineasManualesDe(empresa, rSC.service_center).reduce((a, d) => a + Number(d.monto || 0), 0);
    return Math.round((nv + prev + man) * 100) / 100;
  };
  const lineasManualesDe = (empresa, sc) => (aplicManual[`${norm(empresa)}||${norm(sc)}`] || []).map(a => ({ _saldo: true, _manual: true, _id: "saldoM|" + a.origenSC, _origenSC: a.origenSC, _origenKey: a.origenKey, _origenSem: a.origenSem, origen: "saldo_manual", fecha: null, placa: "\u2014", id_ruta: "", driver_name: `Saldo aplicado de ${a.origenSC} (sem ${a.origenSem})`, service_center_id: sc, tiene_auxiliar: false, cargado: null, entregado: null, monto: Number(a.monto || 0), es_no_pago: false }));
  const filasConSaldoLine = (empresa, sc, filas) => {
    const arr = (filas || []).filter(d => !(d._saldo && !d._manual)); // quita la línea auto; conserva manuales ya guardadas
    const prev = saldoPrevioDe(empresa, sc);
    if (prev < 0 && !arr.some(d => d._saldo && !d._manual)) {
      const si = saldoInfoDe(empresa, sc);
      arr.push({ _saldo: true, _id: "saldo|" + sc, origen: "saldo", fecha: null, placa: "\u2014", id_ruta: "", driver_name: `Saldo conciliaci\u00f3n arrastrado (sem ${si ? si.semanaOrigen : ""})`, service_center_id: sc, tiene_auxiliar: false, cargado: null, entregado: null, monto: prev, es_no_pago: false });
    }
    const have = new Set(arr.filter(d => d._manual).map(d => d._origenSC));
    for (const ln of lineasManualesDe(empresa, sc)) if (!have.has(ln._origenSC)) arr.push(ln);
    return arr;
  };
  const saldosOtrosSC = (empresa, sc) => Object.keys(saldosPorSC).filter(k => k.startsWith(norm(empresa) + "||")).map(k => saldosPorSC[k]).filter(si => si && si.pendiente < 0 && norm(si.sc) !== norm(sc));
  const aplicadoManual = (empresa, sc, origenSC) => (aplicManual[`${norm(empresa)}||${norm(sc)}`] || []).some(a => a.origenSC === origenSC);
  const aplicarSaldoManual = (empresa, sc, origenSC) => {
    const si = saldoInfoDe(empresa, origenSC); if (!si || !(si.pendiente < 0)) return;
    const tk = `${norm(empresa)}||${norm(sc)}`;
    setAplicManual(prev => ({ ...prev, [tk]: [...((prev[tk] || []).filter(a => a.origenSC !== origenSC)), { origenSC, origenSem: si.semanaOrigen, monto: si.pendiente, origenKey: `${norm(empresa)}||${norm(origenSC)}` }] }));
  };
  const quitarSaldoManual = (empresa, sc, origenSC) => {
    const tk = `${norm(empresa)}||${norm(sc)}`;
    setAplicManual(prev => ({ ...prev, [tk]: (prev[tk] || []).filter(a => a.origenSC !== origenSC) }));
  };
  const conciliarSaldoManual = async (empresa, origenSC, targetSC) => {
    try {
      const { data: row } = await sb.from("saldos_pendientes_terceros").select("*").eq("empresa_nombre", empresa).eq("service_center", origenSC).maybeSingle();
      if (!row) return;
      const det = (row.detalle && typeof row.detalle === "object") ? row.detalle : {};
      det.liquidado_hasta = semana; det.aplicado_a = { sc: targetSC, sem: semana };
      await sb.from("saldos_pendientes_terceros").update({ estado: "conciliado", saldo_pendiente: 0, semana_conciliacion: semana, conciliado_at: new Date().toISOString(), detalle: det }).eq("id", row.id);
    } catch (e) { console.error("conciliar saldo manual:", e); }
  };
  const cargarSaldos = async (sem) => {
    try {
      const { data } = await sb.from("saldos_pendientes_terceros").select("*");
      const map = {};
      for (const row of (data || [])) {
        const det = (row.detalle && typeof row.detalle === "object") ? row.detalle : {};
        const aplic = det.aplicaciones || {}; const liq = Number(det.liquidado_hasta || 0);
        let prev = 0; for (const w in aplic) { const ww = Number(w); if (ww > liq && ww < sem) prev += Number(aplic[w] || 0); }
        prev = Math.round(prev * 100) / 100;
        if (prev < 0) map[`${norm(row.empresa_nombre)}||${norm(row.service_center)}`] = { pendiente: prev, semanaOrigen: row.semana_origen, empresa: row.empresa_nombre, sc: row.service_center, aplicaciones: aplic, liquidadoHasta: liq };
      }
      setSaldosPorSC(map); return map;
    } catch (e) { console.error("cargar saldos:", e); setSaldosPorSC({}); return {}; }
  };
  const persistirSaldoCierre = async (empresa, sc, netoViajes) => {
    try {
      const { data: row } = await sb.from("saldos_pendientes_terceros").select("*").eq("empresa_nombre", empresa).eq("service_center", sc).maybeSingle();
      const det = (row && row.detalle && typeof row.detalle === "object") ? row.detalle : {};
      const aplic = { ...(det.aplicaciones || {}) }; const liq = Number(det.liquidado_hasta || 0);
      aplic[String(semana)] = Number(netoViajes || 0);
      let prev = 0; for (const w in aplic) { const ww = Number(w); if (ww > liq && ww < semana) prev += Number(aplic[w] || 0); }
      const neteado = Math.round((prev + Number(netoViajes || 0)) * 100) / 100;
      const lunes = rangoSemanaInventario(semana).inicio.toISOString().slice(0, 10);
      const dom = rangoSemanaInventario(semana).fin.toISOString().slice(0, 10);
      let estado, saldoPend, nuevoLiq = liq, semConc = null, concAt = null, semOrigen;
      if (neteado >= 0) { estado = "conciliado"; saldoPend = 0; nuevoLiq = semana; semConc = semana; concAt = new Date().toISOString(); semOrigen = (row && row.semana_origen) || semana; }
      else { estado = "pendiente"; saldoPend = neteado; semOrigen = (row && row.semana_origen) ? Math.min(row.semana_origen, semana) : semana; }
      const payload = { empresa_nombre: empresa, service_center: sc, semana_origen: semOrigen, semana_inicio_orig: lunes, semana_fin_orig: dom,
        monto_original: (row && row.monto_original != null) ? row.monto_original : neteado, saldo_pendiente: saldoPend, estado,
        semana_conciliacion: semConc, detalle: { aplicaciones: aplic, liquidado_hasta: nuevoLiq }, conciliado_at: concAt };
      if (row) await sb.from("saldos_pendientes_terceros").update(payload).eq("id", row.id);
      else await sb.from("saldos_pendientes_terceros").insert(payload);
    } catch (e) { console.error("persistir saldo cierre:", e); }
  };
  const cargarPlacasViejas = async (sem) => {
    try {
      const { data } = await sb.from("placas_sin_empresa").select("placa, semana").lt("semana", sem);
      const map = {}; for (const r of (data || [])) { if (!map[r.placa] || r.semana < map[r.placa]) map[r.placa] = r.semana; }
      setPlacasViejas(map);
    } catch (e) { console.error("placas viejas:", e); setPlacasViejas({}); }
  };
  const guardarPlacasSinEmpresa = async () => {
    try {
      const { data } = await sb.rpc("get_conciliacion_terceros_detalle", { p_semana: semana, p_empresa: SIN_EMPRESA, p_sc: null });
      const filas = data || []; if (!filas.length) return;
      const porP = {}; for (const f of filas) { const p = f.placa || "\u2014"; (porP[p] = porP[p] || []).push(f); }
      const lunes = rangoSemanaInventario(semana).inicio.toISOString().slice(0, 10);
      const dom = rangoSemanaInventario(semana).fin.toISOString().slice(0, 10);
      for (const placa in porP) {
        const fl = porP[placa]; const neto = fl.reduce((s, f) => s + Number(f.monto || 0), 0);
        const payload = { placa, semana, semana_inicio: lunes, semana_fin: dom, n_viajes: fl.length, neto, estado: "sin_empresa",
          detalle: { scs: [...new Set(fl.map(f => f.service_center_id).filter(Boolean))], conductores: [...new Set(fl.map(f => f.driver_name).filter(Boolean))] } };
        const { data: ex } = await sb.from("placas_sin_empresa").select("id").eq("placa", placa).eq("semana", semana).maybeSingle();
        if (ex) await sb.from("placas_sin_empresa").update(payload).eq("id", ex.id);
        else await sb.from("placas_sin_empresa").insert(payload);
      }
    } catch (e) { console.error("guardar placas sin empresa:", e); }
  };
  const inpEdit = (w) => ({ width: w, padding: "6px 8px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 12 });

  const auditarAjuste = async (empresa, sc, accion, origen_linea, linea, motivo) => {
    try {
      await sb.from("conciliacion_terceros_ajustes").insert({
        empresa_nombre: empresa, service_center: sc, semana, accion,
        origen_linea: origen_linea || null, linea: linea || null, motivo: motivo || null,
        usuario: (usuario && (usuario.nombre || usuario.email)) || "Brain",
      });
    } catch (e) { console.error("auditar ajuste:", e); }
  };
  // Historial de ciclo de vida de la prefactura (crear/cerrar/reabrir/enviar/recalcular)
  const logEvento = async (empresa, sc, evento, tot, extra) => {
    try {
      await sb.from("conciliaciones_terceros_historial").insert({
        empresa_nombre: empresa, service_center: sc, semana, evento,
        usuario: (usuario && (usuario.nombre || usuario.email)) || "Brain",
        total_neto: tot ? tot.neto : null, total_bruto: tot ? tot.bruto : null,
        liquido_pago: tot ? tot.liquido : null, n_viajes: tot ? tot.nViajes : null,
        estado: (extra && extra.estado) || null, detalle_evento: (extra && extra.detalle) || null,
      });
    } catch (e) { console.error("log historial:", e); }
  };

  const guardarBorradorSC = async (empresa, sc, filasSCnuevas, cobros) => {
    const lunes = rangoSemanaInventario(semana).inicio.toISOString().slice(0, 10);
    const tot = recalcSC(filasSCnuevas, cobros);
    const { error } = await sb.from("conciliaciones_terceros").upsert({
      empresa_nombre: empresa, service_center: sc, semana, semana_inicio: lunes, estado: "borrador",
      total_neto: tot.neto, iva_16: tot.iva, total_bruto: tot.bruto, total_cobros: tot.cobros, liquido_pago: tot.liquido,
      n_viajes: tot.nViajes, n_no_pago: tot.nNoPago, detalle: filasSCnuevas, tiene_ajustes: true,
      generado_at: new Date().toISOString(),
    }, { onConflict: "empresa_nombre,service_center,semana" });
    if (error) throw error;
  };

  const filasDeSC = (empresa, sc) => (detalles[empresa] || []).filter(d => (d.service_center_id || "SIN SC") === sc);

  const eliminarLinea = async (empresa, sc, linea) => {
    const motivo = window.prompt(`Motivo para eliminar esta línea (${linea.placa || ""} · ${fmtFechaDDMM(linea.fecha)} · ruta ${linea.id_ruta || "—"} · ${fmtMon(linea.monto)}):`, "");
    if (motivo === null) return;
    const clave = claveCierre(empresa, sc); setGuardandoEdit(clave);
    try {
      const id = lineaId(linea);
      const todas = (detalles[empresa] || []).filter(d => lineaId(d) !== id);
      const filasSC = todas.filter(d => (d.service_center_id || "SIN SC") === sc);
      await guardarBorradorSC(empresa, sc, filasSC, cobrosDe(empresa, sc));
      await auditarAjuste(empresa, sc, "eliminar", linea.origen || "motor", linea, motivo.trim());
      setDetalles(prev => ({ ...prev, [empresa]: todas }));
      await cargarResumen(semana);
      setMsg({ ok: true, txt: `Línea eliminada de ${empresa} · ${sc}.` });
    } catch (e) { console.error("eliminar línea:", e); setMsg({ ok: false, txt: "Error eliminando línea: " + (e.message || e) }); }
    setGuardandoEdit(null);
  };

  const editarMontoLinea = async (empresa, sc, linea) => {
    const actual = Number(linea.monto || 0);
    const raw = window.prompt(`Nuevo monto para ${linea.placa || ""} · ${fmtFechaDDMM(linea.fecha)} · ruta ${linea.id_ruta || "—"} (actual ${fmtMon(actual)}):`, String(actual));
    if (raw === null) return;
    const nuevo = Number(String(raw).replace(/[^0-9.-]/g, ""));
    if (isNaN(nuevo)) { alert("El monto debe ser numérico."); return; }
    const motivo = window.prompt(`Motivo del ajuste de monto (${fmtMon(actual)} → ${fmtMon(nuevo)}):`, "");
    if (motivo === null) return;
    const clave = claveCierre(empresa, sc); setGuardandoEdit(clave);
    try {
      const id = lineaId(linea);
      const todas = (detalles[empresa] || []).map(d => {
        if (lineaId(d) !== id) return d;
        return { ...d, monto: nuevo, es_no_pago: false, _editado: true, monto_original: (d.monto_original != null ? d.monto_original : actual), motivo_edicion: (motivo || "").trim(), editado_por: (usuario && (usuario.nombre || usuario.email)) || "Brain", editado_at: new Date().toISOString() };
      });
      const filasSC = todas.filter(d => (d.service_center_id || "SIN SC") === sc);
      await guardarBorradorSC(empresa, sc, filasSC, cobrosDe(empresa, sc));
      await auditarAjuste(empresa, sc, "editar_monto", linea.origen || "motor", { ...linea, monto: nuevo, monto_anterior: actual }, (motivo || "").trim());
      setDetalles(prev => ({ ...prev, [empresa]: todas }));
      await cargarResumen(semana);
      setMsg({ ok: true, txt: `Monto editado en ${empresa} · ${sc}: ${fmtMon(actual)} → ${fmtMon(nuevo)}.` });
    } catch (e) { console.error("editar monto:", e); setMsg({ ok: false, txt: "Error editando monto: " + (e.message || e) }); }
    setGuardandoEdit(null);
  };

  const abrirAgregarLinea = (empresa, sc, tipo) => setFormLinea({ empresa, sc, tipo, fecha: "", placa: "", id_ruta: "", driver_name: "", cargado: "", entregado: "", km_pago: "", concepto: "", monto: "" });

  const guardarLineaNueva = async () => {
    const f = formLinea; if (!f) return;
    const monto = Number(f.monto);
    if (f.monto === "" || isNaN(monto)) return alert("El monto es obligatorio y debe ser numérico.");
    if (f.tipo === "viaje" && !f.placa.trim()) return alert("La patente es obligatoria para un viaje completo.");
    const clave = claveCierre(f.empresa, f.sc); setGuardandoEdit(clave);
    try {
      const linea = {
        _id: `x|${Date.now()}|${Math.random().toString(36).slice(2,7)}`, origen: f.tipo, es_manual: true,
        service_center_id: f.sc, fecha: f.fecha || null,
        placa: (f.placa || "").toUpperCase() || (f.tipo === "ajuste" ? "AJUSTE" : ""),
        id_ruta: f.id_ruta || (f.tipo === "ajuste" ? "—" : ""),
        driver_name: f.tipo === "ajuste" ? (f.concepto || "Ajuste manual") : (f.driver_name || ""),
        tiene_auxiliar: false,
        cargado: (f.tipo === "viaje" && f.cargado !== "") ? Number(f.cargado) : null,
        entregado: (f.tipo === "viaje" && f.entregado !== "") ? Number(f.entregado) : null,
        pct_entrega: null, pct_visitado_gate: null,
        km_pago: (f.tipo === "viaje" && f.km_pago !== "") ? Number(f.km_pago) : null,
        km_real_meli: null, factor_ns: null, monto: monto,
        monto_bonificacion: 0, bonificacion_nombre: null, bonificacion_pct: 0, tiene_bonificacion: false,
        es_no_pago: false, motivo_no_pago: null,
      };
      const todas = [ ...(detalles[f.empresa] || []), linea ];
      const filasSC = todas.filter(d => (d.service_center_id || "SIN SC") === f.sc);
      await guardarBorradorSC(f.empresa, f.sc, filasSC, cobrosDe(f.empresa, f.sc));
      await auditarAjuste(f.empresa, f.sc, "agregar", f.tipo, linea, null);
      setDetalles(prev => ({ ...prev, [f.empresa]: todas }));
      await cargarResumen(semana); setFormLinea(null);
      setMsg({ ok: true, txt: `Línea agregada a ${f.empresa} · ${f.sc}.` });
    } catch (e) { console.error("agregar línea:", e); setMsg({ ok: false, txt: "Error agregando línea: " + (e.message || e) }); }
    setGuardandoEdit(null);
  };

  const cambiarCobros = (empresa, sc, valor) => setCobrosPorSC(prev => ({ ...prev, [empresa]: { ...(prev[empresa] || {}), [sc]: Number(valor || 0) } }));
  const guardarCobros = async (empresa, sc) => {
    const clave = claveCierre(empresa, sc); setGuardandoEdit(clave);
    try {
      await guardarBorradorSC(empresa, sc, filasDeSC(empresa, sc), cobrosDe(empresa, sc));
      await cargarResumen(semana);
    } catch (e) { console.error("guardar cobros:", e); setMsg({ ok: false, txt: "Error guardando cobros: " + (e.message || e) }); }
    setGuardandoEdit(null);
  };

  // ── Asignar placa a transportista (inserta en flota_terceros_mx) ──
  const asignarPlaca = async (placa, filasPlaca) => {
    const eleccion = asignacionSel[placa];
    if (!eleccion) return alert("Elegí un transportista para la placa " + placa);
    if (eleccion === "__nueva__") { setFormTransp({ ...TRANSP_FORM_VACIO }); return; }
    if (!confirm(`¿Asignar la placa ${placa} a "${eleccion}" para la semana ${semana} (${etiquetaSemanaInventario(semana)})?`)) return;
    setAsignando(placa);
    try {
      const sc = (filasPlaca && filasPlaca[0] && filasPlaca[0].service_center_id) || null;
      const { error } = await sb.from("flota_terceros_mx").insert({
        semana, placa: normalizarPlaca(placa), empresa_transporte: eleccion,
        operacion: sc ? "ML_MX_" + sc : null,
        responsable: (usuario && (usuario.nombre || usuario.email)) || "Brain - Conciliación",
        fecha_hora_envio: new Date().toISOString(),
      });
      if (error) throw error;
      setMsg({ ok: true, txt: `Placa ${placa} asignada a ${eleccion} (semana ${semana}).` });
      await refrescarTodo();
    } catch (e) {
      console.error("asignar placa:", e);
      setMsg({ ok: false, txt: "Error asignando placa: " + (e.message || e) });
    }
    setAsignando(null);
  };

  // ── Crear / editar transportista (prefacturas_transportistas_mx) ──
  const guardarTransp = async () => {
    const f = formTransp;
    if (!f || !f.nombre.trim()) return alert("La razón social es obligatoria.");
    if (!f.rfc.trim()) return alert("El RFC es obligatorio (va en el header del PDF).");
    setGuardandoTransp(true);
    try {
      const payload = {
        nombre: f.nombre.trim(), rfc: f.rfc.trim() || null, estado: f.estado || "Activo",
        correo_to: f.correo_to.trim() || null, correo_cc: f.correo_cc.trim() || null,
        correo_bcc: f.correo_bcc.trim() || null, notas: f.notas.trim() || null,
      };
      let error;
      if (f.id) ({ error } = await sb.from("prefacturas_transportistas_mx").update(payload).eq("id", f.id));
      else ({ error } = await sb.from("prefacturas_transportistas_mx").insert(payload));
      if (error) throw error;
      setMsg({ ok: true, txt: `Transportista "${f.nombre.trim()}" guardado.` });
      setFormTransp(null);
      await cargarMaestros();
      await cargarResumen(semana);
    } catch (e) {
      console.error("guardar transportista:", e);
      alert("Error guardando transportista: " + (e.message || e));
    }
    setGuardandoTransp(false);
  };

  // ── Cerrar / reabrir conciliación por empresa+SC ──
  const cerrarConciliacion = async (empresa, sc, rSC, filasSC) => {
    if (!filasSC || !filasSC.length) return alert("Sin viajes para cerrar en " + sc + ".");
    const filasFull = filasConSaldoLine(empresa, sc, filasSC);
    const tot = recalcSC(filasFull, cobrosDe(empresa, sc));
    tot.saldoPrevio = saldoPrevioDe(empresa, sc);
    tot.netoViajes = Math.round(filasFull.filter(d => !d._saldo).reduce((s, d) => s + Number(d.monto || 0), 0) * 100) / 100;
    if (!confirm(`¿Cerrar la conciliación de "${empresa}" — ${sc} — semana ${semana} (${etiquetaSemanaInventario(semana)})?\n\nNeto: ${fmtMon(tot.neto)} · Bruto: ${fmtMon(tot.bruto)} · Cobros: ${fmtMon(tot.cobros)} · Líquido: ${fmtMon(tot.liquido)} · ${tot.nViajes} viajes (${tot.nNoPago} no pago).\n\nEl detalle queda congelado para el PDF y el envío.`)) return;
    setCerrando(claveCierre(empresa, sc));
    try {
      const lunes = rangoSemanaInventario(semana).inicio.toISOString().slice(0, 10);
      const ahora = new Date().toISOString();
      const { error } = await sb.from("conciliaciones_terceros").upsert({
        empresa_nombre: empresa, service_center: sc, semana, semana_inicio: lunes,
        estado: tot.negativo ? "pendiente_conciliacion" : "cerrada",
        total_neto: tot.neto, iva_16: tot.iva, total_bruto: tot.bruto, liquido_pago: tot.liquido, total_cobros: tot.cobros,
        n_viajes: tot.nViajes, n_no_pago: tot.nNoPago,
        detalle: filasFull, tiene_ajustes: (filasFull.some(d => d.es_manual) || filasFull.filter(d => !d._saldo).length !== Number(rSC.n_viajes || 0)), generado_at: ahora, cerrado_at: ahora,
        cerrado_por: (usuario && (usuario.nombre || usuario.email)) || "Brain",
      }, { onConflict: "empresa_nombre,service_center,semana" });
      if (error) throw error;
      const _manualLines = filasFull.filter(d => d._manual);
      const _manualSum = Math.round(_manualLines.reduce((s, d) => s + Number(d.monto || 0), 0) * 100) / 100;
      const _netoParaSaldo = Math.round((tot.netoViajes + _manualSum) * 100) / 100;
      if (tot.saldoPrevio < 0 || _netoParaSaldo < 0) await persistirSaldoCierre(empresa, sc, _netoParaSaldo);
      for (const ml of _manualLines) await conciliarSaldoManual(empresa, ml._origenSC, sc);
      if (_manualLines.length) setAplicManual(prev => { const cp = { ...prev }; delete cp[`${norm(empresa)}||${norm(sc)}`]; return cp; });
      await logEvento(empresa, sc, tot.negativo ? "cerrar_pendiente" : "cerrar", tot, { estado: tot.negativo ? "pendiente_conciliacion" : "cerrada" });
      setMsg({ ok: true, txt: `Conciliación de ${empresa} · ${sc} cerrada (semana ${semana}).` });
      await cargarResumen(semana);
    } catch (e) {
      console.error("cerrar conciliación:", e);
      setMsg({ ok: false, txt: "Error cerrando conciliación: " + (e.message || e) });
    }
    setCerrando(null);
  };

  const reabrirConciliacion = async (empresa, sc) => {
    if (!confirm(`¿Reabrir la conciliación de "${empresa}" · ${sc} — semana ${semana}? Volverá a borrador.`)) return;
    try {
      const { error } = await sb.from("conciliaciones_terceros")
        .update({ estado: "borrador", abierto_at: new Date().toISOString(), abierto_por: (usuario && (usuario.nombre || usuario.email)) || "Brain" })
        .eq("empresa_nombre", empresa).eq("service_center", sc).eq("semana", semana);
      if (error) throw error;
      await logEvento(empresa, sc, "reabrir", null, { estado: "borrador" });
      await cargarResumen(semana);
    } catch (e) { alert("Error reabriendo: " + (e.message || e)); }
  };

  // ── PDF por empresa + SC (mismo template que portará el endpoint del VPS) ──
  // ── Rutas con ID repetido (multi-día) — detección y consolidación ──
  const cargarAux = async (sem) => {
    try {
      const lunes = rangoSemanaInventario(sem).inicio.toISOString().slice(0, 10);
      const dom = rangoSemanaInventario(sem).fin.toISOString().slice(0, 10);
      const { data } = await sb.from("aprobaciones_helper").select("travel_id, decision, motivo_rechazo").gte("fecha", lunes).lte("fecha", dom);
      const m = {};
      for (const a of data || []) m[String(a.travel_id)] = { decision: a.decision, motivo: a.motivo_rechazo || null };
      setAuxMap(m);
    } catch (e) { console.error("aux conciliación:", e); setAuxMap({}); }
  };
  const cargarRepetidas = async (sem) => {
    const s = sem != null ? sem : semana;
    setRepBusy(true);
    try {
      const [{ data, error }, { data: conc }] = await Promise.all([
        sb.rpc("get_rutas_repetidas_semana", { p_semana: s }),
        sb.from("conciliaciones_terceros").select("empresa_nombre, service_center, detalle").eq("semana", s),
      ]);
      if (error) throw error;
      const rep = data || [];
      // Marcar como consolidada si en el detalle GUARDADO de esa empresa+SC queda <=1 día de la ruta
      const cons = new Set();
      for (const r of rep) {
        const row = (conc || []).find(c => c.empresa_nombre === r.empresa && c.service_center === r.service_center);
        if (row && Array.isArray(row.detalle)) {
          const dias = new Set(row.detalle.filter(d => String(d.id_ruta) === String(r.id_ruta)).map(d => String(d.fecha)));
          if (dias.size <= 1) cons.add(`${r.empresa}||${r.service_center}||${r.id_ruta}`);
        }
      }
      setRepRows(rep); setConsolidadas(cons);
    } catch (e) { console.error("rutas repetidas semana:", e); setRepRows([]); setConsolidadas(new Set()); }
    setRepBusy(false);
  };

  const _consolidarNucleo = async (rep) => {
    const empresa = rep.empresa, sc = rep.service_center, idRuta = String(rep.id_ruta);
    const { data: row } = await sb.from("conciliaciones_terceros")
      .select("detalle, estado").eq("empresa_nombre", empresa).eq("service_center", sc).eq("semana", semana).maybeSingle();
    let filas;
    if (row && Array.isArray(row.detalle) && row.detalle.length) {
      if (row.estado === "enviada") throw new Error("ya enviada; reábrela antes de consolidar");
      filas = row.detalle.map(d => ({ ...d, _id: d._id || lineaId(d) }));
    } else {
      const { data, error } = await sb.rpc("get_conciliacion_terceros_detalle", { p_semana: semana, p_empresa: empresa, p_sc: sc });
      if (error) throw error;
      filas = (data || []).map(d => ({ ...d, _id: lineaId(d), origen: "motor" }));
    }
    const mismas = filas.filter(d => String(d.id_ruta) === idRuta).sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
    if (mismas.length <= 1) return 0;
    const quitar = mismas.slice(1);
    const quitarIds = new Set(quitar.map(lineaId));
    const filasSC = filas.filter(d => !quitarIds.has(lineaId(d)) && (d.service_center_id || "SIN SC") === sc);
    await guardarBorradorSC(empresa, sc, filasSC, cobrosDe(empresa, sc));
    for (const q of quitar) await auditarAjuste(empresa, sc, "eliminar", q.origen || "motor", q, `Consolidación ruta multi-ID ${idRuta}: queda 1er día (${mismas[0].fecha})`);
    if (detalles[empresa]) setDetalles(prev => ({ ...prev, [empresa]: (prev[empresa] || []).filter(d => !quitarIds.has(lineaId(d))) }));
    return quitar.length;
  };

  const consolidarRuta = async (rep) => {
    setConsolidando(String(rep.id_ruta));
    try {
      const n = await _consolidarNucleo(rep);
      await cargarResumen(semana); await cargarRepetidas(semana);
      setMsg({ ok: true, txt: n > 0 ? `Ruta ${rep.id_ruta} consolidada en ${rep.empresa} · ${rep.service_center}: se quitaron ${n} día(s) repetido(s).` : `Ruta ${rep.id_ruta} ya estaba consolidada.` });
    } catch (e) { console.error("consolidar ruta:", e); setMsg({ ok: false, txt: `Error consolidando ${rep.id_ruta}: ` + (e.message || e) }); }
    setConsolidando(null);
  };

  const consolidarTodas = async () => {
    if (!repRows || !repRows.length) return;
    if (!confirm(`¿Consolidar ${repRows.length} ruta(s) repetida(s)? Se deja el pago del 1er día de cada una y se quitan los días repetidos (queda auditado).`)) return;
    setConsolidando("__todas__");
    let ok = 0, fail = 0; const errores = [];
    for (const rep of repRows) {
      try { await _consolidarNucleo(rep); ok++; } catch (e) { fail++; errores.push(`${rep.id_ruta}: ${e.message || e}`); }
    }
    await cargarResumen(semana); await cargarRepetidas(semana); setConsolidando(null);
    setMsg({ ok: fail === 0, txt: `Consolidación masiva: ${ok} ok, ${fail} con error.` + (errores.length ? " — " + errores.join(" | ") : "") });
  };
  // ── Placas en 2+ empresas (misma semana) — alertador y traspasador de viajes ──
  const esLineaViajeTraspaso = (d) => !!(d && !d._saldo && d.placa && String(d.placa).toUpperCase() !== "AJUSTE" && ["ajuste", "cargo", "descuento"].indexOf(String(d.origen || "")) === -1);

  // Lee las filas vigentes de una empresa (motor + SC editados), SIN tocar el estado local
  const leerFilasEmpresa = async (empresa) => {
    const { data, error } = await sb.rpc("get_conciliacion_terceros_detalle", { p_semana: semana, p_empresa: empresa, p_sc: null });
    if (error) throw error;
    let filas = (data || []).map(d => ({ ...d, _id: lineaId(d), origen: d.origen || "motor" }));
    const { data: conc } = await sb.from("conciliaciones_terceros").select("service_center, estado, detalle").eq("empresa_nombre", empresa).eq("semana", semana);
    const estados = {};
    for (const c of conc || []) estados[c.service_center] = c.estado || "borrador";
    const editados = (conc || []).filter(c => Array.isArray(c.detalle) && c.detalle.length);
    if (editados.length) {
      const scs = new Set(editados.map(c => c.service_center));
      filas = filas.filter(f => !scs.has(f.service_center_id || "SIN SC"));
      for (const c of editados) for (const ln of c.detalle) filas.push({ ...ln, _id: ln._id || lineaId(ln), origen: ln.origen || "motor" });
    }
    return { filas, estados };
  };

  // Filas + estado + cobros de una empresa+SC puntual (el detalle guardado manda; si no hay, motor)
  const leerFilasSC = async (empresa, sc) => {
    const { data: row } = await sb.from("conciliaciones_terceros").select("detalle, estado, total_cobros")
      .eq("empresa_nombre", empresa).eq("service_center", sc).eq("semana", semana).maybeSingle();
    const cobros = row && row.total_cobros != null ? Number(row.total_cobros) : cobrosDe(empresa, sc);
    const estado = (row && row.estado) || "borrador";
    if (row && Array.isArray(row.detalle) && row.detalle.length) {
      return { filas: row.detalle.map(d => ({ ...d, _id: d._id || lineaId(d) })), estado, cobros };
    }
    const { data, error } = await sb.rpc("get_conciliacion_terceros_detalle", { p_semana: semana, p_empresa: empresa, p_sc: sc });
    if (error) throw error;
    return { filas: (data || []).map(d => ({ ...d, _id: lineaId(d), origen: d.origen || "motor" })), estado, cobros };
  };

  const cargarTraspasos = async (sem) => {
    const s = sem != null ? sem : semana;
    setTraspBusy(true);
    try {
      const cand = {}; // placa -> Set(empresas)
      const add = (placa, empresa) => {
        const p = normalizarPlaca(placa); const e = String(empresa || "").trim();
        if (!p || !e || e === SIN_EMPRESA) return;
        if (!cand[p]) cand[p] = new Set();
        cand[p].add(e);
      };
      // (a) placas asignadas a 2+ empresas en flota_terceros_mx (raíz del conflicto)
      const { data: fl } = await sb.from("flota_terceros_mx").select("placa, empresa_transporte").eq("semana", s);
      const porFlota = {};
      for (const f of fl || []) {
        const p = normalizarPlaca(f.placa); const e = String(f.empresa_transporte || "").trim();
        if (!p || !e) continue;
        if (!porFlota[p]) porFlota[p] = new Set();
        porFlota[p].add(e);
      }
      for (const p in porFlota) if (porFlota[p].size > 1) for (const e of porFlota[p]) add(p, e);
      // (b) placas que quedaron bajo 2+ empresas en las conciliaciones guardadas de la semana
      const { data: concs } = await sb.from("conciliaciones_terceros").select("empresa_nombre, detalle").eq("semana", s);
      const porConc = {};
      for (const c of concs || []) {
        if (!Array.isArray(c.detalle)) continue;
        for (const d of c.detalle) {
          if (!esLineaViajeTraspaso(d)) continue;
          const p = normalizarPlaca(d.placa); if (!p) continue;
          if (!porConc[p]) porConc[p] = new Set();
          porConc[p].add(String(c.empresa_nombre).trim());
        }
      }
      for (const p in porConc) if (porConc[p].size > 1) for (const e of porConc[p]) add(p, e);
      const placas = Object.keys(cand).filter(p => cand[p].size > 1).sort();
      if (!placas.length) { setTraspRows([]); setTraspBusy(false); return; }
      // (c) conteo real de viajes/montos por empresa (motor + editados), solo empresas involucradas
      const empresasInv = new Set(); for (const p of placas) for (const e of cand[p]) empresasInv.add(e);
      const filasPorEmp = {};
      for (const e of empresasInv) {
        try { filasPorEmp[e] = (await leerFilasEmpresa(e)).filas; }
        catch (er) { console.error("detalle " + e + ":", er); filasPorEmp[e] = []; }
      }
      const rows = [];
      for (const p of placas) {
        const grupos = [];
        for (const e of cand[p]) {
          const fs = (filasPorEmp[e] || []).filter(d => esLineaViajeTraspaso(d) && normalizarPlaca(d.placa) === p);
          grupos.push({
            empresa: e, nViajes: fs.length,
            monto: Math.round(fs.reduce((a, d) => a + Number(d.monto || 0), 0) * 100) / 100,
            scs: [...new Set(fs.map(d => d.service_center_id || "SIN SC"))],
          });
        }
        grupos.sort((a, b) => b.nViajes - a.nViajes);
        rows.push({ placa: p, empresas: [...cand[p]], grupos, repartida: grupos.filter(g => g.nViajes > 0).length > 1 });
      }
      rows.sort((a, b) => (b.repartida ? 1 : 0) - (a.repartida ? 1 : 0) || a.placa.localeCompare(b.placa));
      setTraspRows(rows);
    } catch (e) { console.error("placas multi-empresa:", e); setTraspRows([]); }
    setTraspBusy(false);
  };

  const abrirTraspasador = async (al) => {
    console.log("[traspasador] abrir placa", al && al.placa, al && al.empresas);
    setTrasp({ placa: al.placa, cargando: true, grupos: [], sel: new Set(), destino: "", error: null });
    try {
      const grupos = [];
      for (const e of al.empresas) {
        const { filas, estados } = await leerFilasEmpresa(e);
        const fs = filas.filter(d => esLineaViajeTraspaso(d) && normalizarPlaca(d.placa) === al.placa)
          .sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")) || String(a.id_ruta || "").localeCompare(String(b.id_ruta || "")));
        grupos.push({ empresa: e, filas: fs, estados });
      }
      setTrasp(t => (t && t.placa === al.placa) ? { ...t, cargando: false, grupos } : t);
    } catch (e) {
      console.error("abrir traspasador:", e);
      setTrasp(t => (t && t.placa === al.placa) ? { ...t, cargando: false, error: String((e && e.message) || e) } : t);
    }
  };

  const claveTrasp = (empresa, d) => `${empresa}||${d.service_center_id || "SIN SC"}||${lineaId(d)}`;
  const toggleTrasp = (k) => setTrasp(t => { if (!t) return t; const s = new Set(t.sel); if (s.has(k)) s.delete(k); else s.add(k); return { ...t, sel: s }; });
  const toggleTraspGrupo = (g, marcar) => setTrasp(t => {
    if (!t) return t;
    const s = new Set(t.sel);
    for (const d of g.filas) {
      if ((g.estados[d.service_center_id || "SIN SC"] || "borrador") === "enviada") continue;
      const k = claveTrasp(g.empresa, d);
      if (marcar) s.add(k); else s.delete(k);
    }
    return { ...t, sel: s };
  });

  const ejecutarTraspaso = async () => {
    const t = trasp; if (!t || traspasando) return;
    const destino = String(t.destino || "").trim();
    if (!destino) { alert("Elegí la empresa destino del traspaso."); return; }
    const sel = [];
    for (const g of t.grupos) for (const d of g.filas) if (t.sel.has(claveTrasp(g.empresa, d))) sel.push({ empresa: g.empresa, sc: d.service_center_id || "SIN SC", linea: d });
    if (!sel.length) { alert("Marcá al menos un viaje para traspasar."); return; }
    const utiles = sel.filter(x => norm(x.empresa) !== norm(destino));
    if (!utiles.length) { alert("Los viajes seleccionados ya están en " + destino + "."); return; }
    const montoTot = Math.round(utiles.reduce((a, x) => a + Number(x.linea.monto || 0), 0) * 100) / 100;
    if (!confirm(`¿Traspasar ${utiles.length} viaje(s) de la placa ${t.placa} a "${destino}" (semana ${semana})?\n\nMonto que se mueve: ${fmtMon(montoTot)}. Se resta de la(s) empresa(s) de origen y se suma a ${destino}.\n\nQueda auditado y las prefacturas afectadas vuelven a borrador (PDF y correo salen con el detalle nuevo).`)) return;
    setTraspasando(true);
    try {
      const por = (usuario && (usuario.nombre || usuario.email)) || "Brain";
      const at = new Date().toISOString();
      // 1) restar de las prefacturas de origen (agrupado por empresa+SC)
      const porOrigen = {};
      for (const x of utiles) { const k = `${x.empresa}||${x.sc}`; if (!porOrigen[k]) porOrigen[k] = { empresa: x.empresa, sc: x.sc, lineas: [] }; porOrigen[k].lineas.push(x.linea); }
      const movidas = [];
      for (const k in porOrigen) {
        const o = porOrigen[k];
        const { filas, estado, cobros } = await leerFilasSC(o.empresa, o.sc);
        if (estado === "enviada") throw new Error(`la prefactura de ${o.empresa} · ${o.sc} ya fue enviada; reabrila antes de traspasar`);
        const ids = new Set(o.lineas.map(lineaId));
        const salen = filas.filter(d => ids.has(lineaId(d)));
        if (salen.length !== o.lineas.length) throw new Error(`en ${o.empresa} · ${o.sc} no se encontraron todas las líneas seleccionadas (¿se editó la prefactura?); refrescá y volvé a intentar`);
        const quedan = filas.filter(d => !ids.has(lineaId(d)));
        await guardarBorradorSC(o.empresa, o.sc, quedan, cobros);
        for (const q of salen) {
          movidas.push({ linea: q, de: o.empresa });
          await auditarAjuste(o.empresa, o.sc, "traspaso_salida", q.origen || "motor", q, `Traspaso a ${destino} (placa ${t.placa} en 2+ empresas)`);
        }
        await logEvento(o.empresa, o.sc, "traspaso_salida", recalcSC(quedan, cobros), { detalle: { placa: t.placa, a: destino, n: salen.length } });
      }
      // 2) sumar a la prefactura destino (cada viaje conserva su SC)
      const porSC = {};
      for (const m of movidas) { const sc = m.linea.service_center_id || "SIN SC"; if (!porSC[sc]) porSC[sc] = []; porSC[sc].push(m); }
      for (const sc in porSC) {
        const { filas, estado, cobros } = await leerFilasSC(destino, sc);
        if (estado === "enviada") throw new Error(`la prefactura de ${destino} · ${sc} ya fue enviada; reabrila antes de traspasar`);
        const yaIds = new Set(filas.map(lineaId));
        const nuevas = porSC[sc].filter(m => !yaIds.has(lineaId(m.linea)))
          .map(m => ({ ...m.linea, traspaso: { de: m.de, a: destino, at, por } }));
        await guardarBorradorSC(destino, sc, [...filas, ...nuevas], cobros);
        for (const n of nuevas) await auditarAjuste(destino, sc, "traspaso_entrada", n.origen || "motor", n, `Viaje recibido por traspaso desde ${n.traspaso.de} (placa ${t.placa})`);
        await logEvento(destino, sc, "traspaso_entrada", recalcSC([...filas, ...nuevas], cobros), { detalle: { placa: t.placa, n: nuevas.length } });
      }
      // 3) refrescar estado local y resumen
      const afectadas = new Set([destino]); for (const m of movidas) afectadas.add(m.de);
      setDetalles(prev => { const nx = { ...prev }; for (const e of afectadas) delete nx[e]; return nx; });
      if (expandida && afectadas.has(expandida)) {
        try { const r = await leerFilasEmpresa(expandida); setDetalles(prev => ({ ...prev, [expandida]: r.filas })); } catch (er) { console.error("recarga detalle:", er); }
      }
      setTrasp(null);
      await cargarResumen(semana); await cargarTraspasos(semana);
      setMsg({ ok: true, txt: `Traspaso listo: ${movidas.length} viaje(s) de la placa ${t.placa} ahora en ${destino}. Las prefacturas afectadas quedaron en borrador para revisar y cerrar.` });
    } catch (e) {
      console.error("traspaso:", e);
      setMsg({ ok: false, txt: "Error en el traspaso: " + (e.message || e) });
      await cargarResumen(semana); await cargarTraspasos(semana);
    }
    setTraspasando(false);
  };

  // ── Importador masivo de ajustes (cargos / descuentos / otros) a prefacturas ──
  const asegurarXLSX = async () => {
    if (window.XLSX) return true;
    await new Promise((res) => { const s = document.createElement("script"); s.src = "https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js"; s.onload = res; s.onerror = res; document.head.appendChild(s); });
    return !!window.XLSX;
  };
  const descargarPlantillaAjustes = async () => {
    if (!(await asegurarXLSX())) { alert("No se pudo cargar la librería de Excel."); return; }
    // Una sola hoja "Ajustes" con TODOS los campos del PDF. tipo = viaje | cargo | descuento.
    // En viaje el signo del MONTO manda (positivo = paga/suma, negativo = cobra/resta).
    const ws = window.XLSX.utils.aoa_to_sheet([
      ["tipo","empresa","service_center","fecha","patente","id_ruta","conductor","aux","cargado","entregado","pct_entrega","pct_visita","km_pago","factor","bonif","concepto","monto"],
      ["viaje","RAQUEL VELAZQUEZ GONZALEZ","SMX8","05-06-2026","ABC-123","142986216","Juan Perez","NO",120,118,98.3,99.1,150,1,0,"Reliquidación sem 23",2200],
      ["viaje","RAQUEL VELAZQUEZ GONZALEZ","SMX8","06-06-2026","ABC-124","142986300","Juan Perez","NO",100,0,0,0,0,0,0,"Cobro ruta no operada sem 23",-1800],
      ["descuento","MICHAEL YTZURIT ZAMUDIO IBARRA","SCY1","","","","","","","","","","","","","Daño paquete",500],
    ]);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Ajustes");
    window.XLSX.writeFile(wb, `plantilla_importacion_conciliacion_sem${semana}.xlsx`);
  };

  const onArchivoAjustes = async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    try {
      if (!(await asegurarXLSX())) { setMsg({ ok: false, txt: "No se pudo cargar la librería de Excel." }); return; }
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: "array", cellDates: true });
      const sheetName = wb.SheetNames.includes("Ajustes") ? "Ajustes" : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const json = window.XLSX.utils.sheet_to_json(ws, { defval: "" });
      const validKeys = new Map();
      for (const r of resumen) validKeys.set(`${norm(r.empresa)}||${norm(r.service_center)}`, { empresa: r.empresa, sc: r.service_center });
      // Resuelve empresa+SC: 1) resumen de la semana; 2) maestro de transportistas + CECO válido (para reliquidar viajes de semanas pasadas en empresas que no operaron esta semana)
      const resolverEmpresaSC = (emp, scc) => {
        const k = `${norm(emp)}||${norm(scc)}`;
        if (validKeys.has(k)) return validKeys.get(k);
        const tt = transpPorNorm[norm(emp)]; const pp = paramPorSC[norm(scc)];
        if (tt && pp) return { empresa: tt.nombre, sc: pp.ceco || scc };
        return { empresa: emp, sc: scc, nueva: true };  // no registrada: se crea como prefactura nueva
      };
      const numOrNull = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? null : n; };
      const _pad = (n) => String(n).padStart(2, "0");
      const parseFecha = (v) => {
        if (v === "" || v == null || v === "-") return null;
        if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${_pad(v.getMonth() + 1)}-${_pad(v.getDate())}`;  // Date (cellDates) -> ISO sin corrimiento de zona
        if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400000)); return isNaN(d) ? null : `${d.getUTCFullYear()}-${_pad(d.getUTCMonth() + 1)}-${_pad(d.getUTCDate())}`; }
        const s = String(v).trim();
        let mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (mm) return `${mm[1]}-${_pad(mm[2])}-${_pad(mm[3])}`;  // ISO
        mm = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); if (mm) { let y = mm[3]; if (y.length === 2) y = "20" + y; return `${y}-${_pad(mm[2])}-${_pad(mm[1])}`; }  // dd-mm-aaaa (o dd/mm/aa)
        return s.slice(0, 10);
      };
      const idCache = {};
      const idRutasDe = async (empresa, sc) => {
        const key = `${empresa}||${sc}`; if (idCache[key]) return idCache[key];
        let filas = [];
        try {
          const { data: r2 } = await sb.from("conciliaciones_terceros").select("detalle").eq("empresa_nombre", empresa).eq("service_center", sc).eq("semana", semana).maybeSingle();
          if (r2 && Array.isArray(r2.detalle) && r2.detalle.length) filas = r2.detalle;
          else { const { data } = await sb.rpc("get_conciliacion_terceros_detalle", { p_semana: semana, p_empresa: empresa, p_sc: sc }); filas = data || []; }
        } catch (er) { console.error("idRutasDe", er); }
        const set = new Set(filas.map(d => String(d.id_ruta || "").trim()).filter(Boolean)); idCache[key] = set; return set;
      };
      const seen = new Set();
      const rows = [];
      for (const raw of json) {
        const get = (keys) => { for (const k of Object.keys(raw)) { if (keys.includes(String(k).toLowerCase().trim())) return raw[k]; } return ""; };
        const empresa = String(get(["empresa"]) || "").trim();
        const sc = String(get(["service_center", "sc", "service center", "centro"]) || "").trim();
        const tipoRaw = String(get(["tipo"]) || "").toLowerCase().trim();
        const concepto = String(get(["concepto", "detalle", "glosa"]) || "").trim();
        const montoNum = Number(String(get(["monto", "importe", "valor"])).replace(/[^0-9.\-]/g, ""));
        const placa = String(get(["patente", "placa"]) || "").trim().toUpperCase();
        const idRuta = String(get(["id_ruta", "id ruta", "ruta", "idruta"]) || "").trim();
        const conductor = String(get(["conductor", "chofer", "driver", "driver_name"]) || "").trim();
        const auxRaw = String(get(["aux", "auxiliar", "ayudante"]) || "").trim().toLowerCase();
        const fecha = parseFecha(get(["fecha", "date"]));
        const cargado = numOrNull(get(["cargado", "cargados"]));
        const entregado = numOrNull(get(["entregado", "entregados"]));
        const pctEntrega = numOrNull(get(["pct_entrega", "% entrega", "%entrega", "entrega"]));
        const pctVisita = numOrNull(get(["pct_visita", "% visita", "%visita", "visita", "% visitado", "pct_visitado"]));
        const kmPago = numOrNull(get(["km_pago", "km pago", "kmpago", "km"]));
        const factor = numOrNull(get(["factor", "factor_ns"]));
        const bonif = numOrNull(get(["bonif", "bonif.", "bonificacion", "bonificación", "monto_bonificacion"]));
        let tipo = tipoRaw.startsWith("viaj") ? "viaje" : tipoRaw.startsWith("desc") ? "descuento" : tipoRaw.startsWith("carg") ? "cargo" : tipoRaw.startsWith("otro") ? "otro" : "";
        if (!tipo) tipo = placa ? "viaje" : "ajuste";
        const match = resolverEmpresaSC(empresa, sc);
        // error = problema de FORMATO (bloquea) · warn = aviso informativo (NO bloquea, el analista decide)
        let error = "", warn = "";
        if (!empresa || !sc) error = "Falta empresa o SC";
        else if (isNaN(montoNum)) error = "Monto no numérico";
        if (!error) {
          const avisos = [];
          if (match && match.nueva) avisos.push("empresa/SC nuevo: se creará la prefactura");
          if (tipo === "viaje" && idRuta && match) {
            const k2 = `${match.empresa}||${match.sc}||${idRuta}`;
            if (seen.has(k2)) avisos.push(`ruta ${idRuta} repetida en el archivo`);
            else { const set = await idRutasDe(match.empresa, match.sc); if (set.has(idRuta)) avisos.push(`ruta ${idRuta} ya está en la conciliación`); seen.add(k2); }
          }
          warn = avisos.join(" · ");
        }
        const montoFirmado = montoNum;  // el signo lo pone el analista: + suma, − resta, 0 también se carga
        const conceptoShow = tipo === "viaje" ? (concepto || `Ruta ${idRuta || "?"} · ${placa || ""}${conductor ? " · " + conductor : ""}`) : (concepto || "Ajuste");
        rows.push({ kind: tipo === "viaje" ? "viaje" : "ajuste", tipo, empresa: match ? match.empresa : empresa, sc: match ? match.sc : sc, nueva: !!(match && match.nueva),
          fecha, placa, id_ruta: idRuta, driver_name: conductor, aux: ["si","sí","s","1","true","x"].includes(auxRaw),
          cargado, entregado, pct_entrega: pctEntrega, pct_visitado_gate: pctVisita, km_pago: kmPago, factor_ns: factor,
          monto_bonificacion: bonif != null ? bonif : 0, concepto: conceptoShow, montoFirmado, error, warn, valido: !error });
      }
      setImportRows(rows);
    } catch (err) { console.error("parse import:", err); setMsg({ ok: false, txt: "No se pudo leer el Excel: " + (err.message || err) }); }
    e.target.value = "";
  };

  const _aplicarAjustesGrupo = async (empresa, sc, items) => {
    const { data: row } = await sb.from("conciliaciones_terceros")
      .select("detalle, estado").eq("empresa_nombre", empresa).eq("service_center", sc).eq("semana", semana).maybeSingle();
    let filas;
    if (row && Array.isArray(row.detalle) && row.detalle.length) {
      if (row.estado === "enviada") throw new Error("ya enviada; reábrela antes de importar");
      filas = row.detalle.map(d => ({ ...d, _id: d._id || lineaId(d) }));
    } else {
      const { data, error } = await sb.rpc("get_conciliacion_terceros_detalle", { p_semana: semana, p_empresa: empresa, p_sc: sc });
      if (error) throw error;
      filas = (data || []).map(d => ({ ...d, _id: lineaId(d), origen: "motor" }));
    }
    const nuevas = items.map((a, idx) => {
      const _id = `imp|${Date.now()}|${idx}|${Math.random().toString(36).slice(2, 6)}`;
      const baseLn = { _id, es_manual: true, importado: true, service_center_id: sc,
        km_real_meli: null, bonificacion_nombre: null, bonificacion_pct: 0, tiene_bonificacion: false,
        es_no_pago: false, motivo_no_pago: null };
      if (a.kind === "viaje") {
        return { ...baseLn, origen: "viaje", fecha: a.fecha || null,
          placa: (a.placa || "").toUpperCase(), id_ruta: a.id_ruta || "", driver_name: a.driver_name || "",
          tiene_auxiliar: !!a.aux,
          cargado: a.cargado != null ? Number(a.cargado) : null, entregado: a.entregado != null ? Number(a.entregado) : null,
          pct_entrega: a.pct_entrega != null ? Number(a.pct_entrega) : null, pct_visitado_gate: a.pct_visitado_gate != null ? Number(a.pct_visitado_gate) : null,
          km_pago: a.km_pago != null ? Number(a.km_pago) : null, factor_ns: a.factor_ns != null ? Number(a.factor_ns) : null,
          monto_bonificacion: a.monto_bonificacion != null ? Number(a.monto_bonificacion) : 0, monto: a.montoFirmado };
      }
      return { ...baseLn, origen: "ajuste", fecha: a.fecha || null,
        placa: (a.placa || "").toUpperCase() || "AJUSTE", id_ruta: a.id_ruta || "—", driver_name: a.concepto,
        tiene_auxiliar: !!a.aux,
        cargado: a.cargado != null ? Number(a.cargado) : null, entregado: a.entregado != null ? Number(a.entregado) : null,
        pct_entrega: a.pct_entrega != null ? Number(a.pct_entrega) : null, pct_visitado_gate: a.pct_visitado_gate != null ? Number(a.pct_visitado_gate) : null,
        km_pago: a.km_pago != null ? Number(a.km_pago) : null, factor_ns: a.factor_ns != null ? Number(a.factor_ns) : null,
        monto: a.montoFirmado, monto_bonificacion: a.monto_bonificacion != null ? Number(a.monto_bonificacion) : 0 };
    });
    const filasSC = [...filas.filter(d => (d.service_center_id || "SIN SC") === sc), ...nuevas];
    await guardarBorradorSC(empresa, sc, filasSC, cobrosDe(empresa, sc));
    for (const n of nuevas) await auditarAjuste(empresa, sc, "agregar", n.origen, n, `Importado (${n.origen}): ${n.driver_name || n.id_ruta} (${n.monto})`);
    if (detalles[empresa]) setDetalles(prev => ({ ...prev, [empresa]: [...(prev[empresa] || []), ...nuevas] }));
    return nuevas.length;
  };

  const aplicarImport = async () => {
    const validos = (importRows || []).filter(r => r.valido);
    if (!validos.length) return;
    if (!confirm(`¿Aplicar ${validos.length} línea(s) (viajes / cargos / descuentos) a las prefacturas de la semana? Quedan en borrador y auditadas.`)) return;
    setImportBusy(true);
    const grupos = {};
    for (const r of validos) { const k = `${r.empresa}||${r.sc}`; (grupos[k] = grupos[k] || { empresa: r.empresa, sc: r.sc, items: [] }).items.push(r); }
    let ok = 0, fail = 0; const errores = [];
    for (const k of Object.keys(grupos)) {
      const g = grupos[k];
      try { await _aplicarAjustesGrupo(g.empresa, g.sc, g.items); ok += g.items.length; }
      catch (e) { fail += g.items.length; errores.push(`${g.empresa}·${g.sc}: ${e.message || e}`); }
    }
    await cargarResumen(semana);
    setImportBusy(false); setImportRows(null); setImportOpen(false);
    setMsg({ ok: fail === 0, txt: `Importación: ${ok} ajuste(s) aplicados, ${fail} con error.` + (errores.length ? " — " + errores.join(" | ") : "") });
  };
  const quitarImportados = async () => {
    if (!confirm(`¿Quitar TODAS las líneas importadas por Excel de la semana ${semana} (viajes y ajustes)?\n\nLas líneas del cálculo normal (motor) se conservan. Esto no se puede deshacer.`)) return;
    setImportBusy(true);
    try {
      const { data: concs } = await sb.from("conciliaciones_terceros").select("*").eq("semana", semana);
      let quitadas = 0, afectadas = 0;
      for (const c of (concs || [])) {
        const det = Array.isArray(c.detalle) ? c.detalle : [];
        const limpio = det.filter(d => !(d && (d.importado === true || String(d._id || "").startsWith("imp|"))));
        const nQuit = det.length - limpio.length;
        if (!nQuit) continue;
        quitadas += nQuit; afectadas++;
        if (limpio.length === 0) {
          await sb.from("conciliaciones_terceros").delete().eq("empresa_nombre", c.empresa_nombre).eq("service_center", c.service_center).eq("semana", semana);
        } else {
          await guardarBorradorSC(c.empresa_nombre, c.service_center, limpio, Number(c.total_cobros || 0));
        }
        await auditarAjuste(c.empresa_nombre, c.service_center, "quitar_importados", "importado", null, `Quitó ${nQuit} línea(s) importada(s)`);
      }
      setDetalles({});
      await cargarResumen(semana);
      setImportOpen(false); setImportRows(null);
      setMsg({ ok: true, txt: `Se quitaron ${quitadas} línea(s) importada(s) en ${afectadas} prefactura(s) de la semana ${semana}.` });
    } catch (e) { console.error("quitar importados:", e); setMsg({ ok: false, txt: "Error quitando importadas: " + (e.message || e) }); }
    setImportBusy(false);
  };
  const construirPrefactura = (empresa, sc, filasSC, rSC, cobrosOverride) => {
    const tot = recalcSC(filasSC, cobrosOverride != null ? cobrosOverride : cobrosDe(empresa, sc));
    const t = transpPorNorm[norm(empresa)] || {};
    const par = paramPorSC[norm(sc)] || {};
    const { inicio, fin } = rangoSemanaInventario(semana);
    const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
    const periodo = `${String(inicio.getUTCDate()).padStart(2, "0")} DE ${MESES[inicio.getUTCMonth()]} AL ${String(fin.getUTCDate()).padStart(2, "0")} DE ${MESES[fin.getUTCMonth()]}`;
    const mesFactura = MESES[fin.getUTCMonth()].toLowerCase() + "-" + String(fin.getUTCFullYear()).slice(2);
    const operacion = "ML_MX_" + sc;

    const porPatente = {};
    for (const d of filasSC) {
      const p = d.placa || "—";
      if (!porPatente[p]) porPatente[p] = { entregados: 0, neto: 0 };
      porPatente[p].entregados += Number(d.entregado || 0);
      porPatente[p].neto += Number(d.monto || 0);
    }
    const noPagos = filasSC.filter(d => d.es_no_pago);
    const bonos = filasSC.filter(d => d.tiene_bonificacion || Number(d.monto_bonificacion || 0) > 0);
    const bonoHtml = bonos.length ? `
      <div class="bono">
        <div class="bono-title">✓ Tarifa final ya contiene incluido el pago de la bonificación</div>
        ${bonos.map(d => `<div class="bono-row">${fmtFechaDDMM(d.fecha)} · ${d.placa} · Ruta ${d.id_ruta} · ${d.driver_name || ""} — ${d.bonificacion_nombre || "Bonificación"} (+${fmtPct(d.bonificacion_pct)}) = +${fmtMon(d.monto_bonificacion)}</div>`).join("")}
      </div>` : "";

    const filasDetalle = filasSC.map(d => `
      <tr>
        <td>${fmtFechaDDMM(d.fecha)}</td><td>${d.placa || ""}</td><td>${d.id_ruta || ""}</td>
        <td style="text-align:left">${d.driver_name || ""}</td><td>${(() => { const a = auxMap[String(d.id_ruta)]; return (a && String(a.decision).toLowerCase() === "aprobado") ? "Si" : "No"; })()}</td>
        <td>${d.service_center_id || ""}</td><td>${d.cargado ?? ""}</td><td>${d.entregado ?? ""}</td>
        <td>${fmtPct(d.pct_entrega)}</td><td>${fmtKm(d.km_pago)}</td><td>${fmtFactor(d.factor_ns)}</td>
        <td style="color:#166534;font-weight:600">${(d.tiene_bonificacion || Number(d.monto_bonificacion||0) > 0) ? ("+" + fmtMon(d.monto_bonificacion)) : "—"}</td>
        <td style="text-align:right">${d.es_no_pago ? "$ -" : fmtMon(d.monto)}</td>
      </tr>`).join("");
    const filasPatente = Object.entries(porPatente).map(([p, v]) => `
      <tr><td>${p}</td><td>${v.entregados}</td><td style="text-align:right">${fmtMon(v.neto)}</td></tr>`).join("");
    const obsHtml = noPagos.length ? `
      <div class="obs">
        <div class="obs-title">OBSERVACIONES — RUTAS NO PAGADAS (VISITA &lt; 90%)</div>
        ${noPagos.map(d => `<div class="obs-row">${fmtFechaDDMM(d.fecha)} · ${d.placa} · Ruta ${d.id_ruta} · ${d.driver_name || ""} — ${d.motivo_no_pago || "NO PAGADO"} (cargado ${d.cargado}, entregado ${d.entregado}, entrega ${fmtPct(d.pct_entrega)})</div>`).join("")}
      </div>` : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prefactura ${empresa} ${sc} ${periodo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family: Arial, Helvetica, sans-serif; }
  body { padding: 28px 32px; color:#1a1a1a; font-size:11px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; background:#F47B20; color:#fff; padding:14px 18px; border-radius:4px; }
  .head h1 { font-size:26px; letter-spacing:1px; }
  .head .sub { font-size:9px; margin-top:4px; line-height:1.5; font-weight:600; }
  .logo { font-size:26px; font-weight:800; font-style:italic; }
  .logo small { display:block; font-size:8px; letter-spacing:2px; font-style:normal; text-align:right; }
  .cols { display:flex; justify-content:space-between; gap:24px; margin-top:16px; }
  table { border-collapse:collapse; }
  .info td { border:1px solid #cdd3dc; padding:4px 8px; font-size:10px; }
  .info td.k { background:#e8ebf0; font-weight:700; width:170px; }
  .info td.v { background:#f5f6f8; min-width:230px; }
  .pat th { background:#404040; color:#fff; padding:4px 10px; font-size:9px; }
  .pat td { border:1px solid #cdd3dc; padding:4px 10px; text-align:center; font-size:10px; }
  .pat .tt { background:#595959; color:#fff; font-weight:700; text-align:center; padding:4px 10px; font-size:10px; }
  .tot { margin-top:14px; }
  .tot td { border:1px solid #cdd3dc; padding:4px 8px; font-size:10px; }
  .tot td.k { background:#e8ebf0; font-weight:700; width:170px; }
  .tot td.v { background:#f5f6f8; text-align:right; width:110px; font-weight:700; }
  .det { margin-top:22px; width:100%; }
  .det-title { font-weight:800; font-size:10px; margin-bottom:4px; color:#1a3a6b; }
  .det th { background:#F47B20; color:#fff; padding:5px 6px; font-size:9px; }
  .det td { padding:4px 6px; text-align:center; border-bottom:1px solid #eef0f3; font-size:10px; }
  .obs { margin-top:18px; border:1px solid #fca5a5; background:#fef2f2; border-radius:4px; padding:10px 12px; }
  .obs-title { font-weight:800; font-size:10px; color:#991b1b; margin-bottom:6px; }
  .obs-row { font-size:10px; color:#7f1d1d; padding:2px 0; }
  .bono { margin-top:14px; border:1px solid #86efac; background:#f0fdf4; border-radius:4px; padding:10px 12px; }
  .bono-title { font-weight:800; font-size:10px; color:#166534; margin-bottom:6px; }
  .bono-row { font-size:10px; color:#14532d; padding:2px 0; }
  @media print { body { padding: 10mm 12mm; } .noprint { display:none; } }
  .noprint { margin-top:24px; } .noprint button { padding:8px 18px; background:#1a3a6b; color:#fff; border:none; border-radius:6px; font-size:13px; cursor:pointer; }
</style></head><body>
  <div class="head">
    <div>
      <h1>PREFACTURA</h1>
      <div class="sub">ADMINISTRADORA DE SERVICIOS BIGTICKET MX S.A DE C.V<br/>
      Servicios de mensajería y paquetería local<br/>
      RFC: ASB250618323 // DIRECCION: Juan Vázquez de Mella 481, Miguel Hidalgo // CODIGO POSTAL: 11510 // REGIMEN: General de Ley de Personas Morales</div>
    </div>
    <div class="logo"><img src="${LOGO_PREFACTURA_B64}" alt="bigticket logística y transporte" style="height:50px;display:block"/></div>
  </div>
  <div class="cols">
    <div>
      <table class="info">
        <tr><td class="k">EMPRESA TRANSPORTE:</td><td class="v">${empresa}</td></tr>
        <tr><td class="k">RFC EMPRESA TRANSPORTE:</td><td class="v">${t.rfc || "—"}</td></tr>
        <tr><td class="k">OPERACIÓN:</td><td class="v">${operacion}</td></tr>
        <tr><td class="k">SUPERVISOR:</td><td class="v">${par.supervisor || "—"}</td></tr>
        <tr><td class="k">PERIODO PREFACTURADO:</td><td class="v">${periodo}</td></tr>
        <tr><td class="k">MES FACTURA:</td><td class="v">${mesFactura}</td></tr>
        <tr><td class="k">VALOR UF:</td><td class="v">N/A</td></tr>
      </table>
      <table class="tot">
        <tr><td class="k">TOTAL NETO A FACTURAR</td><td class="v">${fmtMon(tot.neto)}</td></tr>
        <tr><td class="k">IVA 16%</td><td class="v">${fmtMon(tot.iva)}</td></tr>
        <tr><td class="k">BRUTO FACTURA</td><td class="v">${fmtMon(tot.bruto)}</td></tr>
      </table>
      <table class="tot">
        <tr><td class="k">TOTAL COBROS</td><td class="v">${tot.cobros ? fmtMon(tot.cobros) : ""}</td></tr>
        <tr><td class="k">LÍQUIDO PAGO</td><td class="v">${fmtMon(tot.liquido)}</td></tr>
      </table>
    </div>
    <div>
      <table class="pat">
        <tr><td class="tt" colspan="3">RESUMEN POR PATENTE:</td></tr>
        <tr><th>PATENTE</th><th>ENTREGADOS</th><th>NETO PATENTE</th></tr>
        ${filasPatente}
      </table>
    </div>
  </div>
  <div class="det-title" style="margin-top:22px">DETALLE DE VIAJES — ${operacion}:</div>
  <table class="det">
    <tr><th>FECHA</th><th>PATENTE</th><th>ID RUTA</th><th>CONDUCTOR</th><th>AUXILIAR</th><th>SECTOR</th><th>CARGADO</th><th>ENTREGADO</th><th>%</th><th>KM PAGO</th><th>FACTOR</th><th>BONIF.</th><th>MONTO</th></tr>
    ${filasDetalle}
  </table>
  ${bonoHtml}
  ${obsHtml}
  <div class="noprint"><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
</body></html>`;
    const nombrePdf = `Prefactura_${String(empresa).replace(/[^A-Za-z0-9]+/g, "_")}_${sc}_${periodo.replace(/ /g, "_")}.pdf`;
    return { html, periodo, operacion, mesFactura, tot, nombrePdf, t, par };
  };

  const generarPDF = (empresa, sc, filasSC, rSC) => {
    if (!filasSC || !filasSC.length) return alert("Sin viajes para " + empresa + " en " + sc + ".");
    const { html } = construirPrefactura(empresa, sc, filasSC, rSC);
    const w = window.open("", "_blank");
    if (!w) return alert("El navegador bloqueó la ventana emergente. Habilitá pop-ups para generar el PDF.");
    w.document.write(html); w.document.close();
  };

  // ── Envío por correo: webhook n8n -> VPS genera PDF -> SMTP ──
  const WEBHOOK_ENVIO_MX = "https://bigticket2026.app.n8n.cloud/webhook/prefacturas-conciliacion-mx";

  const enviarUno = async (empresa, sc, filasSC, rSC, opts) => {
    const { html, periodo, operacion, nombrePdf, t, tot } = construirPrefactura(empresa, sc, filasSC, rSC, opts && opts.cobros);
    const correoTo = ((opts && opts.to) || t.correo_to || "").trim();
    const cc = ((opts && opts.cc) || t.correo_cc || "").trim();
    const bcc = (t.correo_bcc || "").trim();
    if (!correoTo) throw new Error("Sin correo destino para " + empresa + " · " + sc);
    const asunto = (opts && opts.asunto) || aplicarVarsCorreo(asuntoLote, empresa, sc, periodo, operacion);
    const cuerpo = (opts && opts.cuerpo) || aplicarVarsCorreo(cuerpoLote, empresa, sc, periodo, operacion);
    const resp = await fetch(WEBHOOK_ENVIO_MX, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idEnvio: `${empresa}|${sc}|${semana}|${Date.now()}`, transportista: empresa, ceco: sc, rfc: t.rfc || "", operacion, periodo, correoTo, cc, bcc, asunto, cuerpo, nombrePdf, html }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok !== true) throw new Error((data && data.error) || ("Error HTTP " + resp.status));
    await sb.from("conciliaciones_terceros").update({
      estado: "enviada", enviado_at: new Date().toISOString(),
      enviado_por: (usuario && (usuario.nombre || usuario.email)) || "Brain",
      message_id: data.messageId || null, correo_to: correoTo, correo_cc: cc, asunto, cuerpo, nombre_pdf: nombrePdf,
    }).eq("empresa_nombre", empresa).eq("service_center", sc).eq("semana", semana);
    await logEvento(empresa, sc, "enviar", tot, { estado: "enviada", detalle: { message_id: data.messageId || null, correo_to: correoTo } });
    return data.messageId;
  };

  const abrirEnvio = (empresa, sc, filasSC, rSC) => {
    const t = transpPorNorm[norm(empresa)] || {};
    const { periodo, operacion, tot } = construirPrefactura(empresa, sc, filasSC, rSC);
    setModalEnvio({ empresa, sc, filasSC, rSC, to: t.correo_to || "", cc: t.correo_cc || "",
      asunto: aplicarVarsCorreo(asuntoLote, empresa, sc, periodo, operacion),
      cuerpo: aplicarVarsCorreo(cuerpoLote, empresa, sc, periodo, operacion) });
  };

  const confirmarEnvioModal = async () => {
    const m = modalEnvio; if (!m) return;
    if (!m.to.trim()) return alert("Falta el correo destino (To).");
    const clave = claveCierre(m.empresa, m.sc); setEnviando(clave);
    try {
      await enviarUno(m.empresa, m.sc, m.filasSC, m.rSC, { to: m.to, cc: m.cc, asunto: m.asunto, cuerpo: m.cuerpo });
      setModalEnvio(null);
      setMsg({ ok: true, txt: `Prefactura enviada: ${m.empresa} · ${m.sc} → ${m.to}` });
      await cargarResumen(semana);
    } catch (e) { console.error("enviar prefactura:", e); setMsg({ ok: false, txt: `Error enviando ${m.empresa}: ` + (e.message || e) }); }
    setEnviando(null);
  };

  const toggleSeleccion = (empresa, sc) => {
    const clave = claveCierre(empresa, sc);
    setSeleccion(prev => { const n = new Set(prev); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; });
  };

  const enviarSeleccionados = async () => {
    if (!seleccion.size) return;
    const { data: rows, error } = await sb.from("conciliaciones_terceros").select("*").eq("semana", semana);
    if (error) { setMsg({ ok: false, txt: "Error leyendo conciliaciones: " + error.message }); return; }
    const porClave = {}; for (const r of (rows || [])) porClave[claveCierre(r.empresa_nombre, r.service_center)] = r;
    const items = [...seleccion].map(cl => {
      const r = porClave[cl]; if (!r) return null;
      const tt = transpPorNorm[norm(r.empresa_nombre)] || {};
      return { empresa: r.empresa_nombre, sc: r.service_center, detalle: Array.isArray(r.detalle) ? r.detalle : [], cobros: Number(r.total_cobros || 0), to: tt.correo_to || "" };
    }).filter(Boolean);
    const txt = items.map(i => `• ${i.empresa} · ${i.sc} → ${i.to || "SIN CORREO"}`).join("\n");
    if (!confirm(`¿Enviar ${items.length} prefactura(s)?\n\n${txt}`)) return;
    setEnviando("__lote__");
    let ok = 0, fail = 0; const errores = [];
    for (const it of items) {
      if (!it.to) { fail++; errores.push(`${it.empresa}·${it.sc}: sin correo`); continue; }
      if (!it.detalle.length) { fail++; errores.push(`${it.empresa}·${it.sc}: sin detalle congelado`); continue; }
      try { await enviarUno(it.empresa, it.sc, it.detalle, null, { cobros: it.cobros }); ok++; }
      catch (e) { fail++; errores.push(`${it.empresa}·${it.sc}: ${e.message || e}`); }
    }
    setEnviando(null); setSeleccion(new Set()); await cargarResumen(semana);
    setMsg({ ok: fail === 0, txt: `Envío masivo: ${ok} enviada(s), ${fail} con error.` + (errores.length ? " — " + errores.join(" | ") : "") });
  };
  // ── Cierre / envío MASIVO (toda la semana) ──
  const cerrarUno = async (empresa, sc) => {
    let filas = null, cobros = 0;
    const { data: row } = await sb.from("conciliaciones_terceros").select("*").eq("empresa_nombre", empresa).eq("service_center", sc).eq("semana", semana).maybeSingle();
    if (row && Array.isArray(row.detalle) && row.detalle.length) { filas = row.detalle; cobros = Number(row.total_cobros || 0); }
    else { const { data } = await sb.rpc("get_conciliacion_terceros_detalle", { p_semana: semana, p_empresa: empresa, p_sc: sc }); filas = data || []; cobros = cobrosDe(empresa, sc); }
    const prev = saldoPrevioDe(empresa, sc);
    if (!filas.length && prev === 0) return { skip: true };
    const filasFull = filasConSaldoLine(empresa, sc, filas);
    const tot = recalcSC(filasFull, cobros);
    const netoViajes = Math.round(filasFull.filter(d => !d._saldo).reduce((s, d) => s + Number(d.monto || 0), 0) * 100) / 100;
    const negativo = tot.negativo;
    const estado = negativo ? "pendiente_conciliacion" : "cerrada";
    const lunes = rangoSemanaInventario(semana).inicio.toISOString().slice(0, 10);
    const ahora = new Date().toISOString();
    const { error } = await sb.from("conciliaciones_terceros").upsert({
      empresa_nombre: empresa, service_center: sc, semana, semana_inicio: lunes, estado,
      total_neto: tot.neto, iva_16: tot.iva, total_bruto: tot.bruto, liquido_pago: tot.liquido, total_cobros: tot.cobros,
      n_viajes: tot.nViajes, n_no_pago: tot.nNoPago, detalle: filasFull, tiene_ajustes: true,
      generado_at: ahora, cerrado_at: ahora, cerrado_por: (usuario && (usuario.nombre || usuario.email)) || "Brain",
    }, { onConflict: "empresa_nombre,service_center,semana" });
    if (error) throw error;
    const _manualLines = filasFull.filter(d => d._manual);
    const _manualSum = Math.round(_manualLines.reduce((s, d) => s + Number(d.monto || 0), 0) * 100) / 100;
    const _netoParaSaldo = Math.round((netoViajes + _manualSum) * 100) / 100;
    if (prev < 0 || _netoParaSaldo < 0) await persistirSaldoCierre(empresa, sc, _netoParaSaldo);
    for (const ml of _manualLines) await conciliarSaldoManual(empresa, ml._origenSC, sc);
    if (_manualLines.length) setAplicManual(prev => { const cp = { ...prev }; delete cp[`${norm(empresa)}||${norm(sc)}`]; return cp; });
    await logEvento(empresa, sc, negativo ? "cerrar_pendiente" : "cerrar", { neto: tot.neto, bruto: tot.bruto, liquido: tot.liquido, nViajes: tot.nViajes }, { estado, detalle: { masivo: true, saldoPrevio: prev, netoViajes } });
    return { ok: true, negativo, neteado: tot.neto, liquido: tot.liquido };
  };
  const cerrarTodo = async () => {
    const items = resumen.filter(r => r.empresa && r.empresa !== SIN_EMPRESA && Number(r.n_viajes || 0) > 0 && r.estado_conciliacion !== "enviada").map(r => ({ empresa: r.empresa, sc: r.service_center }));
    if (!items.length) return alert("No hay prefacturas para cerrar en la semana " + semana + ".");
    if (!confirm(`\u26A0\uFE0F CERRAR TODO \u2014 semana ${semana} (${etiquetaSemanaInventario(semana)})\n\nVas a CERRAR ${items.length} prefactura(s). El detalle queda CONGELADO para PDF/env\u00edo.\nNo se env\u00edan correos a transportistas (eso es \"Enviar todo\"), pero S\u00cd se enviar\u00e1 el informe de cierre al equipo interno.\n\n\u00bfContinuar?`)) return;
    setCerrando("__todo__");
    let ok = 0, fail = 0, skip = 0; const errores = [], pendientes = [];
    for (const it of items) {
      try { const r = await cerrarUno(it.empresa, it.sc);
        if (r && r.skip) skip++;
        else { ok++; if (r && r.negativo) pendientes.push({ e: it.empresa, sc: it.sc, n: r.neteado }); } }
      catch (e) { fail++; errores.push(`${it.empresa}\u00b7${it.sc}: ${e.message || e}`); }
    }
    await guardarPlacasSinEmpresa();
    setCerrando(null); await cargarResumen(semana);
    if (pendientes.length) alert(`Quedan estas empresas con saldo negativo (se consolidarán en los siguientes pagos):\n\n${pendientes.map(p => `• ${p.e} · ${p.sc}  (${fmtMon(p.n)})`).join("\n")}\n\nSe guardaron como "pendiente de conciliación" y NO se enviarán.`);
    setMsg({ ok: fail === 0, txt: `Cierre masivo: ${ok} cerrada(s)${pendientes.length ? `, ${pendientes.length} pendiente(s) de conciliaci\u00f3n` : ""}${skip ? `, ${skip} sin viajes` : ""}, ${fail} con error.` + (errores.length ? " \u2014 " + errores.join(" | ") : "") });
    if (fail === 0 && ok > 0) { try { await generarReporteCierre({}); } catch (e) { console.error("reporte cierre:", e); } }
  };
  const enviarTodo = async () => {
    const { data: rows, error } = await sb.from("conciliaciones_terceros").select("*").eq("semana", semana);
    if (error) { setMsg({ ok: false, txt: "Error leyendo conciliaciones: " + error.message }); return; }
    const cerradas = (rows || []).filter(r => r.estado === "cerrada");
    const negativas = cerradas.filter(r => Number(r.liquido_pago || 0) < 0);
    const enviables = cerradas.filter(r => Number(r.liquido_pago || 0) >= 0);
    if (!enviables.length) return alert("No hay prefacturas cerradas (no negativas) para enviar. Primero cerr\u00e1 todo.");
    const sinCorreo = enviables.filter(r => !((transpPorNorm[norm(r.empresa_nombre)] || {}).correo_to));
    if (!confirm(`\uD83D\uDCE7 ENVIAR TODO \u2014 semana ${semana}\n\nSe enviar\u00e1n ${enviables.length} prefactura(s) cerradas.\n${negativas.length ? `\u26A0\uFE0F ${negativas.length} negativa(s) NO se env\u00edan (quedan para arrastre).\n` : ""}${sinCorreo.length ? `\u26A0\uFE0F ${sinCorreo.length} sin correo (se omiten).\n` : ""}\n\u00bfContinuar?`)) return;
    setEnviando("__todo__");
    let ok = 0, fail = 0; const errores = [];
    for (const r of enviables) {
      const tt = transpPorNorm[norm(r.empresa_nombre)] || {};
      if (!tt.correo_to) { fail++; errores.push(`${r.empresa_nombre}\u00b7${r.service_center}: sin correo`); continue; }
      try { await enviarUno(r.empresa_nombre, r.service_center, Array.isArray(r.detalle) ? r.detalle : [], null, { cobros: Number(r.total_cobros || 0) }); ok++; }
      catch (e) { fail++; errores.push(`${r.empresa_nombre}\u00b7${r.service_center}: ${e.message || e}`); }
    }
    setEnviando(null); await cargarResumen(semana);
    setMsg({ ok: fail === 0, txt: `Env\u00edo masivo: ${ok} enviada(s), ${negativas.length} negativa(s) retenida(s), ${fail} con error.` + (errores.length ? " \u2014 " + errores.join(" | ") : "") });
  };
  const abrirTodo = async () => {
    const { data: rows } = await sb.from("conciliaciones_terceros").select("*").eq("semana", semana);
    const cerradas = (rows || []).filter(r => r.estado && r.estado !== "borrador");
    if (!cerradas.length) return alert("No hay prefacturas cerradas/enviadas para abrir en la semana " + semana + ".");
    if (!confirm(`\uD83D\uDD13 ABRIR TODO \u2014 semana ${semana}\n\nVas a reabrir ${cerradas.length} prefactura(s): vuelven a BORRADOR. Es para pruebas.\n\n\u00bfContinuar?`)) return;
    setCerrando("__abrir__");
    let ok = 0, fail = 0;
    for (const r of cerradas) {
      try {
        const { error } = await sb.from("conciliaciones_terceros").update({ estado: "borrador", abierto_at: new Date().toISOString(), abierto_por: (usuario && (usuario.nombre || usuario.email)) || "Brain" }).eq("empresa_nombre", r.empresa_nombre).eq("service_center", r.service_center).eq("semana", semana);
        if (error) throw error;
        await logEvento(r.empresa_nombre, r.service_center, "reabrir", null, { estado: "borrador", detalle: { masivo: true } });
        ok++;
      } catch (e) { fail++; }
    }
    setCerrando(null); await cargarResumen(semana);
    setMsg({ ok: fail === 0, txt: `Reapertura masiva: ${ok} reabierta(s), ${fail} con error.` });
  };

  // ── Reporte de cierre consolidado (Excel) → correo automático al equipo ──
  const WEBHOOK_REPORTE_MX = "https://bigticket2026.app.n8n.cloud/webhook/reporte-cierre-mx";
  const REPORTE_CIERRE_TO = "esteban.dussaut@bigticket.cl,alejandra.degollada@bigticket.cl,nicole.vargas@bigticket.cl,yaritza.medina@bigticket.cl,eduardo.stine@bigticket.cl,adriana.giummarra@bigticket.cl";
  const [reporteTo, setReporteTo] = useState(() => { try { return localStorage.getItem("conc_mx_reporte_to") || REPORTE_CIERRE_TO; } catch (e) { return REPORTE_CIERRE_TO; } });
  const CUERPO_REPORTE_CIERRE = "Estimados,\n\nEl motivo de este correo es para adjuntar el informe de cierre de prefacturas de la semana.\n\n\nSaludos cordiales";
  const fmtPeriodoReporte = (ini, fin) => {
    const M = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
    const f = (d) => { const [y, mo, da] = d.toISOString().slice(0, 10).split("-"); return `${da} ${M[(+mo) - 1]}${y.slice(2)}`; };
    return `${f(ini)} AL ${f(fin)}`;
  };
  const generarReporteCierre = async (opts) => {
    const silent = !!(opts && opts.silent);
    const { data: rows, error } = await sb.from("conciliaciones_terceros").select("*").eq("semana", semana);
    if (error) { if (!silent) setMsg({ ok: false, txt: "Error leyendo conciliaciones para el reporte: " + error.message }); return null; }
    const cerradas = (rows || []).filter(r => r.estado === "cerrada" || r.estado === "enviada");
    if (!cerradas.length) { if (!silent) setMsg({ ok: false, txt: "No hay prefacturas cerradas para generar el reporte." }); return null; }
    if (!(await asegurarXLSX())) { if (!silent) setMsg({ ok: false, txt: "No se pudo cargar la librería de Excel." }); return null; }
    const { inicio, fin } = rangoSemanaInventario(semana);
    const periodo = fmtPeriodoReporte(inicio, fin);
    cerradas.sort((a, b) => String(a.service_center || "").localeCompare(String(b.service_center || "")) || String(a.empresa_nombre || "").localeCompare(String(b.empresa_nombre || "")));
    const aoa = [["PERIODO DE PAGO", "CLIENTE", "OPERACIÓN", "TRANSPORTE", "RFC", "NETO", "IVA", "BRUTO"]];
    let tNeto = 0, tIva = 0, tBruto = 0;
    for (const r of cerradas) {
      const tt = transpPorNorm[norm(r.empresa_nombre)] || {};
      const neto = Number(r.total_neto || 0), iva = Number(r.iva_16 || 0), bruto = Number(r.total_bruto || 0);
      tNeto += neto; tIva += iva; tBruto += bruto;
      aoa.push([periodo, "MERCADO LIBRE", `ML_MX_${r.service_center || ""}`, r.empresa_nombre, tt.rfc || "", neto, iva, bruto]);
    }
    aoa.push(["", "", "", "TOTAL", "", tNeto, tIva, tBruto]);
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 36 }, { wch: 16 }, { wch: 13 }, { wch: 12 }, { wch: 13 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Cierre");
    const b64 = window.XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const nombreArchivo = `Cierre_prefacturas_sem${semana}_${periodo.replace(/\s+/g, "_")}.xlsx`;
    const to = (opts && opts.to) || reporteTo;
    let enviado = false, messageId = null, errEnvio = "";
    try {
      const resp = await fetch(WEBHOOK_REPORTE_MX, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ semana, periodo, to, cc: "", asunto: `Informe de cierre de prefacturas — ${periodo}`, cuerpo: CUERPO_REPORTE_CIERRE, nombreArchivo, xlsxBase64: b64 }),
      });
      const data = await resp.json().catch(() => ({}));
      enviado = resp.ok && data.ok === true; messageId = data.messageId || null;
      if (!enviado) errEnvio = (data && data.error) || ("HTTP " + resp.status);
    } catch (e) { errEnvio = e.message || String(e); }
    try {
      await sb.from("reportes_cierre").insert({
        semana, periodo, generado_por: (usuario && (usuario.nombre || usuario.email)) || "Brain",
        destinatarios: to, n_prefacturas: cerradas.length, total_neto: tNeto, total_iva: tIva, total_bruto: tBruto,
        nombre_archivo: nombreArchivo, archivo_base64: b64, enviado, message_id: messageId,
      });
    } catch (e) { console.error("guardar reporte_cierre:", e); }
    try { await logEvento("(REPORTE)", "-", "reporte_cierre", { neto: tNeto, bruto: tBruto, liquido: tBruto, nViajes: cerradas.length }, { detalle: { enviado, destinatarios: to, nombreArchivo } }); } catch (e) {}
    if (!silent) setMsg({ ok: enviado, txt: enviado ? `Informe de cierre (${cerradas.length} prefacturas, ${periodo}) enviado a: ${to}` : `Informe generado y guardado, pero el envío falló: ${errEnvio}. Podés reintentar desde Historial de Pago.` });
    return { enviado, nombreArchivo, b64, n: cerradas.length, periodo, totales: { tNeto, tIva, tBruto } };
  };
  // ── Helpers de render ──
  const chipEstado = (estado) => {
    const map = {
      sin_generar: { bg: "#f1f5f9", fg: "#64748b", txt: "Sin generar" },
      borrador: { bg: "#fef9c3", fg: "#854d0e", txt: "Borrador" },
      cerrada: { bg: "#dcfce7", fg: "#166534", txt: "Cerrada" },
      pendiente_conciliacion: { bg: "#ffedd5", fg: "#9a3412", txt: "Pend. conciliación" },
      enviada: { bg: "#dbeafe", fg: "#1e40af", txt: "Enviada" },
    };
    const c = map[estado] || map.sin_generar;
    return <span style={{ background: c.bg, color: c.fg, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>{c.txt}</span>;
  };

  const opcionesTransp = useMemo(() => {
    const set = new Set(transportistas.map(t => t.nombre));
    for (const r of resumen) if (r.empresa && r.empresa !== SIN_EMPRESA) set.add(r.empresa);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [transportistas, resumen]);

  const totalSemana = Math.round(empresasAgrupadas.reduce((s, g) => { const esSin = g.empresa === SIN_EMPRESA; return s + g.filasSC.reduce((a, rSC) => a + netoSCneteado(g.empresa, rSC, esSin), 0); }, 0) * 100) / 100;
  const totalViajes = resumen.reduce((s, r) => s + Number(r.n_viajes || 0), 0);
  const sinEmpresaG = empresasAgrupadas.find(g => g.empresa === SIN_EMPRESA);

  // ── Editor de líneas por SC (solo en borrador/sin_generar) ──
  const renderEditorSC = (empresa, rSC) => {
    const sc = rSC.service_center;
    const clave = claveCierre(empresa, sc);
    const editandoEsta = formLinea && formLinea.empresa === empresa && formLinea.sc === sc;
    const cobros = cobrosDe(empresa, sc);
    return (
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={(e) => { e.stopPropagation(); abrirAgregarLinea(empresa, sc, "ajuste"); }}
            style={{ padding: "5px 10px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>＋ Ajuste manual</button>
          <button onClick={(e) => { e.stopPropagation(); abrirAgregarLinea(empresa, sc, "viaje"); }}
            style={{ padding: "5px 10px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>＋ Viaje completo</button>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569" }}>
            Total cobros:
            <input type="number" value={cobros || ""} onClick={e => e.stopPropagation()}
              onChange={e => cambiarCobros(empresa, sc, e.target.value)} onBlur={() => guardarCobros(empresa, sc)}
              style={{ width: 120, padding: "5px 8px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 12, textAlign: "right" }} />
          </span>
        </div>
        {editandoEsta && (
          <div onClick={e => e.stopPropagation()} style={{ border: "1px solid #bfdbfe", background: "#f8fbff", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1d4ed8", marginBottom: 8 }}>Nueva línea — {formLinea.tipo === "ajuste" ? "Ajuste manual" : "Viaje completo"} (SC {sc})</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {formLinea.tipo === "ajuste" ? (
                <>
                  <input placeholder="Concepto (ej. Ajuste, Bono manual)" value={formLinea.concepto} onChange={e => setFormLinea({ ...formLinea, concepto: e.target.value })} style={inpEdit(260)} />
                  <input placeholder="Fecha YYYY-MM-DD (opcional)" value={formLinea.fecha} onChange={e => setFormLinea({ ...formLinea, fecha: e.target.value })} style={inpEdit(170)} />
                  <input type="number" placeholder="Monto (+/-)" value={formLinea.monto} onChange={e => setFormLinea({ ...formLinea, monto: e.target.value })} style={inpEdit(150)} />
                </>
              ) : (
                <>
                  <input placeholder="Fecha YYYY-MM-DD" value={formLinea.fecha} onChange={e => setFormLinea({ ...formLinea, fecha: e.target.value })} style={inpEdit(140)} />
                  <input placeholder="Patente" value={formLinea.placa} onChange={e => setFormLinea({ ...formLinea, placa: e.target.value })} style={inpEdit(120)} />
                  <input placeholder="ID Ruta" value={formLinea.id_ruta} onChange={e => setFormLinea({ ...formLinea, id_ruta: e.target.value })} style={inpEdit(120)} />
                  <input placeholder="Conductor" value={formLinea.driver_name} onChange={e => setFormLinea({ ...formLinea, driver_name: e.target.value })} style={inpEdit(200)} />
                  <input type="number" placeholder="Cargado" value={formLinea.cargado} onChange={e => setFormLinea({ ...formLinea, cargado: e.target.value })} style={inpEdit(90)} />
                  <input type="number" placeholder="Entregado" value={formLinea.entregado} onChange={e => setFormLinea({ ...formLinea, entregado: e.target.value })} style={inpEdit(90)} />
                  <input type="number" placeholder="KM Pago" value={formLinea.km_pago} onChange={e => setFormLinea({ ...formLinea, km_pago: e.target.value })} style={inpEdit(90)} />
                  <input type="number" placeholder="Monto" value={formLinea.monto} onChange={e => setFormLinea({ ...formLinea, monto: e.target.value })} style={inpEdit(120)} />
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={guardarLineaNueva} disabled={guardandoEdit === clave}
                style={{ padding: "6px 14px", background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: guardandoEdit === clave ? 0.6 : 1 }}>{guardandoEdit === clave ? "Guardando..." : "Agregar"}</button>
              <button onClick={() => setFormLinea(null)} style={{ padding: "6px 14px", background: "#fff", color: "#475569", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    );
  };
  const renderTablaDetalle = (filas, opts = {}) => (
    <div style={{ overflowX: "auto", marginTop: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ background: "#1a3a6b", color: "#fff" }}>
            {["Fecha", "Patente", "ID Ruta", "Conductor", "Aux", "SC", "Cargado", "Entregado", "% Entrega", "% Visita", "KM Pago", "KM Real", "Factor", "Bonif.", "Monto", ...(opts.editable ? ["✕"] : [])].map(h => (
              <th key={h} style={{ padding: "6px 8px", fontSize: 10, textAlign: h === "Conductor" ? "left" : "center", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((d, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eef0f3", background: d._saldo ? "#fff7ed" : (d.es_manual ? "#eff6ff" : (d.es_no_pago ? "#fef2f2" : (i % 2 ? "#fafbfc" : "#fff"))) }}>
              <td style={{ padding: "5px 8px", textAlign: "center", whiteSpace: "nowrap" }}>{fmtFechaDDMM(d.fecha)}</td>
              <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700 }} title={d.traspaso ? `Traspasado desde ${d.traspaso.de} (${String(d.traspaso.at || "").slice(0, 10)})` : undefined}>{d.placa}{d.traspaso ? " 🔁" : ""}</td>
              <td style={{ padding: "5px 8px", textAlign: "center" }}>{d.id_ruta}</td>
              <td style={{ padding: "5px 8px" }}>{d.driver_name}</td>
              <td style={{ padding: "5px 8px", textAlign: "center" }}>{(() => { const a = auxMap[String(d.id_ruta)]; return (a && String(a.decision).toLowerCase() === "aprobado") ? "Si" : "No"; })()}</td>
              <td style={{ padding: "5px 8px", textAlign: "center" }}>{d.service_center_id}</td>
              <td style={{ padding: "5px 8px", textAlign: "center" }}>{d.cargado}</td>
              <td style={{ padding: "5px 8px", textAlign: "center" }}>{d.entregado}</td>
              <td style={{ padding: "5px 8px", textAlign: "center" }}>{fmtPct(d.pct_entrega)}</td>
              <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 600, color: Number(d.pct_visitado_gate) < 90 ? "#dc2626" : "#16a34a" }}>{fmtPct(d.pct_visitado_gate)}</td>
              <td style={{ padding: "5px 8px", textAlign: "center" }}>{fmtKm(d.km_pago)}</td>
              <td style={{ padding: "5px 8px", textAlign: "center", color: "#94a3b8" }}>{fmtKm(d.km_real_meli)}</td>
              <td style={{ padding: "5px 8px", textAlign: "center" }}>{fmtFactor(d.factor_ns)}</td>
              <td style={{ padding: "5px 8px", textAlign: "center", whiteSpace: "nowrap" }}>{(d.tiene_bonificacion || Number(d.monto_bonificacion || 0) > 0) ? <span style={{ color: "#16a34a", fontWeight: 600 }}>{"+" + fmtMon(d.monto_bonificacion)}</span> : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: d._saldo ? "#9a3412" : (d.es_no_pago ? "#dc2626" : "#1a1a1a") }} title={d._editado ? `Editado: ${fmtMon(d.monto_original)} → ${fmtMon(d.monto)}${d.motivo_edicion ? " · " + d.motivo_edicion : ""}` : undefined}>{d.es_no_pago ? "$ -" : fmtMon(d.monto)}{d._editado ? " ✏️" : ""}</td>
              {opts.editable && (d._saldo ? <td style={{ padding: "5px 8px" }} /> : <td style={{ padding: "5px 8px", textAlign: "center", whiteSpace: "nowrap" }}><button onClick={(e) => { e.stopPropagation(); editarMontoLinea(opts.empresa, opts.sc, d); }} title="Editar monto de este viaje" style={{ background: "#dbeafe", color: "#1d4ed8", border: "none", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer", marginRight: 4 }}>✏️</button><button onClick={(e) => { e.stopPropagation(); eliminarLinea(opts.empresa, opts.sc, d); }} title="Eliminar línea" style={{ background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🗑</button></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      {/* Header + selector de semana */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a6b" }}>Conciliación Semanal Terceros</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Viajes del Listado de Pagos agrupados por empresa y separados por SC · una prefactura PDF por cada empresa + SC</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setSemana(s => s - 1)} style={{ padding: "6px 10px", border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>‹</button>
          <div style={{ textAlign: "center", minWidth: 150 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#1a3a6b" }}>Semana {semana}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{etiquetaSemanaInventario(semana)} · lun–dom</div>
          </div>
          <button onClick={() => setSemana(s => s + 1)} style={{ padding: "6px 10px", border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>›</button>
          <button onClick={refrescarTodo} style={{ marginLeft: 6, padding: "6px 12px", border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>↻ Refrescar</button>
          <button onClick={() => setEditorCorreoOpen(o => !o)} style={{ padding: "6px 12px", border: "1px solid #1a3a6b", background: editorCorreoOpen ? "#1a3a6b" : "#fff", color: editorCorreoOpen ? "#fff" : "#1a3a6b", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✉️ Cuerpo del correo</button>
        </div>
      </div>

      {editorCorreoOpen && (
        <div style={{ border: "1px solid #e4e7ec", background: "#f8fafc", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#1a3a6b", marginBottom: 2 }}>✉️ Cuerpo del correo (se aplica a TODAS las empresas y SC)</div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>Variables que se reemplazan por empresa/SC al enviar: <code>{"{TRANSPORTISTA}"}</code> = empresa · <code>{"{CECO}"}</code> = SC · <code>{"{PERIODO}"}</code> = semana · <code>{"{OPERACION}"}</code>. Las fechas XX/XX se editan a mano. El correo destino se define por empresa en su ficha.</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>Asunto</div>
          <input value={asuntoLote} onChange={e => setAsuntoLote(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 13, marginBottom: 10, boxSizing: "border-box" }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>Cuerpo</div>
          <textarea value={cuerpoLote} onChange={e => setCuerpoLote(e.target.value)} rows={12} style={{ width: "100%", padding: "8px 10px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
            <button onClick={() => { setAsuntoLote(ASUNTO_DEFAULT); setCuerpoLote(CUERPO_DEFAULT); }} style={{ padding: "6px 12px", background: "#fff", color: "#64748b", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>↺ Restaurar plantilla</button>
            <button onClick={() => setEditorCorreoOpen(false)} style={{ padding: "6px 12px", background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Listo</button>
          </div>
        </div>
      )}

      {msg && (
        <div style={{ background: msg.ok ? "#ecfdf5" : "#fef2f2", border: "1px solid " + (msg.ok ? "#a7f3d0" : "#fca5a5"), color: msg.ok ? "#065f46" : "#991b1b", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 12 }}>{msg.txt}</div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>✉ Informe a:</span>
          <input value={reporteTo} onChange={e => setReporteTo(e.target.value)} onBlur={e => { try { localStorage.setItem("conc_mx_reporte_to", e.target.value); } catch (er) {} }} title="Destinatarios del reporte de cierre (separados por coma). Para pruebas, dejá solo tu correo." style={{ width: 300, padding: "6px 8px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 11 }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={abrirTodo} disabled={cerrando === "__abrir__"} style={{ padding: "8px 16px", background: cerrando === "__abrir__" ? "#94a3b8" : "#fff", color: cerrando === "__abrir__" ? "#fff" : "#9a3412", border: "1px solid #fdba74", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{cerrando === "__abrir__" ? "Abriendo..." : "🔓 Abrir todo"}</button>
        <button onClick={cerrarTodo} disabled={cerrando === "__todo__"} style={{ padding: "8px 16px", background: cerrando === "__todo__" ? "#94a3b8" : "#166534", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{cerrando === "__todo__" ? "Cerrando..." : "🔒 Cerrar todo"}</button>
        <button onClick={enviarTodo} disabled={enviando === "__todo__"} style={{ padding: "8px 16px", background: enviando === "__todo__" ? "#94a3b8" : "#1e40af", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{enviando === "__todo__" ? "Enviando..." : "📧 Enviar todo"}</button>
        <button onClick={() => generarReporteCierre({})} title="Genera y envía el informe consolidado de la semana a los destinatarios de arriba" style={{ padding: "8px 16px", background: "#fff", color: "#1a3a6b", border: "1px solid #1a3a6b", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📄 Reporte</button>
        <button onClick={() => { setImportRows(null); setImportOpen(true); }} style={{ padding: "8px 16px", background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📥 Importar ajustes (Excel)</button>
        </div>
      </div>

      {importOpen && (
        <div onClick={() => !importBusy && setImportOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(900px, 94vw)", maxHeight: "88vh", overflow: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1a3a6b", marginBottom: 4 }}>Importar ajustes a prefacturas</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>Carga viajes, cargos o descuentos a la semana abierta. El <b>signo del monto manda</b> (+ suma, − resta, 0 también). Los avisos (ruta repetida, empresa nueva) <b>NO bloquean</b>: el analista decide. Empresa no registrada se crea como prefactura nueva.</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
              <button onClick={descargarPlantillaAjustes} style={{ padding: "6px 12px", background: "#fff", color: "#1a3a6b", border: "1px solid #1a3a6b", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>⬇ Descargar plantilla</button>
              <button onClick={quitarImportados} disabled={importBusy} style={{ padding: "6px 12px", background: "#fff", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🗑 Quitar líneas importadas (semana)</button>
              <input type="file" accept=".xlsx,.xls" onChange={onArchivoAjustes} style={{ fontSize: 12 }} />
            </div>
            {importRows && (
              <>
                <div style={{ fontSize: 12, marginBottom: 8 }}><b style={{ color: "#16a34a" }}>{importRows.filter(r => r.valido && !r.warn).length}</b> ok · <b style={{ color: "#a16207" }}>{importRows.filter(r => r.valido && r.warn).length}</b> con aviso · <b style={{ color: "#dc2626" }}>{importRows.filter(r => !r.valido).length}</b> con error (no se aplican). Los avisos NO bloquean: se aplican igual.</div>
                <div style={{ overflowX: "auto", maxHeight: "44vh", overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead><tr style={{ background: "#f1f5f9" }}>
                      {["", "Empresa", "SC", "Tipo", "Concepto", "Monto", "Observación"].map((h, hi) => (<th key={hi} style={{ padding: "5px 8px", textAlign: "left", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>))}
                    </tr></thead>
                    <tbody>
                      {importRows.map((r, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", background: !r.valido ? "#fef2f2" : r.warn ? "#fffbeb" : undefined }}>
                          <td style={{ padding: "4px 8px" }}>{!r.valido ? "✗" : r.warn ? "⚠" : "✓"}</td>
                          <td style={{ padding: "4px 8px" }}>{r.empresa}{r.nueva ? <span style={{ marginLeft: 4, fontSize: 9, background: "#ede9fe", color: "#6d28d9", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>NUEVA</span> : null}</td>
                          <td style={{ padding: "4px 8px" }}>{r.sc}</td>
                          <td style={{ padding: "4px 8px" }}>{r.tipo || "—"}</td>
                          <td style={{ padding: "4px 8px" }}>{r.concepto}</td>
                          <td style={{ padding: "4px 8px", textAlign: "right", color: r.montoFirmado < 0 ? "#dc2626" : r.montoFirmado > 0 ? "#16a34a" : "#64748b", fontWeight: 700 }}>{r.montoFirmado < 0 ? "−" : "+"}{fmtMon(Math.abs(r.montoFirmado))}</td>
                          <td style={{ padding: "4px 8px", color: !r.valido ? "#dc2626" : "#a16207", fontSize: 10 }}>{r.error || r.warn || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button onClick={() => !importBusy && setImportOpen(false)} style={{ padding: "8px 16px", background: "#fff", color: "#64748b", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>Cerrar</button>
              <button onClick={aplicarImport} disabled={importBusy || !importRows || !importRows.some(r => r.valido)} style={{ padding: "8px 16px", background: (importBusy || !importRows || !importRows.some(r => r.valido)) ? "#94a3b8" : "#16a34a", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{importBusy ? "Aplicando..." : `Aplicar ${importRows ? importRows.filter(r => r.valido).length : 0} línea(s)`}</button>
            </div>
          </div>
        </div>
      )}

      {pausados.length > 0 && (
        <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#9a3412" }}>⏸ Pagos pausados (pendientes de liberar)</span>
            <span style={{ fontSize: 12, color: "#b45309" }}>{pausados.length} ruta(s) · se mantienen hasta liberarse</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "#fff" }}>
              <thead><tr>{["Fecha", "Chofer", "Patente", "SC", "Ruta", "Pago neto", "Motivo", "Pausado por", ""].map(h => <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: "#92400e", textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
              <tbody>{pausados.map(r => (
                <tr key={r.id} style={{ borderTop: "1px solid #fde68a" }}>
                  <td style={{ padding: "6px 8px" }}>{r.fecha}</td>
                  <td style={{ padding: "6px 8px" }}>{r.driver_name || "\u2014"}</td>
                  <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{r.placa || "\u2014"}</td>
                  <td style={{ padding: "6px 8px" }}>{r.service_center_id || "\u2014"}</td>
                  <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: 10 }}>{r.id_ruta || "\u2014"}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtMon(r.pago_neto)}</td>
                  <td style={{ padding: "6px 8px", maxWidth: 260, whiteSpace: "normal", color: "#92400e" }}>{r.pausa_motivo || "\u2014"}</td>
                  <td style={{ padding: "6px 8px" }}>{r.pausa_por || "\u2014"}</td>
                  <td style={{ padding: "6px 8px" }}><button onClick={() => activarPausado(r)} style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#166534", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Activar</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: "#b45309", marginTop: 8 }}>Estas rutas tienen el pago retenido desde el Listado de Pagos. Mientras no se liberen, siguen apareciendo acá semana a semana. "Activar" libera el pago.</div>
        </div>
      )}

      {repRows && repRows.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#92400e" }}>🔁 Rutas con ID repetido en la semana</span>
            <span style={{ fontSize: 12, color: "#b45309" }}>{repRows.filter(r => !consolidadas.has(`${r.empresa}||${r.service_center}||${r.id_ruta}`)).length} pendiente(s) · sobre-pago {fmtMon(repRows.filter(r => !consolidadas.has(`${r.empresa}||${r.service_center}||${r.id_ruta}`)).reduce((s, r) => s + Number(r.sobre_pago || 0), 0))}{consolidadas.size > 0 ? ` · ${consolidadas.size} ya consolidada(s)` : ""}</span>
            <button onClick={consolidarTodas} disabled={!!consolidando} style={{ marginLeft: "auto", padding: "6px 14px", background: consolidando ? "#94a3b8" : "#92400e", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{consolidando === "__todas__" ? "Consolidando..." : "Consolidar todas (dejar 1er día)"}</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ color: "#92400e" }}>
                {["Empresa", "SC", "ID Ruta", "Días", "Fechas", "Pago 1er día", "Pago total", "Sobre-pago", ""].map((h, hi) => (
                  <th key={hi} style={{ padding: "5px 8px", textAlign: "left", borderBottom: "1px solid #fde68a", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {repRows.map((r, i) => {
                  const cons = consolidadas.has(`${r.empresa}||${r.service_center}||${r.id_ruta}`);
                  return (
                  <tr key={r.id_ruta + "_" + i} style={{ borderBottom: "1px solid #fef3c7", background: cons ? "#f0fdf4" : undefined }}>
                    <td style={{ padding: "5px 8px" }}>{r.empresa}</td>
                    <td style={{ padding: "5px 8px" }}>{r.service_center}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{r.id_ruta}</td>
                    <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700 }}>{r.dias}</td>
                    <td style={{ padding: "5px 8px", fontSize: 10, color: "#78350f" }}>{r.fechas}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMon(r.pago_primer_dia)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>{fmtMon(r.pago_total)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: cons ? "#94a3b8" : "#b91c1c", fontWeight: 700, textDecoration: cons ? "line-through" : undefined }}>{fmtMon(r.sobre_pago)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>
                      {cons
                        ? <span style={{ color: "#16a34a", fontWeight: 700, fontSize: 11 }}>✓ Consolidada</span>
                        : <button onClick={() => consolidarRuta(r)} disabled={!!consolidando} style={{ padding: "4px 10px", background: "#fff", color: "#92400e", border: "1px solid #d97706", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{consolidando === String(r.id_ruta) ? "..." : "Consolidar"}</button>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: "#b45309", marginTop: 8 }}>"Consolidar" deja el pago del 1er día y quita los días repetidos (queda auditado). Si la conciliación estaba cerrada, vuelve a borrador para revisarla y cerrarla de nuevo.</div>
        </div>
      )}

      {traspRows && traspRows.length > 0 && (
        <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#9f1239" }}>🚚 Placas en 2+ empresas (misma semana)</span>
            <span style={{ background: "#9f1239", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800 }}>TRASPASADOR v4</span>
            <span style={{ fontSize: 12, color: "#be123c" }}>{traspRows.length} placa(s) · {traspRows.filter(r => r.repartida).length} con viajes repartidos entre empresas</span>
            <button onClick={() => cargarTraspasos(semana)} disabled={traspBusy} style={{ marginLeft: "auto", padding: "6px 14px", background: "#fff", color: "#9f1239", border: "1px solid #fda4af", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{traspBusy ? "Analizando..." : "↻ Reanalizar"}</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ color: "#9f1239" }}>
                {["Placa", "Empresas involucradas", "Situación", ""].map((h, hi) => (
                  <th key={hi} style={{ padding: "5px 8px", textAlign: "left", borderBottom: "1px solid #fecdd3", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {traspRows.map((r, i) => (
                  <tr key={r.placa + "_" + i} style={{ borderBottom: "1px solid #ffe4e6" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 800, fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.placa}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {r.grupos.map((g, gi) => (
                          <span key={gi} style={{ background: g.nViajes > 0 ? "#fff" : "#fff7f7", border: "1px solid #fecdd3", borderRadius: 6, padding: "3px 8px", fontSize: 11 }}>
                            <b>{g.empresa}</b> · {g.nViajes} viaje(s) · {fmtMon(g.monto)}{g.scs.length ? " · " + g.scs.join(", ") : ""}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 600, color: r.repartida ? "#b91c1c" : "#9a3412", whiteSpace: "nowrap" }}>{r.repartida ? "Viajes repartidos entre empresas" : "Doble asignación en flota (viajes en una sola)"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      <button onClick={() => (trasp && trasp.placa === r.placa) ? setTrasp(null) : abrirTraspasador(r)} style={{ padding: "4px 10px", background: (trasp && trasp.placa === r.placa) ? "#9f1239" : "#fff", color: (trasp && trasp.placa === r.placa) ? "#fff" : "#9f1239", border: "1px solid #e11d48", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>{(trasp && trasp.placa === r.placa) ? "✕ Cerrar traspasador" : "Traspasar viajes ▾"}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: "#be123c", marginTop: 8 }}>El traspasador mueve viajes de una empresa a otra: se restan del origen y se suman al destino (detalle, totales, PDF, correo y reporte). Queda auditado en la base y las prefacturas afectadas vuelven a borrador. La doble asignación en flota se corrige reasignando la placa.</div>
        </div>
      )}

      {trasp && (
        <div style={{ background: "#fff", border: "2px solid #9f1239", borderRadius: 12, padding: 20, marginBottom: 14, boxShadow: "0 4px 14px rgba(159,18,57,0.12)" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1a3a6b", marginBottom: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>🚚 Traspasador de viajes — placa {trasp.placa} <span style={{ background: "#1a3a6b", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800 }}>v4</span><button onClick={() => !traspasando && setTrasp(null)} style={{ marginLeft: "auto", padding: "4px 12px", background: "#fff", color: "#64748b", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✕ Cerrar</button></div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>Semana {semana} ({etiquetaSemanaInventario(semana)}). Marcá los viajes a mover y elegí la empresa destino: se <b>restan</b> del origen y se <b>suman</b> al destino. Los viajes de prefacturas <b>enviadas</b> no se pueden mover (reabrilas primero).</div>
            {trasp.error ? (
              <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 8, padding: 12, fontSize: 12 }}>Error cargando los viajes: {trasp.error}. Probá "Reanalizar" y volvé a abrir; si persiste, revisá la consola (F12).</div>
            ) : trasp.cargando ? (
              <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Cargando viajes de la placa...</div>
            ) : (
              <Fragment>
                {trasp.grupos.some(g => g.filas.length > 0) && trasp.grupos.every(g => g.filas.every(d => (g.estados[d.service_center_id || "SIN SC"] || "borrador") === "enviada")) && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "10px 12px", fontSize: 12, marginBottom: 12 }}>
                    ⚠ Todas las prefacturas de esta placa ya fueron <b>enviadas</b>, por eso no hay viajes seleccionables. Usá <b>🔓 Reabrir</b> en cada empresa: vuelven a borrador, traspasás, y después cerrás y reenviás con el detalle nuevo.
                  </div>
                )}
                {trasp.grupos.map((g, gi) => {
                  const esDestino = !!trasp.destino && norm(g.empresa) === norm(trasp.destino);
                  const movibles = esDestino ? [] : g.filas.filter(d => (g.estados[d.service_center_id || "SIN SC"] || "borrador") !== "enviada");
                  const todasSel = movibles.length > 0 && movibles.every(d => trasp.sel.has(claveTrasp(g.empresa, d)));
                  const totG = Math.round(g.filas.reduce((a, d) => a + Number(d.monto || 0), 0) * 100) / 100;
                  return (
                    <div key={gi} style={{ border: "1px solid #e4e7ec", borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f8fafc", borderBottom: "1px solid #e4e7ec", flexWrap: "wrap" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: movibles.length ? "pointer" : "default", fontSize: 13, fontWeight: 800, color: "#1a3a6b" }}>
                          <input type="checkbox" checked={todasSel} disabled={!movibles.length} onChange={e => toggleTraspGrupo(g, e.target.checked)} />
                          {g.empresa}
                        </label>
                        {esDestino ? <span style={{ background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800 }}>⬅ EMPRESA DESTINO — recibe los viajes</span> : null}
                        <span style={{ fontSize: 11, color: "#64748b" }}>{g.filas.length} viaje(s) · {fmtMon(totG)}</span>
                        {[...new Set(g.filas.map(d => d.service_center_id || "SIN SC"))].map(scx => {
                          const estx = g.estados[scx] || "borrador";
                          if (estx !== "enviada") return null;
                          return (
                            <span key={scx} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10 }}>
                              <span style={{ background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ddd6fe", borderRadius: 6, padding: "2px 8px", fontWeight: 800 }}>{scx}: ENVIADA</span>
                              <button onClick={async () => { await reabrirConciliacion(g.empresa, scx); abrirTraspasador({ placa: trasp.placa, empresas: trasp.grupos.map(x => x.empresa) }); }}
                                style={{ padding: "3px 10px", background: "#fff", color: "#9a3412", border: "1px solid #fdba74", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>🔓 Reabrir</button>
                            </span>
                          );
                        })}
                      </div>
                      {g.filas.length === 0 ? (
                        <div style={{ padding: 12, fontSize: 12, color: "#94a3b8" }}>Sin viajes de esta placa en esta empresa (solo doble asignación en flota).</div>
                      ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                          <thead><tr style={{ color: "#64748b", background: "#fafbfc" }}>
                            {["", "Fecha", "SC", "ID Ruta", "Conductor", "Prefactura", "Monto"].map((h, hi) => (
                              <th key={hi} style={{ padding: "5px 8px", textAlign: hi === 6 ? "right" : "left", borderBottom: "1px solid #eef0f3", whiteSpace: "nowrap", fontSize: 10 }}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {g.filas.map((d, di) => {
                              const sc = d.service_center_id || "SIN SC";
                              const est = g.estados[sc] || "borrador";
                              const bloqueada = est === "enviada";
                              const k = claveTrasp(g.empresa, d);
                              return (
                                <tr key={di} style={{ borderBottom: "1px solid #f1f5f9", background: trasp.sel.has(k) ? "#fff1f2" : undefined, opacity: bloqueada ? 0.55 : 1 }}>
                                  <td style={{ padding: "5px 8px", width: 26 }}><input type="checkbox" checked={trasp.sel.has(k)} disabled={bloqueada || esDestino} onChange={() => toggleTrasp(k)} title={esDestino ? "Esta empresa es el destino: sus viajes no se mueven" : bloqueada ? "Prefactura enviada: reabrila para poder traspasar" : "Marcar para traspasar"} /></td>
                                  <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{fmtFechaDDMM(d.fecha)}</td>
                                  <td style={{ padding: "5px 8px" }}>{sc}</td>
                                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{d.id_ruta}</td>
                                  <td style={{ padding: "5px 8px" }}>{d.driver_name}{d.traspaso ? <span title={"Ya traspasado desde " + d.traspaso.de}> 🔁</span> : null}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 10, fontWeight: 700, color: est === "enviada" ? "#7c3aed" : est === "cerrada" ? "#166534" : "#9a3412" }}>{est}</td>
                                  <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: d.es_no_pago ? "#dc2626" : "#1a1a1a" }}>{d.es_no_pago ? "$ -" : fmtMon(d.monto)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
                {(() => {
                  const selArr = [];
                  for (const g of trasp.grupos) for (const d of g.filas) if (trasp.sel.has(claveTrasp(g.empresa, d))) selArr.push({ empresa: g.empresa, linea: d });
                  const utiles = selArr.filter(x => norm(x.empresa) !== norm(trasp.destino || ""));
                  const monto = Math.round(utiles.reduce((a, x) => a + Number(x.linea.monto || 0), 0) * 100) / 100;
                  const opcionesDestino = [...new Set([...transportistas.map(tt => tt.nombre), ...trasp.grupos.map(g => g.empresa)])].filter(Boolean).sort();
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid #e4e7ec", paddingTop: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>Destino:</span>
                      <select value={trasp.destino} onChange={e => setTrasp(tt => ({ ...tt, destino: e.target.value }))} style={{ padding: "6px 8px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 12, minWidth: 240 }}>
                        <option value="">— Elegir empresa destino —</option>
                        {opcionesDestino.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span style={{ fontSize: 12, color: "#64748b" }}>{selArr.length} seleccionado(s){trasp.destino ? ` · se mueven ${utiles.length} · ${fmtMon(monto)}` : ""}</span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                        <button onClick={() => setTrasp(null)} disabled={traspasando} style={{ padding: "8px 14px", background: "#fff", color: "#64748b", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
                        <button onClick={ejecutarTraspaso} disabled={traspasando || !trasp.destino || !utiles.length} style={{ padding: "8px 16px", background: (traspasando || !trasp.destino || !utiles.length) ? "#94a3b8" : "#9f1239", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>{traspasando ? "Traspasando..." : "Traspasar seleccionados →"}</button>
                      </div>
                    </div>
                  );
                })()}
              </Fragment>
            )}
        </div>
      )}

      {seleccion.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "10px 14px", marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#065f46" }}>{seleccion.size} prefactura(s) seleccionada(s)</span>
          <button onClick={enviarSeleccionados} disabled={enviando === "__lote__"}
            style={{ padding: "7px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: enviando === "__lote__" ? 0.6 : 1 }}>
            {enviando === "__lote__" ? "Enviando..." : "📧 Enviar seleccionados"}</button>
          <button onClick={() => setSeleccion(new Set())}
            style={{ padding: "7px 14px", background: "#fff", color: "#475569", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Limpiar</button>
        </div>
      )}

      {!loading && resumen.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { label: "Empresas", valor: empresasAgrupadas.filter(g => g.empresa !== SIN_EMPRESA).length, color: "#1a3a6b" },
            { label: "Prefacturas (empresa+SC)", valor: resumen.filter(r => r.empresa !== SIN_EMPRESA).length, color: "#7c3aed" },
            { label: "Viajes", valor: totalViajes.toLocaleString("es-MX"), color: "#3B82F6" },
            { label: "Neto semana", valor: fmtMon(totalSemana), color: "#16a34a" },
            { label: "Placas sin empresa", valor: sinEmpresaG ? sinEmpresaG.nPlacas : 0, color: sinEmpresaG ? "#F47B20" : "#94a3b8" },
          ].map(k => (
            <div key={k.label} style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: "10px 18px", minWidth: 130 }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>{k.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.valor}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando conciliación de la semana {semana}...</div>}
      {!loading && resumen.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e4e7ec" }}>
          No hay viajes calculados en el Listado de Pagos para la semana {semana} ({etiquetaSemanaInventario(semana)}).
        </div>
      )}

      {/* Tarjetas por empresa */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {empresasAgrupadas.map(g => {
          const esSinEmpresa = g.empresa === SIN_EMPRESA;
          const _netoE = Math.round(g.filasSC.reduce((s, rSC) => s + netoSCneteado(g.empresa, rSC, esSinEmpresa), 0) * 100) / 100;
          const _brutoE = Math.round(g.filasSC.reduce((s, rSC) => { const n = netoSCneteado(g.empresa, rSC, esSinEmpresa); return s + (n < 0 ? n : Math.round(n * 1.16 * 100) / 100); }, 0) * 100) / 100;
          const abierta = expandida === g.empresa;
          const det = detalles[g.empresa];
          const t = transpPorNorm[norm(g.empresa)];
          const faltanDatos = !esSinEmpresa && (!t || !t.rfc || !t.correo_to);

          // Agrupar detalle por SC (y, dentro de Sin Empresa, por placa)
          const detPorSC = {};
          const porPlaca = {};
          if (det) {
            for (const d of det) {
              const k = d.service_center_id || "SIN SC";
              (detPorSC[k] = detPorSC[k] || []).push(d);
              if (esSinEmpresa) { const p = d.placa || "—"; (porPlaca[p] = porPlaca[p] || []).push(d); }
            }
          }

          return (
            <div key={g.empresa} style={{ background: "#fff", borderRadius: 10, overflow: "hidden", border: esSinEmpresa ? "2px solid #F47B20" : "1px solid #e4e7ec" }}>
              {/* Fila resumen empresa */}
              <div onClick={() => toggleEmpresa(g.empresa)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", cursor: "pointer", flexWrap: "wrap", background: esSinEmpresa ? "#fff7ed" : "#fff" }}>
                <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: esSinEmpresa ? "#c2410c" : "#1a3a6b", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {esSinEmpresa ? "⚠️ " + g.empresa : g.empresa}
                    {esSinEmpresa && det && Object.keys(porPlaca).some(p => placasViejas[p]) && <span style={{ fontSize: 11, fontWeight: 700, color: "#9a3412", background: "#ffedd5", padding: "1px 7px", borderRadius: 8 }}>⚠️ {Object.keys(porPlaca).filter(p => placasViejas[p]).length} de semanas anteriores</span>}
                    {!esSinEmpresa && <span style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", background: "#f3e8ff", padding: "1px 7px", borderRadius: 8 }}>{g.filasSC.length} SC</span>}
                    {!esSinEmpresa && saldoEmpresa(g.empresa) < 0 && <span style={{ fontSize: 11, fontWeight: 800, color: "#9a3412", background: "#ffedd5", padding: "1px 7px", borderRadius: 8 }}>⚠️ Saldo pendiente {fmtMon(saldoEmpresa(g.empresa))}</span>}
                    {!esSinEmpresa && _netoE < 0 && <span style={{ fontSize: 11, fontWeight: 800, color: "#9a3412", background: "#fee2e2", padding: "1px 7px", borderRadius: 8 }}>⚠️ Negativo → irá a pendiente</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                    {esSinEmpresa
                      ? `${g.nPlacas} placas operaron sin empresa en el inventario — asignalas para incluirlas en una conciliación`
                      : (t ? `RFC ${t.rfc || "—"} · ${t.correo_to || "sin correo"}` : "Transportista no registrado en Prefacturas")}
                    {faltanDatos && <span style={{ color: "#d97706", fontWeight: 700 }}> · ⚠ completar datos para el PDF</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: "#94a3b8" }}>Viajes</div><div style={{ fontWeight: 800 }}>{g.nViajes}</div></div>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: "#94a3b8" }}>No pago</div><div style={{ fontWeight: 800, color: g.nNoPago > 0 ? "#dc2626" : "#94a3b8" }}>{g.nNoPago}</div></div>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: "#94a3b8" }}>Ajustes</div><div style={{ fontWeight: 800, color: (ajustesEmp[norm(g.empresa)] || 0) > 0 ? "#a16207" : "#94a3b8" }}>{ajustesEmp[norm(g.empresa)] || 0}</div></div>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: "#94a3b8" }}>Neto</div><div style={{ fontWeight: 800, color: _netoE < 0 ? "#9a3412" : "#16a34a" }}>{fmtMon(_netoE)}</div></div>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: "#94a3b8" }}>Bruto</div><div style={{ fontWeight: 800 }}>{fmtMon(_brutoE)}</div></div>
                  <div style={{ fontSize: 16, color: "#94a3b8" }}>{abierta ? "▾" : "▸"}</div>
                </div>
              </div>

              {/* Detalle expandido */}
              {abierta && (
                <div style={{ borderTop: "1px solid #eef0f3", padding: "14px 16px", background: "#fafbfc" }}>
                  {!det && loadingDetalle && <div style={{ color: "#94a3b8", fontSize: 12, padding: 12 }}>Cargando detalle...</div>}

                  {/* Empresa normal: una sección por SC */}
                  {det && !esSinEmpresa && (
                    <>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                        <button onClick={(e) => {
                          e.stopPropagation();
                          setFormTransp(t
                            ? { id: t.id, nombre: t.nombre, rfc: t.rfc || "", estado: t.estado || "Activo", correo_to: t.correo_to || "", correo_cc: t.correo_cc || "", correo_bcc: t.correo_bcc || "", notas: t.notas || "" }
                            : { ...TRANSP_FORM_VACIO, nombre: g.empresa });
                        }}
                          style={{ padding: "6px 12px", background: "#fff", color: "#475569", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          ✏️ {t ? "Editar datos transportista" : "Registrar transportista"}
                        </button>
                      </div>
                      {g.filasSC.map(rSC => {
                        const filasSC = filasConSaldoLine(g.empresa, rSC.service_center, (detPorSC[rSC.service_center] || []).filter(d => !pausadosSet.has(String(d.id_ruta))));
                        const _detLoaded = !!detalles[g.empresa];
                        const _tripsSC = _detLoaded ? filasSC.filter(d => !d._saldo) : null;
                        const _netoViajesSC = _detLoaded ? Math.round(_tripsSC.reduce((s, d) => s + Number(d.monto || 0), 0) * 100) / 100 : (rSC.neto_guardado != null ? rSC.neto_guardado : rSC.total_neto);
                        const _viajesSC = _detLoaded ? _tripsSC.length : rSC.n_viajes;
                        const _brutoBaseSC = _detLoaded ? Math.round(_netoViajesSC * 1.16 * 100) / 100 : (rSC.bruto_guardado != null ? rSC.bruto_guardado : rSC.total_bruto);
                        const clave = claveCierre(g.empresa, rSC.service_center);
                        const noPagosSC = filasSC.filter(d => d.es_no_pago);
                        return (
                          <div key={rSC.service_center} style={{ border: "1px solid #e4e7ec", borderRadius: 8, marginBottom: 12, overflow: "hidden" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, background: "#eef2f7", padding: "8px 12px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 800, color: "#1a3a6b", fontSize: 13 }}>SC {rSC.service_center}</span>
                                {chipEstado(rSC.estado_conciliacion)}
                                <span style={{ fontSize: 11, color: "#64748b" }}>
                                  Sup: {rSC.supervisor || "—"} · {_viajesSC} viajes · {rSC.n_no_pago} no pago{(ajustesSC[`${norm(g.empresa)}||${norm(rSC.service_center)}`] || 0) > 0 ? ` · ${ajustesSC[`${norm(g.empresa)}||${norm(rSC.service_center)}`]} ajuste(s)` : ""} · Neto {fmtMon(_netoViajesSC)} · Bruto {fmtMon(_brutoBaseSC)}{rSC.tiene_ajustes ? " · ✏️ ajustada" : ""}{rSC.enviado_at ? " · 📤 " + new Date(rSC.enviado_at).toLocaleDateString("es-CL") : ""}{(() => { const prev = saldoPrevioDe(g.empresa, rSC.service_center); const man = lineasManualesDe(g.empresa, rSC.service_center).reduce((s, d) => s + Number(d.monto || 0), 0); if (!(prev < 0) && !(man < 0)) return ""; const nv = _netoViajesSC; const net = Math.round((nv + prev + man) * 100) / 100; const br = net < 0 ? net : Math.round(net * 1.16 * 100) / 100; const partes = []; if (prev < 0) partes.push(`Saldo ${fmtMon(prev)}`); if (man < 0) partes.push(`Aplicado ${fmtMon(man)}`); return ` · ⚠️ ${partes.join(" · ")} · A pagar: neto ${fmtMon(net)} / bruto ${fmtMon(br)}`; })()}
                                </span>
                              </div>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button onClick={(e) => { e.stopPropagation(); generarPDF(g.empresa, rSC.service_center, filasSC, rSC); }}
                                  style={{ padding: "6px 12px", background: "#F47B20", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📄 PDF {rSC.service_center}</button>
                                {(rSC.estado_conciliacion === "sin_generar" || rSC.estado_conciliacion === "borrador") ? (
                                  <button onClick={(e) => { e.stopPropagation(); cerrarConciliacion(g.empresa, rSC.service_center, rSC, filasSC); }} disabled={cerrando === clave}
                                    style={{ padding: "6px 12px", background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: cerrando === clave ? 0.6 : 1 }}>
                                    {cerrando === clave ? "Cerrando..." : "🔒 Cerrar"}</button>
                                ) : (
                                  <button onClick={(e) => { e.stopPropagation(); reabrirConciliacion(g.empresa, rSC.service_center); }}
                                    style={{ padding: "6px 12px", background: "#fff", color: "#1a3a6b", border: "1px solid #1a3a6b", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Reabrir</button>
                                )}
                                {(rSC.estado_conciliacion === "cerrada" || rSC.estado_conciliacion === "enviada") && (
                                  <>
                                    <label onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#475569", cursor: "pointer" }}>
                                      <input type="checkbox" checked={seleccion.has(clave)} onChange={() => toggleSeleccion(g.empresa, rSC.service_center)} /> sel.
                                    </label>
                                    <button onClick={(e) => { e.stopPropagation(); abrirEnvio(g.empresa, rSC.service_center, filasSC, rSC); }} disabled={enviando === clave}
                                      style={{ padding: "6px 12px", background: rSC.estado_conciliacion === "enviada" ? "#fff" : "#16a34a", color: rSC.estado_conciliacion === "enviada" ? "#16a34a" : "#fff", border: rSC.estado_conciliacion === "enviada" ? "1px solid #16a34a" : "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: enviando === clave ? 0.6 : 1 }}>
                                      {enviando === clave ? "Enviando..." : (rSC.estado_conciliacion === "enviada" ? "📧 Reenviar" : "📧 Enviar")}</button>
                                  </>
                                )}
                              </div>
                            </div>
                            <div style={{ padding: "4px 12px 12px" }}>
                              {(() => {
                                const si = saldoInfoDe(g.empresa, rSC.service_center);
                                if (!si || !(si.pendiente < 0)) return null;
                                const comp = Object.entries(si.aplicaciones || {}).map(([w, m]) => ({ w: Number(w), m: Number(m) })).filter(x => x.w > (si.liquidadoHasta || 0) && x.w < semana).sort((a, b) => a.w - b.w);
                                const netoSemana = (filasSC || []).filter(f => !f._saldo).reduce((s, f) => s + Number(f.monto || 0), 0);
                                const neteado = Math.round((netoSemana + si.pendiente) * 100) / 100;
                                return (<div style={{ marginBottom: 10, border: "1px solid #fdba74", background: "#fff7ed", borderRadius: 8, padding: "8px 12px" }}>
                                  <div style={{ fontSize: 12, fontWeight: 800, color: "#9a3412" }}>{`\u26A0\uFE0F Saldo pendiente de conciliaci\u00f3n: ${fmtMon(si.pendiente)}`}</div>
                                  <div style={{ fontSize: 11, color: "#7c2d12", marginTop: 4 }}>{`Originado en la semana ${si.semanaOrigen}. Se descontar\u00e1 autom\u00e1ticamente cuando este SC tenga viajes; el IVA se calcula sobre el neto resultante (viajes \u2212 saldo). Mientras siga negativo no genera factura ni IVA.`}</div>
                                  {comp.length > 0 && <div style={{ fontSize: 11, color: "#7c2d12", marginTop: 4 }}>{`Composici\u00f3n: ${comp.map(x => `sem ${x.w}: ${fmtMon(x.m)}`).join("  \u00b7  ")}`}</div>}
                                  {netoSemana !== 0 && <div style={{ fontSize: 11, color: neteado < 0 ? "#9a3412" : "#166534", marginTop: 4, fontWeight: 700 }}>{`Con los viajes de esta semana (${fmtMon(netoSemana)}): neto resultante ${fmtMon(neteado)}${neteado < 0 ? " \u2192 sigue pendiente" : " \u2192 se concilia y se paga"}.`}</div>}
                                  <div style={{ marginTop: 8 }}><button onClick={(e) => { e.stopPropagation(); consolidarSaldoManual(g.empresa, rSC.service_center); }} title="Dar por cerrado por acuerdo: elimina el saldo de la base y deja de arrastrarse/sumar" style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#b91c1c", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>🗑 Consolidar (eliminar saldo por acuerdo)</button></div>
                                </div>);
                              })()}
                              {!esSinEmpresa && (rSC.estado_conciliacion === "sin_generar" || rSC.estado_conciliacion === "borrador") && saldosOtrosSC(g.empresa, rSC.service_center).length > 0 && (
                                <div style={{ marginBottom: 10, border: "1px dashed #fdba74", background: "#fffbeb", borderRadius: 8, padding: "8px 12px" }}>
                                  <div style={{ fontSize: 11, fontWeight: 800, color: "#9a3412", marginBottom: 6 }}>{`Saldos de otros SC de ${g.empresa} \u2014 aplicar a este cobro:`}</div>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {saldosOtrosSC(g.empresa, rSC.service_center).map(si => {
                                      const ap = aplicadoManual(g.empresa, rSC.service_center, si.sc);
                                      return (<button key={si.sc} onClick={(e) => { e.stopPropagation(); ap ? quitarSaldoManual(g.empresa, rSC.service_center, si.sc) : aplicarSaldoManual(g.empresa, rSC.service_center, si.sc); }}
                                        style={{ padding: "5px 10px", borderRadius: 6, border: ap ? "1px solid #9a3412" : "1px solid #fdba74", background: ap ? "#9a3412" : "#fff", color: ap ? "#fff" : "#9a3412", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                        {ap ? `\u2713 Aplicado ${si.sc} (${fmtMon(si.pendiente)}) \u2014 quitar` : `Aplicar saldo de ${si.sc} aqu\u00ed (${fmtMon(si.pendiente)})`}</button>);
                                    })}
                                  </div>
                                </div>
                              )}
                              {renderTablaDetalle(filasSC, { editable: (rSC.estado_conciliacion === "sin_generar" || rSC.estado_conciliacion === "borrador"), empresa: g.empresa, sc: rSC.service_center })}
                              {(rSC.estado_conciliacion === "sin_generar" || rSC.estado_conciliacion === "borrador") && renderEditorSC(g.empresa, rSC)}
                              {noPagosSC.length > 0 && (
                                <div style={{ marginTop: 10, border: "1px solid #fca5a5", background: "#fef2f2", borderRadius: 8, padding: "8px 12px" }}>
                                  <div style={{ fontSize: 11, fontWeight: 800, color: "#991b1b", marginBottom: 6 }}>OBSERVACIONES — RUTAS NO PAGADAS (VISITA &lt; 90%)</div>
                                  {noPagosSC.map((d, i) => (
                                    <div key={i} style={{ fontSize: 11, color: "#7f1d1d", padding: "2px 0" }}>
                                      {fmtFechaDDMM(d.fecha)} · {d.placa} · Ruta {d.id_ruta} · {d.driver_name} — {d.motivo_no_pago || "NO PAGADO"} (cargado {d.cargado}, entregado {d.entregado})
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {/* Sin Empresa: asignación por placa */}
                  {det && esSinEmpresa && (
                    <>
                      <div style={{ fontSize: 12, color: "#7c2d12", marginBottom: 10 }}>
                        Asigná cada placa a un transportista: se insertará en el inventario de flota de la <strong>semana {semana}</strong>. Si no existe, crealo (queda en la base de Prefacturas → Transportistas).
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {Object.entries(porPlaca).map(([placa, filas]) => {
                          const neto = filas.reduce((s, f) => s + Number(f.monto || 0), 0);
                          const scs = [...new Set(filas.map(f => f.service_center_id).filter(Boolean))];
                          return (
                            <div key={placa} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 12px", flexWrap: "wrap" }}>
                              <div style={{ minWidth: 90, fontWeight: 800, color: "#1a3a6b" }}>{placa}</div>
                              {placasViejas[placa] && <span style={{ fontSize: 10, fontWeight: 700, color: "#9a3412", background: "#ffedd5", padding: "1px 6px", borderRadius: 8 }}>⚠️ desde sem {placasViejas[placa]}</span>}
                              <div style={{ fontSize: 11, color: "#64748b", flex: "1 1 200px" }}>
                                {filas.length} viaje{filas.length !== 1 ? "s" : ""} · SC {scs.join(", ") || "—"} · Neto {fmtMon(neto)} · {[...new Set(filas.map(f => f.driver_name).filter(Boolean))].slice(0, 2).join(", ")}
                              </div>
                              <select value={asignacionSel[placa] || ""} onClick={e => e.stopPropagation()}
                                onChange={e => setAsignacionSel(prev => ({ ...prev, [placa]: e.target.value }))}
                                style={{ padding: "6px 8px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 12, minWidth: 220 }}>
                                <option value="">— Elegir transportista —</option>
                                {opcionesTransp.map(n => <option key={n} value={n}>{n}</option>)}
                                <option value="__nueva__">＋ Nuevo transportista...</option>
                              </select>
                              <button onClick={(e) => { e.stopPropagation(); asignarPlaca(placa, filas); }} disabled={asignando === placa}
                                style={{ padding: "6px 14px", background: "#F47B20", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: asignando === placa ? 0.6 : 1 }}>
                                {asignando === placa ? "Asignando..." : "Asignar"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#1a3a6b", marginBottom: 4 }}>Viajes de estas placas en la semana:</div>
                        {renderTablaDetalle(det)}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal nuevo/editar transportista */}
      {modalEnvio && (
        <div onClick={() => enviando ? null : setModalEnvio(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 22, width: 560, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1a3a6b", marginBottom: 4 }}>📧 Enviar prefactura</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>{modalEnvio.empresa} · SC {modalEnvio.sc}</div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>Para (correo_to)</label>
            <input value={modalEnvio.to} onChange={e => setModalEnvio({ ...modalEnvio, to: e.target.value })} style={{ width: "100%", padding: "8px 10px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 13, marginBottom: 10, boxSizing: "border-box" }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>Con copia (correo_cc)</label>
            <input value={modalEnvio.cc} onChange={e => setModalEnvio({ ...modalEnvio, cc: e.target.value })} style={{ width: "100%", padding: "8px 10px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 13, marginBottom: 10, boxSizing: "border-box" }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>Asunto</label>
            <input value={modalEnvio.asunto} onChange={e => setModalEnvio({ ...modalEnvio, asunto: e.target.value })} style={{ width: "100%", padding: "8px 10px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 13, marginBottom: 10, boxSizing: "border-box" }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>Cuerpo</label>
            <textarea value={modalEnvio.cuerpo} onChange={e => setModalEnvio({ ...modalEnvio, cuerpo: e.target.value })} rows={6} style={{ width: "100%", padding: "8px 10px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 13, marginBottom: 4, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 14 }}>El PDF se genera automáticamente en el servidor y se adjunta. Solo las conciliaciones cerradas pueden enviarse.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setModalEnvio(null)} disabled={!!enviando} style={{ padding: "8px 16px", background: "#fff", color: "#475569", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarEnvioModal} disabled={!!enviando} style={{ padding: "8px 18px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: enviando ? 0.6 : 1 }}>{enviando ? "Enviando..." : "Enviar ahora"}</button>
            </div>
          </div>
        </div>
      )}

      {formTransp && (
        <div onMouseDown={e => { if (e.target === e.currentTarget && !guardandoTransp) setFormTransp(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 22, width: 460, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1a3a6b", marginBottom: 4 }}>{formTransp.id ? "Editar transportista" : "Nuevo transportista"}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 14 }}>Se guarda en la base de Prefacturas (la misma que usa el envío masivo). Alimenta el header del PDF y los destinatarios.</div>
            {[
              { k: "nombre", label: "Razón social *", ph: "JUAN JOSE MENESES OLVERA" },
              { k: "rfc", label: "RFC *", ph: "MEOJ8311229H4" },
              { k: "correo_to", label: "Correo TO (destino)", ph: "facturacion@empresa.mx" },
              { k: "correo_cc", label: "Correo CC", ph: "(opcional)" },
              { k: "correo_bcc", label: "Correo BCC", ph: "(opcional)" },
              { k: "notas", label: "Notas", ph: "(opcional)" },
            ].map(f => (
              <div key={f.k} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 3 }}>{f.label}</div>
                <input value={formTransp[f.k]} placeholder={f.ph}
                  onChange={e => setFormTransp(prev => ({ ...prev, [f.k]: e.target.value }))}
                  disabled={f.k === "nombre" && !!formTransp.id}
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 13, boxSizing: "border-box", background: (f.k === "nombre" && formTransp.id) ? "#f1f5f9" : "#fff" }} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setFormTransp(null)} disabled={guardandoTransp}
                style={{ padding: "8px 16px", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 13, cursor: "pointer", color: "#475569" }}>Cancelar</button>
              <button onClick={guardarTransp} disabled={guardandoTransp}
                style={{ padding: "8px 16px", background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: guardandoTransp ? 0.6 : 1 }}>
                {guardandoTransp ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TercerosMX() {
  const [tab, setTab] = useState("inventario");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState(null);
  const [expandida, setExpandida] = useState(null);
  const [busca, setBusca] = useState("");
  const fileRef = useRef(null);
  const semanaObjetivoRef = useRef(null);

  const [cambios, setCambios] = useState([]);
  const [loadingCambios, setLoadingCambios] = useState(false);
  const [cargoVariaciones, setCargoVariaciones] = useState(false);

  useEffect(() => { cargar(); }, []);
  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await sb.from("flota_terceros_mx").select("*").order("semana", { ascending: false }).order("placa").limit(50000);
      setRows(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const cargarVariaciones = async () => {
    setLoadingCambios(true);
    try {
      const { data } = await sb.from("vw_flota_cambios_empresa").select("*").limit(10000);
      setCambios(data || []);
    } catch (e) { console.error(e); setCambios([]); }
    setLoadingCambios(false);
    setCargoVariaciones(true);
  };
  useEffect(() => { if (tab === "variaciones" && !cargoVariaciones) cargarVariaciones(); }, [tab]);

  const porSemana = {};
  for (const r of rows) {
    const s = r.semana != null ? Number(r.semana) : null;
    if (s == null) continue;
    if (!porSemana[s]) porSemana[s] = { filas: 0, placas: new Set(), empresas: new Set(), responsable: null, fecha: null };
    const g = porSemana[s];
    g.filas++;
    if (r.placa) g.placas.add(r.placa);
    if (r.empresa_transporte) g.empresas.add(r.empresa_transporte);
    if (!g.responsable && r.responsable) g.responsable = r.responsable;
    if (r.fecha_hora_envio && (!g.fecha || r.fecha_hora_envio > g.fecha)) g.fecha = r.fecha_hora_envio;
  }

  const semActual = semanaInventario(new Date().toISOString().slice(0, 10));
  const conDatos = Object.keys(porSemana).map(Number);
  const hasta = Math.max((semActual || 24) + 1, conDatos.length ? Math.max.apply(null, conDatos) : 24);
  const lineas = [];
  for (let s = 24; s <= hasta; s++) lineas.push(s);
  lineas.sort((a, b) => b - a);

  const cargarExcel = async (file) => {
    if (!file) return;
    const objetivo = semanaObjetivoRef.current;
    setCargando(true); setMsg(null);
    try {
      if (!window.XLSX) {
        await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      }
      const XLSX = window.XLSX;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(bytes, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
      if (aoa.length < 2) { setMsg({ ok: false, txt: "El archivo no tiene filas de datos." }); setCargando(false); return; }
      const norm = s => String(s || "").trim().toUpperCase();
      const head = aoa[0].map(norm);
      const col = (name) => head.indexOf(norm(name));
      const ix = {
        semana: col("SEMANA"), responsable: col("RESPONSABLE"), fecha: col("FECHA_HORA_ENVIO"),
        operacion: col("OPERACION"), placa: col("PLACA"), tipo: col("TIPO VEHICULO"),
        empresa: col("EMPRESA TRANSPORTE"), cargo: col("CARGO"), nombre: col("NOMBRE TRABAJADOR"),
        curp: col("CURP TRABAJADOR"), flota: col("FLOTA (PLANTA - BACK UP)"), idlog: col("ID LOGISTIC"),
        valid: col("VALIDACIÓN MELI"), placaInf: col("PLACA INFORMADA"),
      };
      if (ix.placa < 0 || ix.empresa < 0) { setMsg({ ok: false, txt: "No encontré las columnas PLACA / EMPRESA TRANSPORTE. ¿Es el formato del inventario de flota?" }); setCargando(false); return; }
      const get = (row, i) => (i >= 0 && row[i] != null && row[i] !== "") ? row[i] : null;
      const toIso = v => { if (v == null) return null; if (v instanceof Date) return v.toISOString(); const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); };
      const data = [];
      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || row.length === 0) continue;
        const placa = get(row, ix.placa);
        if (!placa) continue;
        data.push({
          semana: (ix.semana >= 0 && row[ix.semana] != null && row[ix.semana] !== "") ? parseInt(row[ix.semana], 10) : null,
          responsable: get(row, ix.responsable),
          fecha_hora_envio: toIso(get(row, ix.fecha)),
          operacion: get(row, ix.operacion),
          placa: normalizarPlaca(placa),
          tipo_vehiculo: get(row, ix.tipo),
          empresa_transporte: get(row, ix.empresa),
          cargo: get(row, ix.cargo),
          nombre_trabajador: get(row, ix.nombre),
          curp_trabajador: get(row, ix.curp),
          flota: get(row, ix.flota),
          id_logistic: get(row, ix.idlog) != null ? String(get(row, ix.idlog)) : null,
          validacion_meli: get(row, ix.valid),
          placa_informada: get(row, ix.placaInf) != null ? String(get(row, ix.placaInf)) : null,
        });
      }
      if (data.length === 0) { setMsg({ ok: false, txt: "No encontré filas con placa." }); setCargando(false); return; }
      const semanasFile = Array.from(new Set(data.map(d => d.semana).filter(v => v != null)));
      if (objetivo != null && semanasFile.length && !semanasFile.includes(objetivo)) {
        if (!confirm("Estás cargando en la línea de la semana " + objetivo + " (" + etiquetaSemanaInventario(objetivo) + "), pero el Excel trae la semana " + semanasFile.join(", ") + ".\n\nSe respetará la SEMANA del Excel. ¿Continuar igual?")) { setCargando(false); if (fileRef.current) fileRef.current.value = ""; semanaObjetivoRef.current = null; return; }
      }
      if (!confirm("Se cargarán " + data.length + " filas" + (semanasFile.length ? " de la semana " + semanasFile.join(", ") : "") + ".\n\nSe reemplazará lo que haya de esa(s) semana(s). ¿Continuar?")) { setCargando(false); semanaObjetivoRef.current = null; return; }
      for (const sem of semanasFile) {
        const { error } = await sb.from("flota_terceros_mx").delete().eq("semana", sem);
        if (error) throw error;
      }
      let ok = 0;
      for (let i = 0; i < data.length; i += 200) {
        const chunk = data.slice(i, i + 200);
        const { error } = await sb.from("flota_terceros_mx").insert(chunk);
        if (error) throw error;
        ok += chunk.length;
      }
      setMsg({ ok: true, txt: "Cargadas " + ok + " filas" + (semanasFile.length ? " (semana " + semanasFile.join(", ") + ")" : "") + "." });
      cargar();
    } catch (e) {
      console.error(e);
      setMsg({ ok: false, txt: "Error al cargar: " + (e.message || e) });
    }
    setCargando(false);
    semanaObjetivoRef.current = null;
    if (fileRef.current) fileRef.current.value = "";
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;

  const detalleSemana = (s) => {
    const q = busca.trim().toLowerCase();
    return rows.filter(r => Number(r.semana) === s && (!q || [r.placa, r.empresa_transporte, r.operacion, r.cargo, r.nombre_trabajador, r.curp_trabajador].some(v => String(v || "").toLowerCase().includes(q))));
  };

  const cambiosOrden = cambios.slice().sort((a, b) => (b.semana_cambio || 0) - (a.semana_cambio || 0) || String(a.placa_norm).localeCompare(String(b.placa_norm)));

  return (
    <div style={{ padding: 24 }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => cargarExcel(e.target.files && e.target.files[0])} />

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a6b" }}>Terceros — Inventario de flota por semana</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>El inventario de cada semana operada alimenta la empresa por patente en el Listado de Pagos</div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, borderBottom: "1px solid #e4e7ec" }}>
        {[["inventario", "Inventario de Flota"], ["variaciones", "Variaciones"]].map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: "8px 16px", border: "none", borderBottom: tab === id ? "2px solid #1a3a6b" : "2px solid transparent", background: "none", color: tab === id ? "#1a3a6b" : "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: -1 }}>
            {lbl}
          </button>
        ))}
      </div>

      {msg && (<div style={{ background: msg.ok ? "#ecfdf5" : "#fef2f2", border: "1px solid " + (msg.ok ? "#a7f3d0" : "#fca5a5"), color: msg.ok ? "#065f46" : "#991b1b", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 12 }}>{msg.txt}</div>)}

      {tab === "inventario" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lineas.map(s => {
            const g = porSemana[s];
            const cargado = !!g && g.placas.size > 0;
            const esActual = semanaInventarioEsActual(s);
            const abierta = expandida === s;
            return (
              <div key={s} style={{ background: "#fff", border: "1px solid " + (cargado ? "#e4e7ec" : "#fde68a"), borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: cargado ? "#16a34a" : "#f59e0b", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b" }}>
                      Semana {etiquetaSemanaInventario(s)}
                      {esActual && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#1d4ed8", background: "#dbeafe", padding: "2px 6px", borderRadius: 10, textTransform: "uppercase" }}>En curso</span>}
                      <span style={{ marginLeft: 8, fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>· sem {s}</span>
                    </div>
                    <div style={{ fontSize: 11, color: cargado ? "#16a34a" : "#b45309", marginTop: 2 }}>
                      {cargado
                        ? "\u2713 Cargado · " + g.placas.size + " patentes · " + g.empresas.size + " empresas" + (g.fecha ? " · subido " + new Date(g.fecha).toLocaleDateString("es-MX") : "")
                        : "Pendiente de carga"}
                    </div>
                  </div>
                  {cargado && (
                    <button onClick={() => setExpandida(abierta ? null : s)}
                      style={{ padding: "7px 12px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#fff", color: "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      {abierta ? "Ocultar" : "Ver detalle"}
                    </button>
                  )}
                  <button onClick={() => { semanaObjetivoRef.current = s; fileRef.current && fileRef.current.click(); }} disabled={cargando}
                    style={{ padding: "7px 14px", borderRadius: 4, border: "none", background: cargando ? "#94a3b8" : (cargado ? "#475569" : "#16a34a"), color: "#fff", fontSize: 11, fontWeight: 600, cursor: cargando ? "wait" : "pointer", whiteSpace: "nowrap" }}>
                    {cargado ? "Reemplazar Excel" : "Cargar Excel"}
                  </button>
                </div>
                {abierta && cargado && (
                  <div style={{ borderTop: "1px solid #f0f0f0", padding: "10px 16px", background: "#fbfcfe" }}>
                    <input type="text" placeholder="Buscar placa / empresa / SC / trabajador..." value={busca} onChange={e => setBusca(e.target.value)}
                      style={{ border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12, width: "100%", maxWidth: 360, marginBottom: 10 }} />
                    <div style={{ overflow: "auto", border: "1px solid #e4e7ec", borderRadius: 6 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 820 }}>
                        <thead>
                          <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                            {["Placa", "Empresa", "SC", "Tipo", "Cargo", "Trabajador", "Validación MELI"].map(h => (
                              <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detalleSemana(s).slice(0, 2000).map(r => (
                            <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                              <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.placa}</td>
                              <td style={{ padding: "6px 10px" }}>{r.empresa_transporte}</td>
                              <td style={{ padding: "6px 10px" }}>{r.operacion}</td>
                              <td style={{ padding: "6px 10px" }}>{r.tipo_vehiculo}</td>
                              <td style={{ padding: "6px 10px" }}>{r.cargo}</td>
                              <td style={{ padding: "6px 10px" }}>{r.nombre_trabajador}</td>
                              <td style={{ padding: "6px 10px" }}>{r.validacion_meli}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "variaciones" && (
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
            Patentes que cambiaron de empresa entre una semana y la siguiente. Se actualiza al cargar una semana nueva.
          </div>
          {loadingCambios && <div style={{ textAlign: "center", padding: 30, color: "#94a3b8" }}>Cargando variaciones...</div>}
          {!loadingCambios && (
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 760 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                    {["Placa", "De (semana)", "A (semana)", "Empresa anterior", "Empresa nueva"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cambiosOrden.length === 0 && (<tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Sin variaciones registradas. Aparecerán cuando cargues una semana nueva y una placa cambie de empresa.</td></tr>)}
                  {cambiosOrden.map((c, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600 }}>{c.placa_norm}</td>
                      <td style={{ padding: "6px 10px", color: "#64748b" }}>{c.semana_previa != null ? etiquetaSemanaInventario(c.semana_previa) : "\u2014"}</td>
                      <td style={{ padding: "6px 10px", color: "#64748b" }}>{c.semana_cambio != null ? etiquetaSemanaInventario(c.semana_cambio) : "\u2014"}</td>
                      <td style={{ padding: "6px 10px", color: "#991b1b" }}>{c.empresa_previa}</td>
                      <td style={{ padding: "6px 10px", color: "#065f46", fontWeight: 600 }}>{c.empresa_actual}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModuloPagosMadre({ usuario }) {
  // Si el usuario tiene rol "prefacturas", solo puede acceder a la sub-tab Prefacturas.
  // Las otras sub-tabs siguen visibles pero al hacer click muestran un mensaje de bloqueo.
  const rolLimitadoAPrefacturas = usuario?.rol === "prefacturas";
  const subtabsPermitidas = rolLimitadoAPrefacturas ? ["prefacturas"] : null; // null = todas

  const [subtab, setSubtabState] = useState(() => {
    if (rolLimitadoAPrefacturas) return "prefacturas";
    try { return localStorage.getItem("bt_nav_subtab_pagos") || "listado"; } catch { return "listado"; }
  });
  const setSubtab = (t) => { try { localStorage.setItem("bt_nav_subtab_pagos", t); } catch {} setSubtabState(t); };
  const tabs = [
    { id: "listado",     label: "Listado de Pagos",      desc: "Cálculo diario por contratista" },
    { id: "pagos_pausados", label: "Pagos pausados",     desc: "Rutas con el pago retenido · por día y motivo" },
    { id: "info_ruta",   label: "Información de Ruta",   desc: "Análisis operacional por ruta" },
    { id: "torre_3p",    label: "Torre de Control Pagos", desc: "3 Pilares · MELI vs Operación" },
    { id: "terceros",    label: "Terceros",              desc: "Empresas subcontratadas por patente" },
    { id: "conciliacion", label: "Conciliación Terceros", desc: "Conciliación semanal por empresa" },
    { id: "historial_pago", label: "Historial de Pago", desc: "Resumen semanal: cierres, cambios, saldos y reporte" },
    { id: "ayudantes",   label: "Ayudantes",             desc: "Detalle diario de auxiliares" },
    { id: "ambulancias", label: "Ambulancias",           desc: "Traspasos internos ruta→ruta" },
    { id: "supervisores", label: "Consolidaciones Bitácora",   desc: "Consolidado por SC: torre, helpers, ambulancias y bitácora" },
    { id: "padron_meli", label: "Padrón MELI",         desc: "Conductores y vehículos · altas, bajas y cambios diarios" },
    { id: "prefacturas", label: "Prefacturas",           desc: "Envío masivo de prefacturas MX" },
    { id: "config",      label: "Configuración",         desc: "Tarifario, zonas y reglas" },
  ];

  const subtabPermitida = (id) => subtabsPermitidas === null || subtabsPermitidas.includes(id);

  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>Administración</div>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e4e7ec", marginLeft: -8, flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setSubtab(t.id)}
              style={{
                background: "transparent", border: "none", padding: "10px 16px",
                fontSize: 13, fontWeight: 600, cursor: "pointer", color: subtab === t.id ? "#1a3a6b" : "#64748b",
                borderBottom: subtab === t.id ? "2px solid #1a3a6b" : "2px solid transparent",
                marginBottom: -2,
              }}>
              <div>{t.label}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginTop: 2 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </div>
      {!subtabPermitida(subtab) ? (
        <div style={{
          padding: "60px 24px", textAlign: "center", background: "#fff",
          margin: "24px", borderRadius: 12, border: "1px solid #e4e7ec",
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b", marginBottom: 6 }}>
            Usuario sin credenciales para esta pestaña
          </div>
          <div style={{ fontSize: 13, color: "#64748b", maxWidth: 480, margin: "0 auto" }}>
            Tu cuenta tiene acceso únicamente al módulo de <strong>Prefacturas</strong> dentro de Pagos.
            Si necesitás acceso a otras pestañas, contactá a un administrador.
          </div>
        </div>
      ) : (
        <>
          {subtab === "listado"     && <ListadoPagosDiarios />}
          {subtab === "pagos_pausados" && <PagosPausados usuario={usuario} />}
          {subtab === "info_ruta"   && <InformacionDeRuta />}
          {subtab === "torre_3p"    && <TorreTresPilares />}
          {subtab === "terceros"    && <TercerosMX />}
          {subtab === "conciliacion" && <ConciliacionTercerosMX usuario={usuario} />}
          {subtab === "historial_pago" && <HistorialPagoMX usuario={usuario} />}
          {subtab === "ayudantes"   && <AyudantesDetalleDia />}
          {subtab === "ambulancias" && <PoolMeliAmbulancias />}
          {subtab === "supervisores" && <PanelControlSupervisores />}
          {subtab === "padron_meli" && <PadronMeliAdmin usuario={usuario} />}
          {subtab === "prefacturas" && <ModuloPrefacturasEnvio usuario={usuario} />}
          {subtab === "config"      && <ConfiguracionPagos />}
        </>
      )}
    </div>
  );
}

function parsearTipologia(vehiculoRaw, categorias) {
  if (!vehiculoRaw) return null;
  const v = String(vehiculoRaw).toUpperCase();
  // Match contra las categorías configuradas en matriz_precios (las más largas primero,
  // para evitar colisiones de substring tipo "CAR" dentro de "CARGO").
  if (categorias && categorias.length) {
    const cats = Array.from(new Set(categorias.filter(Boolean).map(c => String(c).toUpperCase()))).sort((a, b) => b.length - a.length);
    for (const c of cats) if (v.includes(c)) return c;
  }
  if (v.includes("LARGE VAN")) return "LARGE VAN";
  if (v.includes("SMALL VAN")) return "SMALL VAN";
  if (v.includes("CAR")) return "CAR";
  return null;
}

function normalizarPlaca(p) {
  if (!p) return null;
  const s = String(p).trim().toUpperCase().replace(/^SDD-/, "");
  return s || null;
}

function tipologiaTitleCase(t) {
  if (!t) return null;
  const map = { "LARGE VAN": "Large Van", "SMALL VAN": "Small Van", "CAR": "Car" };
  return map[t] || t;
}

function determinarTramoKm(km, rangos) {
  // Trunca hacia abajo (piso): 100.05 -> 100, 100.9 -> 100, 101.0 -> 101.
  // El tramo se fija con el km PLANIFICADO (el real es solo informativo).
  // Si recibe los rangos configurados (desde matriz_precios), los usa; si no, cae a los 5 fijos.
  const k = Math.floor(Number(km) || 0);
  if (rangos && rangos.length) {
    const matches = rangos.filter(x => k >= x.min && k <= x.max);
    if (matches.length) {
      // Si varios rangos se solapan, gana el más específico:
      // primero el de cota superior más baja (acotado > abierto "N+"), luego el más angosto.
      matches.sort((a, b) => (a.max - b.max) || ((a.max - a.min) - (b.max - b.min)));
      return matches[0].label;
    }
    return rangos[rangos.length - 1].label;
  }
  if (k <= 100) return "0-100";
  if (k <= 150) return "101-150";
  if (k <= 200) return "151-200";
  if (k <= 250) return "201-250";
  return "251+";
}

function normEmpresaTarifa(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function buscarTarifa(empresaRuta, tipologia, zona, tramo, fecha, especiales, matrizPrecios) {
  const tipTitleCase = tipologiaTitleCase(tipologia);
  const empNorm = normEmpresaTarifa(empresaRuta);
  if (empNorm) {
    const especial = (especiales || []).find(e =>
      normEmpresaTarifa(e.empresa || e.driver_name) === empNorm &&
      e.tipologia === tipTitleCase &&
      e.zona === zona &&
      e.tramo_km === tramo &&
      (!e.vigente_desde || !fecha || String(e.vigente_desde).slice(0, 10) <= fecha) &&
      (!e.vigente_hasta || !fecha || String(e.vigente_hasta).slice(0, 10) >= fecha)
    );
    if (especial) return { monto: Number(especial.monto), fuente: "ESPECIAL" };
  }

  const general = matrizPrecios.find(m =>
    m.tipo_vehiculo === tipologia &&
    m.zonificacion === zona &&
    m.tramo_km === tramo &&
    m.activo === true
  );
  if (general) return { monto: Number(general.tarifa_mxn), fuente: "MATRIZ" };

  return { monto: 0, fuente: "SIN_TARIFA" };
}

function calcularSemanaPago(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - target) / (7 * 24 * 3600 * 1000));
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

const SC_FORANEOS = new Set(["SCY1","SCQ1","SQR1","SHP1","STL1","STX1","SVH1","SPB1","SPY1"]);

const AUX_COBRAR_MELI = 350;

function calcularAjusteVisitadoNS(pctVisitado, nsPct, cfg) {
  const visMin    = (cfg && cfg.vis_min_pago   != null) ? cfg.vis_min_pago   : 90;
  const visPremio = (cfg && cfg.vis_premio_min != null) ? cfg.vis_premio_min : 99.5;
  const nsPremio  = (cfg && cfg.ns_premio_min  != null) ? cfg.ns_premio_min  : 99.5;
  const nsCastigo = (cfg && cfg.ns_castigo_max != null) ? cfg.ns_castigo_max : 95;
  const premioPct = (cfg && cfg.ns_premio_pct  != null) ? cfg.ns_premio_pct  : 5;
  const castPct   = (cfg && cfg.ns_castigo_pct != null) ? cfg.ns_castigo_pct : 3;
  if (pctVisitado == null) return { pct: 0, categoria: "SIN_VISITADO", noPaga: false };
  const vis = Number(pctVisitado);
  const ns = Number(nsPct) || 0;
  if (vis < visMin) return { pct: 0, categoria: "NO_PAGO_VIS<90%", noPaga: true };
  if (vis >= visPremio) {
    if (ns > nsPremio) return { pct: premioPct, categoria: "PREMIO_+5%", noPaga: false };
    return { pct: 0, categoria: "NEUTRO", noPaga: false };
  }
  if (ns < nsCastigo) return { pct: -castPct, categoria: "CASTIGO_-3%", noPaga: false };
  return { pct: 0, categoria: "NEUTRO", noPaga: false };
}

function calcularPagos({ maestro, snapshots, scZonas, especiales, matrizPrecios, aprobaciones, tarifasCobrar, cfg, calculadoAt, bonificaciones, placaEmpresa, traspasosPorRuta = {} }) {
  const errores = [];
  const filas = [];

  // Index snapshots por id_ruta (para Bloque D + cruce de medianoche)
  const snapsPorRuta = {};
  for (const s of snapshots) {
    const k = String(s.id_ruta);
    if (!snapsPorRuta[k]) snapsPorRuta[k] = [];
    snapsPorRuta[k].push(s);
  }

  // Index aprobaciones de helper por travel_id
  const aprobPorRuta = {};
  for (const a of (aprobaciones || [])) aprobPorRuta[String(a.travel_id)] = a;

  // Index tarifas por cobrar MELI por categoria|zona|tramo
  const cobrarIdx = {};
  for (const c of (tarifasCobrar || [])) cobrarIdx[`${c.categoria}|${c.zonificacion}|${c.tramo_km}`] = Number(c.tarifa_mxn);

  // Rangos de km dinámicos: derivados de los tramo_km configurados en matriz_precios (pagar).
  const categoriasMatriz = Array.from(new Set((matrizPrecios || []).map(m => m.tipo_vehiculo).filter(Boolean)));
  const rangosKm = (() => {
    const labels = Array.from(new Set((matrizPrecios || []).map(m => m.tramo_km).filter(Boolean)));
    const parsed = labels.map(L => {
      const s = String(L).trim();
      if (s.endsWith("+")) return { min: parseInt(s, 10) || 0, max: Infinity, label: s };
      const p = s.split("-"); const a = parseInt(p[0], 10); const b = parseInt(p[1], 10);
      return { min: isNaN(a) ? 0 : a, max: isNaN(b) ? Infinity : b, label: s };
    }).filter(r => Number.isFinite(r.min));
    parsed.sort((x, y) => x.min - y.min);
    return parsed;
  })();

  // Index sc_zonas
  const zonaPorSC = {};
  for (const z of scZonas) zonaPorSC[z.service_center_id] = z.zona;

  for (const m of maestro) {
    const idRuta = String(m.idviaje || "");
    const driverName = m.driver_name || "Sin nombre";
    const driverIdML = m.driver_id != null ? Number(m.driver_id) : null;
    const sc = m.service_center_id || null;
    const vehiculoRaw = m.tipo_vehiculo || null;
    const placa = normalizarPlaca(m.patentes);
    const ciclo = m.cluster_meli || null;
    const esSDD = (m.es_sdd === "SI" || m.es_sdd === true);  // SDD/SPOT lo da la vista (es_sdd, desde tipo_vehiculo_meli "...SDD")

    // Km: reales según MELI con fallback a planificado
    const km = Number(m.km_meli != null ? m.km_meli : (m.km_planificados || 0));

    // Datos REALES de MELI (vienen de la vista; SOLO informativos, no afectan el calculo)
    const kmRealMeli = m.km_recorridos_meli != null ? Number(m.km_recorridos_meli) : null;
    const pctVisitadoReal = m.pct_no_visitado_real != null
      ? Math.round((100 - Number(m.pct_no_visitado_real)) * 100) / 100
      : null;
    // GATE DE PAGO: usa el visitado REAL (MELI route-detail) cuando existe;
    // si no hay dato real, cae al visitado del maestro (comportamiento previo).
    const pctVisitadoGate = pctVisitadoReal != null ? pctVisitadoReal : null;

    // NS = entregados / cargados (equivalente a "Entrega exitosa")
    const cargados = Number(m.cargados || 0);
    const entregados = Number(m.entregados || 0);
    const traspasado = Number((traspasosPorRuta && traspasosPorRuta[idRuta]) || 0);  // paquetes que esta ruta (origen) traspasó a otras (ambulancias)
    const cargadosNS = Math.max(0, cargados - traspasado);  // total ajustado: se restan los traspasados al origen
    const nsPct = cargadosNS > 0 ? (entregados / cargadosNS * 100) : 0;  // NS se calcula sobre el total ajustado

    // % visitado (segunda variable de premio/castigo)
    const pctVisitado = m.pct_visitado != null ? Number(m.pct_visitado) : null;
    const noVisitado = pctVisitado != null ? (100 - pctVisitado) : null;

    const fechaSalida = m.fecha ? String(m.fecha).slice(0, 10) : null;

    // Validaciones
    if (!idRuta) { errores.push({ tms_id: m.idviaje, motivo: "Sin idviaje en el Maestro Supervisores" }); continue; }
    if (!sc) { errores.push({ tms_id: m.idviaje, motivo: "Sin service_center_id" }); continue; }

    const tipologia = parsearTipologia(vehiculoRaw, categoriasMatriz);
    const zona = zonaPorSC[sc] || null;
    const tramo = determinarTramoKm(km, rangosKm);

    const obs = [];
    if (!tipologia) obs.push(`Tipología no reconocida: "${vehiculoRaw}"`);
    if (!zona) obs.push(`SC no mapeado en sc_zonas_mx: ${sc}`);
    if (pctVisitado == null) obs.push("Sin % visitado en el snapshot");
    // km_meli (TMS) esta deprecado: el km de pago es el planificado por diseño y el real va en su columna. Ya no genera alerta.
    if (m.status_final && m.status_final !== "close") obs.push(`Status no cerrado: ${m.status_final} — revisar`);

    // Tarifa base
    let tarifaInfo = { monto: 0, fuente: "SIN_TARIFA" };
    if (tipologia && zona) {
      const empresaRuta = (placaEmpresa || {})[placa] || null;
      tarifaInfo = buscarTarifa(empresaRuta, tipologia, zona, tramo, fechaSalida, especiales, matrizPrecios);
      if (tarifaInfo.fuente === "SIN_TARIFA") obs.push(`Sin tarifa para ${tipologia} / ${zona} / ${tramo}`);
    }
    const tarifaBase = tarifaInfo.monto;
    const tieneTarifaEspecial = tarifaInfo.fuente === "ESPECIAL";

    // Ajuste por matriz visitado × NS (reemplaza a matriz_ns)
    const pctVisitadoEfectivo = pctVisitadoGate != null ? pctVisitadoGate : pctVisitado;
    const ajuste = calcularAjusteVisitadoNS(pctVisitadoEfectivo, nsPct, cfg);
    const noPagaNS0 = nsPct <= 0;  // Regla: nivel de servicio 0 => sin pago
    const noPaga = ajuste.noPaga || noPagaNS0;
    const factorNS = 1 + (ajuste.pct / 100);
    const ajusteNS = tarifaBase * (ajuste.pct / 100);

    // ── Helper: gatillo = con_ayudante del Maestro Supervisores ──
    // La DECISIÓN explícita del analista (aprobaciones_helper.decision) manda:
    //  aprobado → paga $300 (aun si estaba bloqueada por defecto)
    //  rechazado → no paga
    //  sin decisión → no paga (bloqueada por defecto si es foránea+small van)
    const tieneHelper = String(m.con_ayudante || "").toUpperCase() === "SI";
    let auxiliarEstado = "SIN_HELPER";
    let montoAux = 0;
    if (tieneHelper) {
      const esForaneo = SC_FORANEOS.has(sc);
      const esSmallVan = tipologia === "SMALL VAN";
      const aprob = aprobPorRuta[idRuta] || null;
      const decision = (aprob && aprob.decision) ? String(aprob.decision).toLowerCase() : null;
      if (decision === "aprobado") {
        auxiliarEstado = "APROBADO";
        montoAux = (cfg && cfg.aux_por_pagar != null) ? cfg.aux_por_pagar : 300;
      } else if (decision === "rechazado") {
        auxiliarEstado = "RECHAZADO";
        montoAux = 0;
        obs.push("Helper rechazado por el analista");
      } else if (esForaneo && esSmallVan) {
        auxiliarEstado = "BLOQUEADO_ESTRUCTURAL";
        montoAux = 0;
        obs.push("Helper bloqueado por defecto: SC foráneo + Small Van — requiere aprobación");
      } else {
        auxiliarEstado = "SIN_APROBACION";
        montoAux = 0;
        obs.push("Helper sin decisión del analista — no se paga hasta aprobar");
      }
    }

    // ── Bloque D: métricas del raw_json (desde snapshots) ──
    const snapsRuta = snapsPorRuta[idRuta] || [];
    let initDateUnix = null, finalDateUnix = null;
    let loyaltyTier = null, performanceScore = null;
    let tieneRetrasoInicial = false, cantidadIncidentes = 0, stemOutMinutos = null;
    if (snapsRuta.length > 0) {
      const ordenados = [...snapsRuta].sort((a, b) =>
        new Date(b.hora_snapshot || 0) - new Date(a.hora_snapshot || 0)
      );
      for (const s of ordenados) {
        const rj = s.raw_json || {};
        if (!initDateUnix && rj.initDate) initDateUnix = Number(rj.initDate);
        if (!finalDateUnix && rj.finalDate) finalDateUnix = Number(rj.finalDate);
        if (initDateUnix && finalDateUnix) break;
      }
      for (const s of ordenados) {
        const rj = s.raw_json || {};
        if (loyaltyTier === null && rj.driver?.loyalty?.name) loyaltyTier = rj.driver.loyalty.name;
        if (performanceScore === null && rj.routePerformanceScore) performanceScore = rj.routePerformanceScore;
        if (rj.flags?.hasInitialDelay === true) tieneRetrasoInicial = true;
        if (Array.isArray(rj.incidentTypes) && rj.incidentTypes.length > cantidadIncidentes) cantidadIncidentes = rj.incidentTypes.length;
        if (stemOutMinutos === null && rj.timingData?.stemOut != null) stemOutMinutos = Number(rj.timingData.stemOut);
        if (loyaltyTier && performanceScore && stemOutMinutos !== null) break;
      }
    }
    if (performanceScore === null && m.performance_score) performanceScore = m.performance_score;

    // Cruce de medianoche
    let cruzaMedianoche = false;
    let duracionMinutos = null;
    if (initDateUnix && finalDateUnix) {
      duracionMinutos = Math.round((finalDateUnix - initDateUnix) / 60);
      const fIni = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(initDateUnix * 1000));
      const fFin = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(finalDateUnix * 1000));
      if (fIni !== fFin) {
        cruzaMedianoche = true;
        const h = Math.floor(duracionMinutos / 60), mm = duracionMinutos % 60;
        obs.push(`Ruta cruzó medianoche: ${fIni} → ${fFin} (duración ${h}h ${mm}min)`);
      }
    } else if (snapsRuta.length > 0 && fechaSalida) {
      const fechasSnap = [...new Set(snapsRuta.map(s => s.fecha))];
      if (fechasSnap.filter(f => f !== fechaSalida).length > 0) {
        cruzaMedianoche = true;
        obs.push(`Ruta cruzó medianoche (estimado por snapshots): fechas ${fechasSnap.join(", ")}`);
      }
    }

    // Ruta no operada: NO se descarta; se marca para que el analista decida
    const rutaNoOperada = !!m.ruta_no_operada;
    if (rutaNoOperada) obs.push(`🚫 NO OPERADA${m.motivo_no_operada ? `: ${m.motivo_no_operada}` : ""} — revisar antes de pagar`);

    // Descarte por visitado < 90% (reemplaza al viejo no_visitado > 10%)
    if (ajuste.noPaga) obs.push(`NO PAGADO: visitado ${pctVisitadoEfectivo != null ? pctVisitadoEfectivo.toFixed(2) : "?"}% < 90% (${pctVisitadoGate != null ? "REAL MELI" : "maestro"})`);
    if (noPagaNS0) obs.push("NO PAGADO: NS 0% (sin entregas)");
    if (traspasado > 0) obs.push(`🔄 TRASPASO: ${traspasado} paquete(s) traspasados — total ajustado ${cargadosNS} de ${cargados}; NS recalculado sobre ${cargadosNS}`);
    if (pctVisitadoGate != null && pctVisitado != null && Math.abs(pctVisitadoGate - pctVisitado) >= 5) {
      obs.push(`Visitado maestro ${pctVisitado.toFixed(1)}% vs real ${pctVisitadoGate.toFixed(1)}% — gate usó el REAL`);
    }

    // BONIFICACION: % extra sobre la TARIFA BASE. Solo si la ruta paga (NO_PAGO queda en 0).
    // Se acumula con el ajuste NS (ambos calculados sobre la base): pago = base + ajusteNS + bono + aux.
    let montoBono = 0;
    let bonoAplicado = null;
    if (!noPaga && !esSDD && Array.isArray(bonificaciones) && bonificaciones.length) {  // los bonos NO aplican a rutas SDD
      const tipoR = esSDD ? "SDD" : "SPOT";  // (aquí siempre SPOT por la guarda de arriba)
      const kmR = Number(km || 0);
      let mejor = null;
      for (const b of bonificaciones) {
        if (b.activo === false) continue;
        if (b.fecha_desde && fechaSalida && fechaSalida < b.fecha_desde) continue;
        if (b.fecha_hasta && fechaSalida && fechaSalida > b.fecha_hasta) continue;
        const scs = Array.isArray(b.scs) ? b.scs : [];
        if (scs.length && !scs.includes(sc)) continue;
        if (b.tipo_ruta && b.tipo_ruta !== "AMBOS" && tipoR !== b.tipo_ruta) continue;
        if (b.km_min != null && b.km_min !== "" && kmR < Number(b.km_min)) continue;
        if (b.km_max != null && b.km_max !== "" && kmR > Number(b.km_max)) continue;
        if (!mejor || Number(b.pct_aumento || 0) > Number(mejor.pct_aumento || 0)) mejor = b;
      }
      if (mejor) {
        montoBono = tarifaBase * (Number(mejor.pct_aumento || 0) / 100);
        bonoAplicado = mejor;
        obs.push(`Bonificación "${mejor.nombre}" +${Number(mejor.pct_aumento || 0)}% sobre base = +${Math.round(montoBono)}`);
      }
    }

    const pagoBruto = noPaga ? 0 : (tarifaBase + ajusteNS + montoBono + montoAux);
    const descuentos = 0;
    const pagoNeto = pagoBruto - descuentos;
    const nsCategoriaFinal = ajuste.categoria;

    // Pago MELI: lo que MELI nos paga (matriz por cobrar + $350 si hubo helper).
    // Independiente de si al chofer se le paga o no. CANCELACION no se aplica aún.
    let pagoMeli = null;
    if (tipologia && zona) {
      const baseCobrar = cobrarIdx[`${tipologia}|${zona}|${tramo}`];
      if (baseCobrar != null) pagoMeli = baseCobrar + (tieneHelper ? ((cfg && cfg.aux_por_cobrar != null) ? cfg.aux_por_cobrar : AUX_COBRAR_MELI) : 0);
    }

    filas.push({
      fecha: fechaSalida,
      id_ruta: idRuta,
      driver_id: driverIdML,
      driver_name: driverName,
      vehiculo_raw: vehiculoRaw,
      tipo_vehiculo_meli: m.tipo_vehiculo_meli || null,
      tipo_ruta_sdd: esSDD ? "SDD" : "SPOT",
      tipologia,
      placa,
      service_center_id: sc,
      zona,
      km_recorridos: km,
      km_recorridos_meli: kmRealMeli,
      tramo_km: tramo,
      ciclo,
      envios_despachados: cargadosNS,  // total ajustado (cargados - traspasados); el warning queda en observaciones
      envios_entregados: entregados,
      ns_pct: nsPct,
      ns_no_visitado: noVisitado,
      pct_visitado: pctVisitado,
      pct_visitado_real: pctVisitadoReal,
      ns_categoria: nsCategoriaFinal,
      factor_ns: factorNS,
      tarifa_base: tarifaBase,
      ajuste_ns: ajusteNS,
      monto_bonificacion: noPaga ? 0 : montoBono,
      bonificacion_nombre: bonoAplicado ? bonoAplicado.nombre : null,
      bonificacion_pct: bonoAplicado ? Number(bonoAplicado.pct_aumento || 0) : 0,
      tiene_auxiliar: tieneHelper,
      auxiliar_estado: auxiliarEstado,
      auxiliar_snapshots_total: tieneHelper ? Number(m.cantidad_personas || 0) : 0,
      monto_auxiliar: noPaga ? 0 : montoAux,
      pago_bruto: pagoBruto,
      descuentos_externos: descuentos,
      pago_neto: pagoNeto,
      pago_meli: pagoMeli,
      semana_pago: calcularSemanaPago(fechaSalida),
      tiene_tarifa_especial: tieneTarifaEspecial,
      ruta_no_operada: rutaNoOperada,
      status_final: m.status_final || null,
      calculado_at: calculadoAt,
      observaciones: obs.length > 0 ? obs.join(" | ") : null,
      hora_inicio_ruta: initDateUnix ? new Date(initDateUnix * 1000).toISOString() : null,
      hora_fin_ruta: finalDateUnix ? new Date(finalDateUnix * 1000).toISOString() : null,
      duracion_minutos: duracionMinutos,
      cruza_medianoche: cruzaMedianoche,
      loyalty_tier: loyaltyTier,
      performance_score: performanceScore,
      tiene_retraso_inicial: tieneRetrasoInicial,
      cantidad_incidentes: cantidadIncidentes,
      stem_out_minutos: stemOutMinutos,
    });
  }

  return { filas, errores };
}

function tipoRutaDeFila(placa) {
  // Regla de negocio: SDD = placa con prefijo "SDD-". Todo lo demás = SPOT
  // (otros prefijos o sin prefijo). Una placa vacía/nula no clasifica.
  const s = String(placa || "").trim().toUpperCase();
  if (!s) return null;
  return s.startsWith("SDD-") ? "SDD" : "SPOT";
}

function ConfigBonificaciones() {
  const SCS_OPERATIVOS = ["SMX1", "SMX6", "SMX7", "SMX8", "SMX9", "SMX10", "SHP1", "SQR1", "SVH1", "SPY1", "STL1", "STX1", "SCY1", "SCQ1"];
  const VACIA = { nombre: "", fecha_desde: "", fecha_hasta: "", scs: [], tipo_ruta: "AMBOS", km_min: "", km_max: "", pct_aumento: "", activo: true };
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(null); // objeto borrador (nuevo o existente) o null
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { cargar(); }, []);
  const cargar = async () => {
    setLoading(true);
    try {
      const { data, error } = await sb.from("bonificaciones_mx").select("*").order("id", { ascending: false });
      if (error) throw error;
      setLista(data || []);
    } catch (e) { setMsg({ ok: false, txt: "Error cargando: " + (e.message || e) }); }
    setLoading(false);
  };

  const nuevo = () => { setMsg(null); setEditando({ ...VACIA }); };
  const editar = (b) => {
    setMsg(null);
    setEditando({
      id: b.id,
      nombre: b.nombre || "",
      fecha_desde: b.fecha_desde || "",
      fecha_hasta: b.fecha_hasta || "",
      scs: Array.isArray(b.scs) ? b.scs : [],
      tipo_ruta: b.tipo_ruta || "AMBOS",
      km_min: b.km_min ?? "",
      km_max: b.km_max ?? "",
      pct_aumento: b.pct_aumento ?? "",
      activo: b.activo !== false,
    });
  };
  const cancelar = () => { setEditando(null); setMsg(null); };
  const set = (k, v) => setEditando(p => ({ ...p, [k]: v }));
  const toggleSC = (sc) => setEditando(p => {
    const tiene = (p.scs || []).includes(sc);
    return { ...p, scs: tiene ? p.scs.filter(x => x !== sc) : [...(p.scs || []), sc] };
  });

  const guardar = async () => {
    if (!editando) return;
    const e = editando;
    if (!e.nombre || !e.nombre.trim()) { setMsg({ ok: false, txt: "Falta el nombre de la bonificacion." }); return; }
    if (e.fecha_desde && e.fecha_hasta && e.fecha_hasta < e.fecha_desde) { setMsg({ ok: false, txt: "La fecha hasta es anterior a la fecha desde." }); return; }
    const kmMin = e.km_min === "" ? null : Number(e.km_min);
    const kmMax = e.km_max === "" ? null : Number(e.km_max);
    if (kmMin != null && kmMax != null && kmMax < kmMin) { setMsg({ ok: false, txt: "El KM maximo es menor que el minimo." }); return; }
    const pct = e.pct_aumento === "" ? 0 : Number(e.pct_aumento);
    if (isNaN(pct)) { setMsg({ ok: false, txt: "El % de aumento es invalido." }); return; }
    setGuardando(true); setMsg(null);
    try {
      const payload = {
        nombre: e.nombre.trim(),
        fecha_desde: e.fecha_desde || null,
        fecha_hasta: e.fecha_hasta || null,
        scs: e.scs || [],
        tipo_ruta: e.tipo_ruta || "AMBOS",
        km_min: kmMin,
        km_max: kmMax,
        pct_aumento: pct,
        activo: e.activo !== false,
      };
      let error;
      if (e.id) ({ error } = await sb.from("bonificaciones_mx").update(payload).eq("id", e.id));
      else ({ error } = await sb.from("bonificaciones_mx").insert(payload));
      if (error) throw error;
      setMsg({ ok: true, txt: e.id ? "Bonificacion actualizada." : "Bonificacion creada." });
      setEditando(null);
      cargar();
    } catch (err) { setMsg({ ok: false, txt: "Error: " + (err.message || err) }); }
    setGuardando(false);
  };

  const toggleActivo = async (b) => {
    try {
      const { error } = await sb.from("bonificaciones_mx").update({ activo: !b.activo }).eq("id", b.id);
      if (error) throw error;
      cargar();
    } catch (err) { setMsg({ ok: false, txt: "Error: " + (err.message || err) }); }
  };
  const eliminar = async (b) => {
    if (!confirm(`Eliminar la bonificacion "${b.nombre}"?`)) return;
    try {
      const { error } = await sb.from("bonificaciones_mx").delete().eq("id", b.id);
      if (error) throw error;
      cargar();
    } catch (err) { setMsg({ ok: false, txt: "Error: " + (err.message || err) }); }
  };

  const inp = { border: "1px solid #e4e7ec", borderRadius: 4, padding: "7px 9px", fontSize: 13, width: "100%", boxSizing: "border-box" };
  const lbl = { fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 4 };
  const fmtRango = (b) => {
    if (!b.fecha_desde && !b.fecha_hasta) return "Sin límite de fechas";
    return `${b.fecha_desde || "…"} → ${b.fecha_hasta || "…"}`;
  };
  const fmtKm = (b) => {
    if (b.km_min == null && b.km_max == null) return "Cualquier KM";
    return `${b.km_min ?? "0"} – ${b.km_max ?? "∞"} km`;
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;

  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>Bonificaciones especiales de pago</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Aumentos por SC, tipo de ruta y rango de KM, activables por toggle o rango de fechas · se muestran como columna en Listado de Pagos</div>
        </div>
        {!editando && <button onClick={nuevo} style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: "#1a3a6b", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Nueva bonificación</button>}
      </div>

      {msg && (<div style={{ background: msg.ok ? "#ecfdf5" : "#fef2f2", border: `1px solid ${msg.ok ? "#a7f3d0" : "#fca5a5"}`, color: msg.ok ? "#065f46" : "#991b1b", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 12 }}>{msg.txt}</div>)}

      {editando && (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 14 }}>{editando.id ? "Editar bonificación" : "Nueva bonificación"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 14 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={lbl}>Nombre de la bonificación</div>
              <input type="text" value={editando.nombre} onChange={ev => set("nombre", ev.target.value)} placeholder="Ej. Premio rutas largas SMX1" style={inp} />
            </div>
            <div>
              <div style={lbl}>Fecha desde</div>
              <input type="date" value={editando.fecha_desde} onChange={ev => set("fecha_desde", ev.target.value)} style={inp} />
              <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 3 }}>Vacío = sin límite</div>
            </div>
            <div>
              <div style={lbl}>Fecha hasta</div>
              <input type="date" value={editando.fecha_hasta} onChange={ev => set("fecha_hasta", ev.target.value)} style={inp} />
              <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 3 }}>Vacío = sin límite</div>
            </div>
            <div>
              <div style={lbl}>Tipo de ruta</div>
              <select value={editando.tipo_ruta} onChange={ev => set("tipo_ruta", ev.target.value)} style={inp}>
                <option value="AMBOS">Ambos (SDD y SPOT)</option>
                <option value="SDD">SDD</option>
                <option value="SPOT">SPOT</option>
              </select>
            </div>
            <div>
              <div style={lbl}>% de aumento</div>
              <input type="number" step="0.1" value={editando.pct_aumento} onChange={ev => set("pct_aumento", ev.target.value)} placeholder="5" style={inp} />
            </div>
            <div>
              <div style={lbl}>KM mínimo</div>
              <input type="number" step="0.1" value={editando.km_min} onChange={ev => set("km_min", ev.target.value)} placeholder="0" style={inp} />
              <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 3 }}>Vacío = sin mínimo</div>
            </div>
            <div>
              <div style={lbl}>KM máximo</div>
              <input type="number" step="0.1" value={editando.km_max} onChange={ev => set("km_max", ev.target.value)} placeholder="∞" style={inp} />
              <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 3 }}>Vacío = sin máximo</div>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={lbl}>Service Centers donde aplica <span style={{ color: "#94a3b8", fontWeight: 400 }}>(ninguno seleccionado = todos)</span></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {SCS_OPERATIVOS.map(sc => {
                const on = (editando.scs || []).includes(sc);
                return (
                  <button key={sc} onClick={() => toggleSC(sc)}
                    style={{ padding: "5px 11px", borderRadius: 14, border: `1px solid ${on ? "#1a3a6b" : "#e4e7ec"}`, background: on ? "#1a3a6b" : "#fff", color: on ? "#fff" : "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                    {sc}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, color: "#475569", fontWeight: 600 }}>
              <input type="checkbox" checked={editando.activo !== false} onChange={ev => set("activo", ev.target.checked)} />
              Activa
            </label>
            <div style={{ flex: 1 }} />
            <button onClick={cancelar} disabled={guardando} style={{ padding: "8px 16px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={guardar} disabled={guardando} style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: guardando ? "#94a3b8" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: guardando ? "wait" : "pointer" }}>{guardando ? "Guardando..." : "Guardar"}</button>
          </div>
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "hidden" }}>
        {lista.length === 0 ? (
          <div style={{ textAlign: "center", padding: 32, color: "#94a3b8", fontSize: 13 }}>Sin bonificaciones. Creá la primera con “+ Nueva bonificación”.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec", textAlign: "left", color: "#475569" }}>
                <th style={{ padding: "9px 12px", fontWeight: 600 }}>Estado</th>
                <th style={{ padding: "9px 12px", fontWeight: 600 }}>Nombre</th>
                <th style={{ padding: "9px 12px", fontWeight: 600 }}>Vigencia</th>
                <th style={{ padding: "9px 12px", fontWeight: 600 }}>Tipo</th>
                <th style={{ padding: "9px 12px", fontWeight: 600 }}>KM</th>
                <th style={{ padding: "9px 12px", fontWeight: 600 }}>SCs</th>
                <th style={{ padding: "9px 12px", fontWeight: 600, textAlign: "right" }}>%</th>
                <th style={{ padding: "9px 12px", fontWeight: 600, textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(b => (
                <tr key={b.id} style={{ borderBottom: "1px solid #f0f0f0", opacity: b.activo ? 1 : 0.55 }}>
                  <td style={{ padding: "9px 12px" }}>
                    <button onClick={() => toggleActivo(b)} title="Activar / desactivar"
                      style={{ width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer", position: "relative", background: b.activo ? "#16a34a" : "#cbd5e1", transition: "background .15s" }}>
                      <span style={{ position: "absolute", top: 2, left: b.activo ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
                    </button>
                  </td>
                  <td style={{ padding: "9px 12px", fontWeight: 600, color: "#1a3a6b" }}>{b.nombre}</td>
                  <td style={{ padding: "9px 12px", color: "#475569" }}>{fmtRango(b)}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#ede9fe", color: "#6d28d9" }}>{b.tipo_ruta}</span>
                  </td>
                  <td style={{ padding: "9px 12px", color: "#475569" }}>{fmtKm(b)}</td>
                  <td style={{ padding: "9px 12px", color: "#475569", maxWidth: 220 }}>
                    {(Array.isArray(b.scs) && b.scs.length) ? b.scs.join(", ") : <span style={{ color: "#94a3b8" }}>Todos</span>}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: "#7c3aed" }}>+{Number(b.pct_aumento || 0)}%</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => editar(b)} style={{ padding: "5px 10px", marginRight: 6, borderRadius: 4, border: "1px solid #e4e7ec", background: "#fff", color: "#1a3a6b", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Editar</button>
                    <button onClick={() => eliminar(b)} style={{ padding: "5px 10px", borderRadius: 4, border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ListadoPagosDiarios() {
  const [fecha, setFecha] = useState(fechaOperativaOffset(-1)); // ayer por defecto
  const [excelOpen, setExcelOpen] = useState(false);
  const [excelMode, setExcelMode] = useState("dia"); // dia | rango
  const [dupRows, setDupRows] = useState(null);  // null=no analizado, []=sin repetidos
  const [dupBusy, setDupBusy] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupDesde, setDupDesde] = useState("");
  const [dupHasta, setDupHasta] = useState("");
  const [excelDesde, setExcelDesde] = useState("");
  const [excelHasta, setExcelHasta] = useState("");
  const [excelBusy, setExcelBusy] = useState(false);
  const [pagos, setPagos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calculando, setCalculando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [resumenCalculo, setResumenCalculo] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState("todas"); // todas | pagadas | no_pagadas | con_alerta
  const [avisoRecalc, setAvisoRecalc] = useState(null); // N aprobaciones modificadas tras el último cálculo
  const [guardandoTarifado, setGuardandoTarifado] = useState(false);
  const topScrollRef = useRef(null);
  const tableWrapRef = useRef(null);
  const [tablaWidth, setTablaWidth] = useState(1560);
  const [orderBy, setOrderBy] = useState("driver_name"); // columna por la que ordenar
  const [bonificaciones, setBonificaciones] = useState([]);
  const [orderDir, setOrderDir] = useState("asc");
  const [empresaMap, setEmpresaMap] = useState({}); // placa normalizada -> empresa (Terceros)
  const [reglasAlerta, setReglasAlerta] = useState([]); // reglas configurables de alerta
  useEffect(() => { sb.from("config_alertas_pago").select("*").order("orden").then(({ data }) => setReglasAlerta(data || [])).catch(() => {}); }, []);
  const valorCampoAlerta = (p, campo) => {
    if (campo === "empresa_asignada") return (empresaMap[normalizarPlaca(p.placa)] || "");
    return p[campo];
  };
  const cumpleReglaAlerta = (p, r) => {
    const v = valorCampoAlerta(p, r.campo); const val = r.valor;
    switch (r.operador) {
      case "menor": return v != null && v !== "" && Number(v) < Number(val);
      case "mayor": return v != null && v !== "" && Number(v) > Number(val);
      case "igual": return String(v != null ? v : "") === String(val != null ? val : "");
      case "distinto": return String(v != null ? v : "") !== String(val != null ? val : "");
      case "vacio": return v == null || v === "" || v === false;
      case "no_vacio": return !(v == null || v === "" || v === false);
      case "verdadero": return v === true || v === "true" || v === 1 || v === "1";
      case "falso": return !(v === true || v === "true" || v === 1 || v === "1");
      default: return false;
    }
  };
  const alertasDe = (p) => (reglasAlerta || []).filter(r => r.activa && cumpleReglaAlerta(p, r));
  const tieneAlerta = (p) => alertasDe(p).length > 0;
  const [pausaModal, setPausaModal] = useState(null); // { r }
  const [pausaMotivo, setPausaMotivo] = useState("");
  const [pausando, setPausando] = useState(false);
  const _quienPausa = () => { try { return (typeof usuario !== "undefined" && usuario && (usuario.nombre || usuario.email)) || "Brain"; } catch (e) { return "Brain"; } };
  const confirmarPausa = async () => {
    const r = pausaModal && pausaModal.r; if (!r) return;
    if (!pausaMotivo.trim()) return alert("Escrib\u00ed el motivo de la pausa.");
    setPausando(true);
    try {
      const ahora = new Date().toISOString(); const por = _quienPausa();
      const { error } = await sb.from("maestro_jornada_mx").update({ pausado: true, pausa_motivo: pausaMotivo.trim(), pausa_por: por, pausa_at: ahora, liberado_at: null, liberado_por: null }).eq("id", r.id);
      if (error) throw error;
      setPagos(ps => ps.map(p => p.id === r.id ? { ...p, pausado: true, pausa_motivo: pausaMotivo.trim(), pausa_por: por, pausa_at: ahora } : p));
      setPausaModal(null); setPausaMotivo("");
    } catch (e) { alert("Error pausando: " + (e.message || e)); }
    setPausando(false);
  };
  const reanudarPago = async (r) => {
    if (!confirm(`\u00bfReanudar (liberar) el pago de ${r.driver_name || r.placa} \u00b7 ruta ${r.id_ruta}?`)) return;
    try {
      const ahora = new Date().toISOString(); const por = _quienPausa();
      const { error } = await sb.from("maestro_jornada_mx").update({ pausado: false, liberado_at: ahora, liberado_por: por }).eq("id", r.id);
      if (error) throw error;
      setPagos(ps => ps.map(p => p.id === r.id ? { ...p, pausado: false, liberado_at: ahora, liberado_por: por } : p));
    } catch (e) { alert("Error reanudando: " + (e.message || e)); }
  };

  // Carga el mapa placa->empresa desde flota_terceros_mx (semana mas reciente gana)
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data } = await sb.from("flota_terceros_mx").select("placa, empresa_transporte, semana").limit(50000);
        if (cancel) return;
        const ord = (data || []).slice().sort((a, b) => (b.semana || 0) - (a.semana || 0));
        const m = {};
        for (const r of ord) { const k = normalizarPlaca(r.placa); if (k && !(k in m) && r.empresa_transporte) m[k] = r.empresa_transporte; }
        setEmpresaMap(m);
      } catch (e) { /* terceros opcional */ }
    })();
    return () => { cancel = true; };
  }, []);

  // Carga las bonificaciones activas (Configuracion -> Bonificaciones)
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data } = await sb.from("bonificaciones_mx").select("*").eq("activo", true);
        if (!cancel) setBonificaciones(data || []);
      } catch (e) { /* bonificaciones opcional */ }
    })();
    return () => { cancel = true; };
  }, []);

  // Mejor bonificacion (mayor %) que aplica a una fila de pagos, o null.
  const bonoDeFila = (r) => {
    if (!bonificaciones.length) return null;
    const fr = r.fecha || fecha;
    const sc = r.service_center_id || "";
    const km = Number(r.km_recorridos || 0);
    const tipo = tipoRutaDeFila(r.placa);
    let mejor = null;
    for (const b of bonificaciones) {
      if (b.activo === false) continue;
      if (b.fecha_desde && fr < b.fecha_desde) continue;
      if (b.fecha_hasta && fr > b.fecha_hasta) continue;
      const scs = Array.isArray(b.scs) ? b.scs : [];
      if (scs.length && !scs.includes(sc)) continue;
      if (b.tipo_ruta && b.tipo_ruta !== "AMBOS" && tipo !== b.tipo_ruta) continue;
      if (b.km_min != null && b.km_min !== "" && km < Number(b.km_min)) continue;
      if (b.km_max != null && b.km_max !== "" && km > Number(b.km_max)) continue;
      if (!mejor || Number(b.pct_aumento || 0) > Number(mejor.pct_aumento || 0)) mejor = b;
    }
    return mejor;
  };

  // Carga al montar y al cambiar fecha
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setResumenCalculo(null);
      setAvisoRecalc(null);
      try {
        const { data, error } = await sb.from("maestro_jornada_mx")
          .select("*")
          .eq("fecha", fecha)
          .order("driver_name")
          .limit(5000);
        if (cancel) return;
        if (error) throw error;
        setPagos(data || []);

        // Aviso de recálculo: ¿aprobaciones de helper modificadas tras el último cálculo?
        let aviso = null;
        if ((data || []).length > 0) {
          const { data: aprob } = await sb.from("aprobaciones_helper")
            .select("decidido_at").eq("fecha", fecha).not("decidido_at", "is", null);
          const maxCalc = (data || []).reduce((mx, p) => {
            const ts = p.calculado_at ? new Date(p.calculado_at).getTime() : 0;
            return ts > mx ? ts : mx;
          }, 0);
          const modificadas = (aprob || []).filter(a => new Date(a.decidido_at).getTime() > maxCalc).length;
          if (modificadas > 0) aviso = modificadas;
        }
        if (!cancel) setAvisoRecalc(aviso);
      } catch (e) {
        console.error("Error cargando pagos:", e);
        if (!cancel) setPagos([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [fecha]);

  const calcularDia = async () => {
    if (!confirm(`¿Calcular pagos del ${fecha}?\n\nLeerá el Maestro Supervisores (snapshot de cierre) y las aprobaciones de helper de ese día, y guardará el resultado en maestro_jornada_mx.`)) return;
    setCalculando(true);
    setResumenCalculo(null);

    try {
      const fechaInicio = fecha;
      const fechaSig = new Date(fecha + "T00:00:00");
      fechaSig.setDate(fechaSig.getDate() + 1);
      const fechaFin = fechaSig.toISOString().slice(0, 10);

      // Para snapshots usamos ventana ±1 día porque las rutas pueden cruzar medianoche
      // (rutas que arrancan tarde y se cierran al día siguiente)
      const fechaPrev = new Date(fecha + "T00:00:00");
      fechaPrev.setDate(fechaPrev.getDate() - 1);
      const fechaSnapDesde = fechaPrev.toISOString().slice(0, 10);
      const fechaSnapHasta = fechaFin; // ya es +1 día

      const calculadoAt = new Date().toISOString();

      const [mRes, sRes, zRes, mpRes, eRes, apRes, tcRes, cfgRes, fRes] = await Promise.all([
        sb.from("vw_maestro_supervisores_auto").select("*").eq("fecha", fecha).limit(5000),
        sb.from("logistic_ayudantes_snapshots").select("*").gte("fecha", fechaSnapDesde).lte("fecha", fechaSnapHasta).limit(30000),
        sb.from("sc_zonas_mx").select("service_center_id, zona"),
        sb.from("matriz_precios").select("*").eq("activo", true),
        sb.from("tarifas_especiales_mx").select("*"),
        sb.from("aprobaciones_helper").select("*").eq("fecha", fecha),
        sb.from("tarifas_cobrar_meli_mx").select("*").eq("activo", true),
        sb.from("config_pagos_mx").select("*"),
        sb.from("flota_terceros_mx").select("placa, empresa_transporte, fecha_hora_envio").order("fecha_hora_envio", { ascending: false }).limit(20000),
      ]);

      if (mRes.error) throw new Error("maestro supervisores: " + mRes.error.message);
      if (sRes.error) throw new Error("snapshots: " + sRes.error.message);

      const maestro = mRes.data || [];
      if (maestro.length === 0) {
        alert(`No hay datos del Maestro Supervisores para ${fecha}. Verifique que el snapshot de cierre se haya capturado.`);
        setCalculando(false);
        return;
      }

      const cfg = {};
      for (const c of (cfgRes.data || [])) cfg[c.clave] = Number(c.valor);

      const placaEmpresa = {};
      for (const f of (fRes.data || [])) {
        const pl = normalizarPlaca(f.placa);
        if (pl && !(pl in placaEmpresa) && f.empresa_transporte) placaEmpresa[pl] = f.empresa_transporte;
      }
      // Traspasos de paquetes (ambulancias) del día: ruta_origen -> total traspasado
      const traspasosPorRuta = {};
      try {
        const { data: amb } = await sb.from("vw_ambulancias_diario")
          .select("ruta_origen, paquetes_traspasados").eq("fecha", fecha);
        for (const a of (amb || [])) {
          const k = String(a.ruta_origen);
          traspasosPorRuta[k] = (traspasosPorRuta[k] || 0) + Number(a.paquetes_traspasados || 0);
        }
      } catch (e) { console.error("traspasos ambulancias:", e); }
      const { filas, errores } = calcularPagos({
        maestro,
        snapshots: sRes.data || [],
        scZonas: zRes.data || [],
        especiales: eRes.data || [],
        matrizPrecios: mpRes.data || [],
        aprobaciones: apRes.data || [],
        tarifasCobrar: tcRes.data || [],
        cfg,
        calculadoAt,
        bonificaciones,
        placaEmpresa,
        traspasosPorRuta,
      });

      const { error: delError } = await sb.from("maestro_jornada_mx").delete().eq("fecha", fecha);
      if (delError) throw new Error("DELETE previo falló: " + delError.message);

      let insertados = 0;
      let primerError = null;
      for (let i = 0; i < filas.length; i += 100) {
        const chunk = filas.slice(i, i + 100);
        const { error: insError } = await sb.from("maestro_jornada_mx").insert(chunk);
        if (insError) {
          for (const fila of chunk) {
            const { error: e2 } = await sb.from("maestro_jornada_mx").insert(fila);
            if (e2) {
              primerError = { mensaje: e2.message, fila_problema: fila };
              break;
            } else {
              insertados++;
            }
          }
          if (primerError) break;
        } else {
          insertados += chunk.length;
        }
      }

      if (primerError) {
        const f = primerError.fila_problema;
        throw new Error(
          `Falló al insertar registro:\n\n` +
          `Chofer: ${f.driver_name}\n` +
          `Ruta: ${f.id_ruta}\n` +
          `ns_categoria: "${f.ns_categoria}"\n` +
          `Mensaje BD: ${primerError.mensaje}\n\n` +
          `Se insertaron ${insertados} registros antes del error.`
        );
      }

      // Refrescar el snapshot por empresa (pagos_terceros_diario) del día calculado
      try {
        await sb.rpc("refrescar_pagos_terceros_diario", { p_fecha: fecha });
      } catch (e) { console.error("refrescar pagos_terceros_diario:", e); }

      setResumenCalculo({
        viajes_procesados: maestro.length,
        registros_calculados: filas.length,
        registros_insertados: insertados,
        errores: errores.length,
        detalle_errores: errores,
        timestamp: new Date().toISOString(),
      });

      // Recargar
      const { data: recargados } = await sb.from("maestro_jornada_mx")
        .select("*").eq("fecha", fecha).order("driver_name").limit(5000);
      setPagos(recargados || []);
    } catch (e) {
      console.error(e);
      alert("Error en cálculo:\n\n" + e.message);
    }
    setCalculando(false);
  };

  // Helpers de formato
  const fmtMXN = (n) => `$${Number(n || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
  const fmtPct = (n) => `${Number(n || 0).toFixed(2)}%`;
  const fmtDuracion = (mins) => {
    if (mins == null || mins === 0) return "—";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  };
  const fmtHoraMX = (iso) => {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat("es-MX", {
        timeZone: "America/Mexico_City",
        day: "2-digit", month: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso));
    } catch { return "—"; }
  };

  // Filtrado y ordenamiento de filas
  const filasFiltradas = useMemo(() => {
    let res = [...pagos];

    // Filtro por búsqueda
    if (busqueda) {
      const q = busqueda.toLowerCase();
      res = res.filter(p =>
        (p.driver_name || "").toLowerCase().includes(q) ||
        (p.placa || "").toLowerCase().includes(q) ||
        (p.service_center_id || "").toLowerCase().includes(q) ||
        (p.id_ruta || "").toLowerCase().includes(q)
      );
    }

    // Filtro por estado
    if (filtroEstado === "pagadas") res = res.filter(p => p.ns_categoria !== "NO_PAGO_VIS<90%");
    else if (filtroEstado === "no_pagadas") res = res.filter(p => p.ns_categoria === "NO_PAGO_VIS<90%");
    else if (filtroEstado === "con_alerta") res = res.filter(p => tieneAlerta(p));
    else if (filtroEstado === "no_operadas") res = res.filter(p => p.ruta_no_operada);
    else if (filtroEstado === "pausadas") res = res.filter(p => p.pausado);

    // Ordenamiento
    res.sort((a, b) => {
      const va = a[orderBy], vb = b[orderBy];
      const numA = typeof va === "number" || (!isNaN(parseFloat(va)) && va !== null);
      const numB = typeof vb === "number" || (!isNaN(parseFloat(vb)) && vb !== null);
      let cmp = 0;
      if (numA && numB) cmp = Number(va) - Number(vb);
      else cmp = String(va || "").localeCompare(String(vb || ""));
      return orderDir === "asc" ? cmp : -cmp;
    });

    return res;
  }, [pagos, busqueda, filtroEstado, orderBy, orderDir, reglasAlerta, empresaMap]);

  // Totales
  const totales = useMemo(() => {
    const choferesUnicos = new Set(filasFiltradas.map(p => p.driver_name)).size;
    return {
      choferes: choferesUnicos,
      rutas: filasFiltradas.length,
      tarifaBase: filasFiltradas.reduce((s, p) => s + Number(p.tarifa_base || 0), 0),
      ajusteNS: filasFiltradas.reduce((s, p) => s + Number(p.ajuste_ns || 0), 0),
      auxiliar: filasFiltradas.reduce((s, p) => s + Number(p.monto_auxiliar || 0), 0),
      pagoNeto: filasFiltradas.reduce((s, p) => s + Number(p.pago_neto || 0), 0),
      noPagadas: filasFiltradas.filter(p => p.ns_categoria === "NO_PAGO_VIS<90%").length,
      alertas: filasFiltradas.filter(p => tieneAlerta(p)).length,
      noOperadas: filasFiltradas.filter(p => p.ruta_no_operada).length,
      pausadas: filasFiltradas.filter(p => p.pausado).length,
      pagoMeli: filasFiltradas.reduce((s, p) => s + Number(p.pago_meli || 0), 0),
      margenPct: (() => {
        const pm = filasFiltradas.reduce((s, p) => s + Number(p.pago_meli || 0), 0);
        const pn = filasFiltradas.reduce((s, p) => s + Number(p.pago_neto || 0), 0);
        return pm > 0 ? ((pm - pn) / pm * 100) : null;
      })(),
    };
  }, [filasFiltradas]);

  const toggleOrder = (col) => {
    if (orderBy === col) setOrderDir(orderDir === "asc" ? "desc" : "asc");
    else { setOrderBy(col); setOrderDir("asc"); }
  };

  const ordIcon = (col) => orderBy === col ? (orderDir === "asc" ? " ↑" : " ↓") : "";

  // Exportar a Excel (CSV simple)
  const exportarCSV = () => {
    if (filasFiltradas.length === 0) { alert("No hay datos para exportar"); return; }
    const headers = [
      "Fecha","Chofer","Patente","Vehículo","Tipología","Tipo Ruta","SC","Zona","ID Ruta","Ciclo",
      "Km","Km Real","Envíos despachados","Envíos entregados","NS%","% Visitado Real","% No Visitado Real","No visitado %","Categoría NS",
      "Tarifa base","Ajuste NS","Estado auxiliar","Snapshots con helper","$ Auxiliar",
      "Pago bruto","Pago neto","Pago MELI","Observaciones"
    ];
    const rows = filasFiltradas.map(p => [
      p.fecha, p.driver_name, p.placa, p.vehiculo_raw, p.tipologia, p.tipo_ruta_sdd || "", p.service_center_id, p.zona,
      p.id_ruta, p.ciclo, p.km_recorridos, p.km_recorridos_meli, p.envios_despachados, p.envios_entregados,
      p.ns_pct, p.pct_visitado_real, (p.pct_visitado_real != null ? Math.round((100 - Number(p.pct_visitado_real)) * 100) / 100 : ""), p.ns_no_visitado, p.ns_categoria, p.tarifa_base, p.ajuste_ns,
      p.auxiliar_estado, p.auxiliar_snapshots_total, p.monto_auxiliar,
      p.pago_bruto, p.pago_neto, p.pago_meli, (p.observaciones || "").replace(/[\r\n]+/g, " ")
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pagos_${fecha}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Exportar a Excel (un día o un rango) desde maestro_jornada_mx
  // ── Detección de rutas con id repetido en varios días (posible doble pago) ──
  const analizarDuplicados = async () => {
    const desde = dupDesde || fechaOperativaOffset(-13);
    const hasta = dupHasta || fecha;
    setDupDesde(desde); setDupHasta(hasta); setDupBusy(true); setDupOpen(true);
    try {
      const { data, error } = await sb.rpc("get_rutas_repetidas", { p_desde: desde, p_hasta: hasta });
      if (error) throw error;
      setDupRows(data || []);
    } catch (e) { console.error("rutas repetidas:", e); alert("Error analizando duplicados: " + (e.message || e)); }
    setDupBusy(false);
  };

  const abrirExcel = () => { setExcelDesde(fecha); setExcelHasta(fecha); setExcelMode("dia"); setExcelOpen(true); };
  const exportarExcel = async () => {
    const desde = excelDesde;
    const hasta = excelMode === "dia" ? excelDesde : excelHasta;
    if (!desde || !hasta) { alert("Elegí la(s) fecha(s)."); return; }
    if (desde > hasta) { alert("La fecha \"desde\" no puede ser mayor que \"hasta\"."); return; }
    setExcelBusy(true);
    try {
      const { data, error } = await sb.from("maestro_jornada_mx").select("*")
        .gte("fecha", desde).lte("fecha", hasta).order("fecha").order("driver_name").limit(50000);
      if (error) throw error;
      const filas = data || [];
      if (filas.length === 0) { alert(`No hay pagos guardados entre ${desde} y ${hasta}.`); setExcelBusy(false); return; }
      const headers = [
        "Fecha","Chofer","Patente","Vehículo","Tipología","Tipo Ruta","SC","Zona","ID Ruta","Ciclo",
        "Km","Km Real","Envíos despachados","Envíos entregados","NS%","% Visitado Real","% No Visitado Real","No visitado %","Categoría NS",
        "Tarifa base","Ajuste NS","Estado auxiliar","Snapshots con helper","$ Auxiliar",
        "Pago bruto","Pago neto","Pago MELI","Observaciones"
      ];
      const aoa = [headers, ...filas.map(p => [
        p.fecha, p.driver_name, p.placa, p.vehiculo_raw, p.tipologia, p.tipo_ruta_sdd || "", p.service_center_id, p.zona,
        p.id_ruta, p.ciclo, p.km_recorridos, p.km_recorridos_meli, p.envios_despachados, p.envios_entregados,
        p.ns_pct, p.pct_visitado_real, (p.pct_visitado_real != null ? Math.round((100 - Number(p.pct_visitado_real)) * 100) / 100 : ""), p.ns_no_visitado, p.ns_categoria, p.tarifa_base, p.ajuste_ns,
        p.auxiliar_estado, p.auxiliar_snapshots_total, p.monto_auxiliar,
        p.pago_bruto, p.pago_neto, p.pago_meli, (p.observaciones || "").replace(/[\r\n]+/g, " ")
      ])];
      const nombre = desde === hasta ? `pagos_${desde}` : `pagos_${desde}_a_${hasta}`;
      await descargarExcelMultihoja([{ nombre: "Pagos", datos: aoa }], nombre);
      setExcelOpen(false);
    } catch (e) {
      console.error(e);
      alert("Error al exportar Excel: " + (e.message || e));
    }
    setExcelBusy(false);
  };

  // Guarda los viajes tarificados del día en tarifado_mx (reemplaza el guardado previo del día = consolidado final)
  const guardarTarifado = async () => {
    if (pagos.length === 0) { alert("No hay pagos calculados para guardar. Calculá el día primero."); return; }
    let yaGuardado = 0;
    try {
      const { count } = await sb.from("tarifado_mx").select("id", { count: "exact", head: true }).eq("fecha", fecha);
      yaGuardado = count || 0;
    } catch (e) { /* tabla puede no existir aún */ }
    const msg = yaGuardado > 0
      ? `Este día (${fecha}) ya tiene un guardado previo (${yaGuardado} registros).\n\nSe reemplazará por el cálculo actual (${pagos.length} viajes). ¿Continuar?`
      : `Se guardarán ${pagos.length} viajes tarificados del ${fecha} en tarifado_mx. ¿Continuar?`;
    if (!confirm(msg)) return;
    setGuardandoTarifado(true);
    try {
      const corridaId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${fecha}-${Date.now()}`;
      const guardadoAt = new Date().toISOString();
      const cols = ["fecha","id_ruta","driver_id","driver_name","vehiculo_raw","tipo_ruta_sdd","tipologia","placa",
        "service_center_id","zona","km_recorridos","tramo_km","ciclo","envios_despachados","envios_entregados",
        "ns_pct","ns_no_visitado","pct_visitado","ns_categoria","factor_ns","tarifa_base","ajuste_ns",
        "tiene_auxiliar","auxiliar_estado","monto_auxiliar","pago_bruto","descuentos_externos","pago_neto",
        "semana_pago","tiene_tarifa_especial","ruta_no_operada","pago_meli","observaciones"];
      const rows = pagos.map(p => {
        const r = { corrida_id: corridaId, guardado_at: guardadoAt };
        for (const c of cols) r[c] = (p[c] !== undefined ? p[c] : null);
        return r;
      });
      // Reemplaza el guardado previo del día (consolidado final = último guardado)
      const { error: delErr } = await sb.from("tarifado_mx").delete().eq("fecha", fecha);
      if (delErr) throw new Error("No se pudo limpiar el guardado previo: " + delErr.message);

      let ok = 0, primerError = null;
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error } = await sb.from("tarifado_mx").insert(chunk);
        if (error) { primerError = error.message; break; }
        ok += chunk.length;
      }
      if (primerError) throw new Error(primerError);
      alert(`Guardado en tarifado_mx: ${ok} viajes del ${fecha}. Reemplaza el guardado anterior (consolidado vigente del día).`);
    } catch (e) {
      console.error(e);
      alert("Error guardando en tarifado_mx:\n\n" + e.message);
    }
    setGuardandoTarifado(false);
  };

  // Sincroniza la barra de scroll horizontal superior con la tabla
  const onTopScroll = () => { if (tableWrapRef.current && topScrollRef.current) tableWrapRef.current.scrollLeft = topScrollRef.current.scrollLeft; };
  const onTableScroll = () => { if (tableWrapRef.current && topScrollRef.current) topScrollRef.current.scrollLeft = tableWrapRef.current.scrollLeft; };
  useEffect(() => {
    if (tableWrapRef.current) setTablaWidth(tableWrapRef.current.scrollWidth);
  }, [filasFiltradas, loading, pagos]);

  return (
    <div className="pg" style={{ maxWidth: 1600 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="sec-title">Listado de Pagos Diarios</div>
        <div className="sec-sub">Cálculo por ruta · fuente Maestro Supervisores (snapshot de cierre) · alimenta la app de choferes</div>
      </div>

      {/* Filtros y botones */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Fecha de operación</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {[
            { l: "Ayer", fn: () => setFecha(fechaOperativaOffset(-1)) },
            { l: "Hoy", fn: () => setFecha(fechaHoyOperativa()) },
            { l: "-2 días", fn: () => setFecha(fechaOperativaOffset(-2)) },
            { l: "-3 días", fn: () => setFecha(fechaOperativaOffset(-3)) },
            { l: "-7 días", fn: () => setFecha(fechaOperativaOffset(-7)) },
          ].map(({ l, fn }) => (
            <button key={l} onClick={fn} style={{ padding: "5px 12px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#f8fafc", color: "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12 }} />
          <input type="text" placeholder="Buscar chofer / patente / SC / id ruta..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
            style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12, flex: 1, minWidth: 240 }} />
          <button onClick={exportarCSV} disabled={filasFiltradas.length === 0}
            style={{ padding: "8px 14px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 600, cursor: filasFiltradas.length === 0 ? "not-allowed" : "pointer", opacity: filasFiltradas.length === 0 ? 0.5 : 1 }}>
            Exportar CSV
          </button>
          <button onClick={abrirExcel}
            style={{ padding: "8px 14px", borderRadius: 4, border: "1px solid #16a34a", background: "#fff", color: "#16a34a", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Exportar Excel
          </button>
          <button onClick={calcularDia} disabled={calculando}
            style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: calculando ? "#94a3b8" : "#F47B20", color: "#fff", fontSize: 12, fontWeight: 600, cursor: calculando ? "wait" : "pointer" }}>
            {calculando ? "Calculando..." : pagos.length > 0 ? "Recalcular día" : "Calcular pagos del día"}
          </button>
          <button onClick={guardarTarifado} disabled={guardandoTarifado || pagos.length === 0}
            style={{ padding: "8px 14px", borderRadius: 4, border: "none", background: (guardandoTarifado || pagos.length === 0) ? "#94a3b8" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: (guardandoTarifado || pagos.length === 0) ? "not-allowed" : "pointer" }}>
            {guardandoTarifado ? "Guardando..." : "Guardar en tarifado"}
          </button>
        </div>
      </div>

      {/* Tarjeta: rutas con ID repetido en varios días (posible doble pago) */}
      <div style={{ background: "#fff", border: "1px solid #fde68a", borderRadius: 8, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#92400e" }}>🔁 Rutas con ID repetido en varios días</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>Posible doble pago: el mismo id de viaje aparece en más de una fecha</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="date" value={dupDesde || fechaOperativaOffset(-13)} onChange={e => setDupDesde(e.target.value)} style={{ border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 8px", fontSize: 12 }} />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>a</span>
            <input type="date" value={dupHasta || fecha} onChange={e => setDupHasta(e.target.value)} style={{ border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 8px", fontSize: 12 }} />
            <button onClick={analizarDuplicados} disabled={dupBusy} style={{ padding: "6px 14px", borderRadius: 4, border: "none", background: dupBusy ? "#94a3b8" : "#F47B20", color: "#fff", fontSize: 12, fontWeight: 700, cursor: dupBusy ? "wait" : "pointer" }}>{dupBusy ? "Analizando..." : "Analizar"}</button>
          </span>
        </div>
        {dupRows && dupOpen && (
          <div style={{ marginTop: 12 }}>
            {dupRows.length === 0 ? (
              <div style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ No se encontraron rutas con ID repetido en el rango.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "#92400e" }}><b>{dupRows.length}</b> ruta(s) repetida(s)</div>
                  <div style={{ fontSize: 12, color: "#b91c1c" }}>Sobre-pago potencial: <b>{fmtMXN(dupRows.reduce((s, r) => s + Number(r.sobre_pago || 0), 0))}</b></div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead><tr style={{ background: "#fffbeb", color: "#92400e" }}>
                      {["ID Ruta", "SC", "Chofer", "Patente", "Días", "Fechas", "Cargado", "Entregado", "Pago 1er día", "Pago total", "Sobre-pago"].map(h => (
                        <th key={h} style={{ padding: "6px 8px", textAlign: "left", borderBottom: "1px solid #fde68a", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {dupRows.map((r, i) => (
                        <tr key={r.id_ruta + "_" + i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{r.id_ruta}</td>
                          <td style={{ padding: "5px 8px" }}>{r.service_center_id}</td>
                          <td style={{ padding: "5px 8px" }}>{r.driver_name}</td>
                          <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{r.placa}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700 }}>{r.dias}</td>
                          <td style={{ padding: "5px 8px", fontSize: 10, color: "#475569" }}>{r.fechas}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center" }}>{r.cargados}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center" }}>{r.entregados}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmtMXN(r.pago_primer_dia)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>{fmtMXN(r.pago_total)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", color: "#b91c1c", fontWeight: 700 }}>{fmtMXN(r.sobre_pago)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8 }}>El analista decide. La consolidación (dejar solo el primer día) se hace en Conciliación Terceros.</div>
              </>
            )}
          </div>
        )}
      </div>

      {excelOpen && (
        <div onClick={() => !excelBusy && setExcelOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 22, width: 380, maxWidth: "90vw", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>Exportar a Excel</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16 }}>Descarga los pagos guardados de un día o un rango de fechas.</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={() => setExcelMode("dia")} style={{ flex: 1, padding: "8px", borderRadius: 4, border: `1px solid ${excelMode === "dia" ? "#1a3a6b" : "#e4e7ec"}`, background: excelMode === "dia" ? "#1a3a6b" : "#fff", color: excelMode === "dia" ? "#fff" : "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Un día</button>
              <button onClick={() => setExcelMode("rango")} style={{ flex: 1, padding: "8px", borderRadius: 4, border: `1px solid ${excelMode === "rango" ? "#1a3a6b" : "#e4e7ec"}`, background: excelMode === "rango" ? "#1a3a6b" : "#fff", color: excelMode === "rango" ? "#fff" : "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Rango de fechas</button>
            </div>
            {excelMode === "dia" ? (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>Fecha</div>
                <input type="date" value={excelDesde} onChange={e => setExcelDesde(e.target.value)} style={{ width: "100%", border: "1px solid #e4e7ec", borderRadius: 4, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>Desde</div>
                  <input type="date" value={excelDesde} onChange={e => setExcelDesde(e.target.value)} style={{ width: "100%", border: "1px solid #e4e7ec", borderRadius: 4, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>Hasta</div>
                  <input type="date" value={excelHasta} onChange={e => setExcelHasta(e.target.value)} style={{ width: "100%", border: "1px solid #e4e7ec", borderRadius: 4, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setExcelOpen(false)} disabled={excelBusy} style={{ padding: "8px 16px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <button onClick={exportarExcel} disabled={excelBusy} style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: excelBusy ? "#94a3b8" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: excelBusy ? "wait" : "pointer" }}>{excelBusy ? "Generando..." : "Descargar Excel"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Resumen del último cálculo */}
      {resumenCalculo && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: "#065f46", marginBottom: 6 }}>Cálculo completado</div>
          <div style={{ color: "#047857" }}>
            {resumenCalculo.viajes_procesados} rutas procesadas · {resumenCalculo.registros_insertados} registros guardados en maestro_jornada_mx
            {resumenCalculo.errores > 0 && ` · ${resumenCalculo.errores} viajes con error`}
          </div>
          {resumenCalculo.detalle_errores && resumenCalculo.detalle_errores.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", color: "#dc2626", fontWeight: 600 }}>Ver errores</summary>
              <div style={{ marginTop: 6, maxHeight: 150, overflowY: "auto" }}>
                {resumenCalculo.detalle_errores.map((e, i) => (
                  <div key={i} style={{ fontSize: 11, padding: "2px 0" }}>{e.tms_id}: {e.motivo}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {avisoRecalc && (
        <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div style={{ flex: 1, color: "#9a3412" }}>
            <b>{avisoRecalc}</b> {avisoRecalc === 1 ? "aprobación de helper fue modificada" : "aprobaciones de helper fueron modificadas"} después del último cálculo de este día. Recalculá para reflejar los cambios en el pago.
          </div>
          <button onClick={calcularDia} disabled={calculando}
            style={{ padding: "6px 14px", borderRadius: 4, border: "none", background: "#ea580c", color: "#fff", fontSize: 12, fontWeight: 600, cursor: calculando ? "wait" : "pointer" }}>
            Recalcular
          </button>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Choferes</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{totales.choferes}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Rutas</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{totales.rutas}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Tarifa base</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#475569", marginTop: 2 }}>{fmtMXN(totales.tarifaBase)}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Ajuste NS</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: totales.ajusteNS >= 0 ? "#16a34a" : "#dc2626", marginTop: 2 }}>{totales.ajusteNS >= 0 ? "+" : ""}{fmtMXN(totales.ajusteNS)}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Auxiliares</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#475569", marginTop: 2 }}>{fmtMXN(totales.auxiliar)}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Total a pagar</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>{fmtMXN(totales.pagoNeto)}</div>
        </div>
        {totales.noPagadas > 0 && (
          <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 6, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: "#991b1b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Rutas no pagadas</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#991b1b", marginTop: 2 }}>{totales.noPagadas}</div>
            <div style={{ fontSize: 9, color: "#991b1b", marginTop: 2 }}>visitado &lt; 90%</div>
          </div>
        )}
        {totales.alertas > 0 && (
          <div onClick={() => setFiltroEstado(filtroEstado === "con_alerta" ? "todas" : "con_alerta")} title="Ver solo las lineas con alerta"
            style={{ background: "#fef3c7", border: `2px solid ${filtroEstado === "con_alerta" ? "#d97706" : "#fcd34d"}`, borderRadius: 6, padding: "12px 14px", cursor: "pointer" }}>
            <div style={{ fontSize: 10, color: "#92400e", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Con alertas {filtroEstado === "con_alerta" ? "(filtrando)" : ""}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#92400e", marginTop: 2 }}>{totales.alertas}</div>
            <div style={{ fontSize: 9, color: "#92400e", marginTop: 2 }}>clic para filtrar</div>
          </div>
        )}
        {pagos.filter(p => p.pausado).length > 0 && (
          <div onClick={() => setFiltroEstado(filtroEstado === "pausadas" ? "todas" : "pausadas")} title="Ver solo pagos pausados"
            style={{ background: "#fff7ed", border: `2px solid ${filtroEstado === "pausadas" ? "#c2410c" : "#fdba74"}`, borderRadius: 6, padding: "12px 14px", cursor: "pointer" }}>
            <div style={{ fontSize: 10, color: "#9a3412", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Pagos pausados {filtroEstado === "pausadas" ? "(filtrando)" : ""}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#9a3412", marginTop: 2 }}>{pagos.filter(p => p.pausado).length}</div>
            <div style={{ fontSize: 9, color: "#9a3412", marginTop: 2 }}>⏸ clic para filtrar</div>
          </div>
        )}
        <div style={{ background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#5b21b6", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Rutas sin movimiento</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#5b21b6", marginTop: 2 }}>{totales.noOperadas}</div>
          <div style={{ fontSize: 9, color: "#5b21b6", marginTop: 2 }}>🚫 no operadas · revisar</div>
        </div>
      </div>

      {/* Filtros de estado */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {[
          { id: "todas", l: `Todas (${pagos.length})` },
          { id: "pagadas", l: `Pagadas (${pagos.filter(p => p.ns_categoria !== "NO_PAGO_VIS<90%").length})` },
          { id: "no_pagadas", l: `No pagadas (${pagos.filter(p => p.ns_categoria === "NO_PAGO_VIS<90%").length})` },
          { id: "con_alerta", l: `Con alertas (${pagos.filter(p => tieneAlerta(p)).length})` },
          { id: "no_operadas", l: `Sin movimiento (${pagos.filter(p => p.ruta_no_operada).length})` },
          { id: "pausadas", l: `Pausadas (${pagos.filter(p => p.pausado).length})` },
        ].map(({ id, l }) => (
          <button key={id} onClick={() => setFiltroEstado(id)}
            style={{ padding: "5px 12px", borderRadius: 4,
              border: `1px solid ${filtroEstado === id ? "#1a3a6b" : "#e4e7ec"}`,
              background: filtroEstado === id ? "#1a3a6b" : "#fff",
              color: filtroEstado === id ? "#fff" : "#475569",
              fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {l}
          </button>
        ))}
      </div>

      {pausaModal && (
        <div onMouseDown={e => { if (e.target === e.currentTarget && !pausando) setPausaModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 22, width: 460, maxWidth: "100%" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#9a3412", marginBottom: 4 }}>⏸ Pausar pago</div>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 12 }}>{`${pausaModal.r.driver_name || ""} \u00b7 ${pausaModal.r.placa || ""} \u00b7 ruta ${pausaModal.r.id_ruta || ""}`}</div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>Motivo de la pausa (se guarda) *</label>
            <textarea value={pausaMotivo} onChange={e => setPausaMotivo(e.target.value)} rows={4} placeholder="¿Por qué se pausa este pago?" style={{ width: "100%", padding: "8px 10px", border: "1px solid #e4e7ec", borderRadius: 8, fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={() => { setPausaModal(null); setPausaMotivo(""); }} disabled={pausando} style={{ padding: "8px 16px", background: "#fff", color: "#475569", border: "1px solid #e4e7ec", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarPausa} disabled={pausando} style={{ padding: "8px 16px", background: "#c2410c", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{pausando ? "Pausando\u2026" : "Pausar pago"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de scroll horizontal superior (sincronizada con la tabla) */}
      <div ref={topScrollRef} onScroll={onTopScroll} style={{ overflowX: "auto", overflowY: "hidden", marginBottom: 4, position: "sticky", top: 0, zIndex: 20, background: "#f8fafc", paddingTop: 4, paddingBottom: 2, borderBottom: "1px solid #e4e7ec" }}>
        <div style={{ width: tablaWidth, height: 1 }} />
      </div>

      {/* Tabla principal — vista por RUTA */}
      <div ref={tableWrapRef} onScroll={onTableScroll} style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: "72vh" }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Cargando datos del {fecha}...</div>
        ) : pagos.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: "#475569" }}>Sin pagos calculados para {fecha}</div>
            <div style={{ fontSize: 11 }}>Apretá "Calcular pagos del día" para procesar el Maestro Supervisores de esa fecha.</div>
          </div>
        ) : filasFiltradas.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Ningún registro coincide con los filtros</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 1660 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec", position: "sticky", top: 0 }}>
                <Th onClick={() => toggleOrder("driver_name")}>Chofer{ordIcon("driver_name")}</Th>
                <Th onClick={() => toggleOrder("placa")}>Patente{ordIcon("placa")}</Th>
                <Th>Empresa</Th>
                <Th onClick={() => toggleOrder("tipologia")}>Vehículo{ordIcon("tipologia")}</Th>
                <Th center>Tipo Ruta</Th>
                <Th onClick={() => toggleOrder("service_center_id")} center>SC · Zona{ordIcon("service_center_id")}</Th>
                <Th onClick={() => toggleOrder("id_ruta")}>ID Ruta{ordIcon("id_ruta")}</Th>
                <Th onClick={() => toggleOrder("status_final")} center>Estado{ordIcon("status_final")}</Th>
                <Th onClick={() => toggleOrder("km_recorridos")} right>Km{ordIcon("km_recorridos")}</Th>
                <Th onClick={() => toggleOrder("km_recorridos_meli")} right>Km Real{ordIcon("km_recorridos_meli")}</Th>
                <Th onClick={() => toggleOrder("ns_pct")} right>NS%{ordIcon("ns_pct")}</Th>
                <Th onClick={() => toggleOrder("pct_visitado_real")} right>% Visitado{ordIcon("pct_visitado_real")}</Th>
                <Th onClick={() => toggleOrder("tarifa_base")} right>Tarifa{ordIcon("tarifa_base")}</Th>
                <Th onClick={() => toggleOrder("ajuste_ns")} right>±NS{ordIcon("ajuste_ns")}</Th>
                <Th right>Bonif.</Th>
                <Th onClick={() => toggleOrder("auxiliar_estado")} center>Aux{ordIcon("auxiliar_estado")}</Th>
                <Th onClick={() => toggleOrder("monto_auxiliar")} right>$Aux{ordIcon("monto_auxiliar")}</Th>
                <Th onClick={() => toggleOrder("pago_neto")} right>Pago neto{ordIcon("pago_neto")}</Th>
                <Th right>Pago MELI</Th>
                <Th right>% Margen</Th>
                <Th>Observaciones</Th>
                <Th center>Pago</Th>
              </tr>
            </thead>
            <tbody>
              {filasFiltradas.map((r, i) => {
                const noPagada = r.ns_categoria === "NO_PAGO_VIS<90%";
                const tieneAlerta = alertasDe(r).length > 0 && !noPagada;
                const pagoMeli = r.pago_meli != null ? Number(r.pago_meli) : null;
                const margenPct = (pagoMeli != null && pagoMeli > 0) ? ((pagoMeli - Number(r.pago_neto)) / pagoMeli * 100) : null;
                return (
                  <tr key={r.id || i} style={{ borderBottom: "1px solid #f0f0f0", background: noPagada ? "#fef2f2" : tieneAlerta ? "#fffbeb" : undefined }}>
                    <td style={tdStyle(true)}>{r.driver_name || "—"}</td>
                    <td style={{ ...tdStyle(), fontFamily: "monospace", fontSize: 10 }}>{r.placa || "—"}</td>
                    <td style={{ ...tdStyle(), fontSize: 10, color: "#475569", maxWidth: 170, whiteSpace: "normal", lineHeight: 1.25 }}>
                      {empresaMap[normalizarPlaca(r.placa)] || "—"}
                    </td>
                    <td style={tdStyle()}>
                      <div style={{ fontSize: 10, color: "#475569" }}>{r.tipologia || "?"}</div>
                      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>{r.vehiculo_raw || ""}</div>
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "center" }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: r.tipo_ruta_sdd === "SDD" ? "#fde68a" : r.tipo_ruta_sdd === "SPOT" ? "#e5e7eb" : "#f1f5f9", color: r.tipo_ruta_sdd === "SDD" ? "#92400e" : r.tipo_ruta_sdd === "SPOT" ? "#475569" : "#94a3b8" }}>{r.tipo_ruta_sdd || "—"}</span>
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "center" }}>
                      <div style={{ fontWeight: 700, color: "#1a3a6b" }}>{r.service_center_id}</div>
                      <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "#e0e7ff", color: "#3730a3", fontWeight: 600 }}>{r.zona || "?"}</span>
                    </td>
                    <td style={{ ...tdStyle(), fontFamily: "monospace", fontSize: 10 }}>{r.id_ruta}</td>
                    <td style={{ ...tdStyle(), textAlign: "center", fontSize: 10 }}>{(() => {
                      const s = (r.status_final || "").toLowerCase();
                      if (!s) return <span style={{ color: "#cbd5e1" }}>—</span>;
                      if (s.startsWith("close") || s.includes("cerr")) return <span style={{ color: "#16a34a", fontWeight: 600 }}>Cerrada</span>;
                      if (s.includes("pend")) return <span style={{ color: "#dc2626", fontWeight: 600 }}>Pendiente</span>;
                      if (s.startsWith("open") || s.includes("abier") || s.includes("progress") || s.includes("ruta")) return <span style={{ color: "#ca8a04", fontWeight: 600 }}>Abierta</span>;
                      return <span style={{ color: "#7c3aed", fontWeight: 600 }}>{r.status_final}</span>;
                    })()}</td>
                    <td style={{ ...tdStyle(), textAlign: "right" }}>{Number(r.km_recorridos || 0).toFixed(1)}</td>
                    <td style={{ ...tdStyle(), textAlign: "right", color: "#0369a1", fontWeight: 600 }}>
                      {r.km_recorridos_meli != null ? Number(r.km_recorridos_meli).toFixed(1) : "\u2014"}
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "right" }}>
                      <div>{fmtPct(r.ns_pct)}</div>
                      <div style={{ fontSize: 9, color: noPagada ? "#991b1b" : "#94a3b8", fontWeight: noPagada ? 600 : 400 }}>
                        {r.ns_categoria}
                      </div>
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "right", color: noPagada ? "#991b1b" : "#475569", fontWeight: noPagada ? 600 : 400 }}>
                      {r.pct_visitado_real != null ? fmtPct(r.pct_visitado_real) : "—"}
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "right", textDecoration: noPagada ? "line-through" : undefined, color: noPagada ? "#94a3b8" : undefined }}>
                      {fmtMXN(r.tarifa_base)}
                      {r.tiene_tarifa_especial && <div style={{ fontSize: 8, color: "#7c3aed", fontWeight: 600 }}>ESP</div>}
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "right", color: noPagada ? "#94a3b8" : (Number(r.ajuste_ns) >= 0 ? "#16a34a" : "#dc2626"), textDecoration: noPagada ? "line-through" : undefined }}>
                      {Number(r.ajuste_ns) >= 0 ? "+" : ""}{fmtMXN(r.ajuste_ns)}
                    </td>
                    {(() => {
                      const pct = Number(r.bonificacion_pct || 0);
                      if (!pct || !r.bonificacion_nombre) return <td style={{ ...tdStyle(), textAlign: "right", color: "#94a3b8" }}>—</td>;
                      const monto = Number(r.monto_bonificacion || 0);
                      return (
                        <td style={{ ...tdStyle(), textAlign: "right" }}>
                          <div style={{ fontWeight: 700, color: "#7c3aed" }}>+{pct}%</div>
                          <div style={{ fontSize: 8, color: "#94a3b8", maxWidth: 110, whiteSpace: "normal", lineHeight: 1.2 }}>{r.bonificacion_nombre}</div>
                          <div style={{ fontSize: 9, color: "#7c3aed" }}>+{fmtMXN(monto)}</div>
                        </td>
                      );
                    })()}
                    <td style={{ ...tdStyle(), textAlign: "center", fontSize: 9 }}>
                      <span style={{ ...badgeAux(r.auxiliar_estado) }}>{r.auxiliar_estado}</span>
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "right" }}>
                      {Number(r.monto_auxiliar) > 0 ? fmtMXN(r.monto_auxiliar) : "—"}
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "right", fontWeight: 700, color: noPagada ? "#991b1b" : "#16a34a", fontSize: 12 }}>
                      {noPagada ? "$0" : fmtMXN(r.pago_neto)}
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "right", color: "#475569" }}>
                      {pagoMeli != null ? fmtMXN(pagoMeli) : "—"}
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "right", fontWeight: 600, color: margenPct == null ? "#94a3b8" : (margenPct >= 0 ? "#16a34a" : "#dc2626") }}>
                      {margenPct != null ? `${margenPct.toFixed(1)}%` : "—"}
                    </td>
                    <td style={{ ...tdStyle(), fontSize: 10, color: noPagada ? "#991b1b" : (r.observaciones ? "#92400e" : "#cbd5e1"), maxWidth: 260, whiteSpace: "normal", lineHeight: 1.3 }} title={r.observaciones || ""}>
                      {r.observaciones || "—"}
                    </td>
                    <td style={{ ...tdStyle(), textAlign: "center", whiteSpace: "nowrap" }}>
                      {r.pausado ? (
                        <div>
                          <span title={r.pausa_motivo || ""} style={{ display: "inline-block", fontSize: 10, fontWeight: 800, color: "#92400e", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, padding: "2px 6px" }}>⏸ Pausado</span>
                          <button onClick={() => reanudarPago(r)} style={{ display: "block", margin: "4px auto 0", fontSize: 10, fontWeight: 700, color: "#166534", background: "#fff", border: "1px solid #166534", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>Reanudar</button>
                        </div>
                      ) : (
                        <button onClick={() => { setPausaMotivo(""); setPausaModal({ r }); }} disabled={!r.id} title={r.id ? "Pausar el pago de esta ruta" : "Sin id, no se puede pausar"} style={{ fontSize: 10, fontWeight: 700, color: "#b45309", background: "#fff", border: "1px solid #fcd34d", borderRadius: 6, padding: "3px 8px", cursor: r.id ? "pointer" : "not-allowed" }}>⏸ Pausar</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* Fila de totales */}
              {filasFiltradas.length > 0 && (
                <tr style={{ background: "#f1f5f9", borderTop: "2px solid #cbd5e1", fontWeight: 700 }}>
                  <td colSpan={11} style={{ ...tdStyle(), textAlign: "right", color: "#1a3a6b" }}>
                    TOTAL · {filasFiltradas.length} rutas · {totales.choferes} choferes
                  </td>
                  <td style={{ ...tdStyle(), textAlign: "right", color: "#1a3a6b" }}>{fmtMXN(totales.tarifaBase)}</td>
                  <td style={{ ...tdStyle(), textAlign: "right", color: totales.ajusteNS >= 0 ? "#16a34a" : "#dc2626" }}>
                    {totales.ajusteNS >= 0 ? "+" : ""}{fmtMXN(totales.ajusteNS)}
                  </td>
                  <td style={tdStyle()}></td>
                  <td style={tdStyle()}></td>
                  <td style={{ ...tdStyle(), textAlign: "right", color: "#1a3a6b" }}>{fmtMXN(totales.auxiliar)}</td>
                  <td style={{ ...tdStyle(), textAlign: "right", color: "#16a34a", fontSize: 13 }}>{fmtMXN(totales.pagoNeto)}</td>
                  <td style={{ ...tdStyle(), textAlign: "right", color: "#1a3a6b" }}>{totales.pagoMeli > 0 ? fmtMXN(totales.pagoMeli) : "—"}</td>
                  <td style={{ ...tdStyle(), textAlign: "right", color: "#1a3a6b" }}>{totales.margenPct != null ? `${totales.margenPct.toFixed(1)}%` : "—"}</td>
                  <td style={tdStyle()}></td>
                  <td style={tdStyle()}></td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const tdStyle = (bold) => ({
  padding: "8px 10px",
  fontWeight: bold ? 600 : 400,
  verticalAlign: "top",
});

const Th = ({ children, onClick, right, center }) => (
  <th onClick={onClick}
    style={{
      padding: "10px 10px",
      textAlign: right ? "right" : center ? "center" : "left",
      fontSize: 10,
      fontWeight: 700,
      color: "#475569",
      cursor: onClick ? "pointer" : "default",
      userSelect: "none",
      background: "#f8fafc",
      whiteSpace: "nowrap",
    }}>
    {children}
  </th>
);

const badgeAux = (estado) => {
  const map = {
    "APROBADO":              { bg: "#dcfce7", co: "#166534" },
    "OK":                    { bg: "#dcfce7", co: "#166534" },
    "MID_ROUTE_REVISION":    { bg: "#fef3c7", co: "#92400e" },
    "MID_ROUTE":             { bg: "#fef3c7", co: "#92400e" },
    "SIN_APROBACION":        { bg: "#fef3c7", co: "#92400e" },
    "BLOQUEADO_ESTRUCTURAL": { bg: "#fee2e2", co: "#991b1b" },
    "BLOQUEADO_ANALISTA":    { bg: "#fee2e2", co: "#991b1b" },
    "RECHAZADO":             { bg: "#fee2e2", co: "#991b1b" },
    "SOSPECHOSO":            { bg: "#fee2e2", co: "#991b1b" },
    "NO_AUTORIZADO":         { bg: "#fee2e2", co: "#991b1b" },
    "SIN_HELPER":            { bg: "#f1f5f9", co: "#64748b" },
  };
  const m = map[estado] || map["SIN_HELPER"];
  return { padding: "2px 6px", borderRadius: 3, fontWeight: 600, background: m.bg, color: m.co };
};

function InformacionDeRuta() {
  const [fecha, setFecha] = useState(fechaOperativaOffset(-1));
  const [rutas, setRutas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroAlerta, setFiltroAlerta] = useState("todas");
  const [orderBy, setOrderBy] = useState("driver_name");
  const [orderDir, setOrderDir] = useState("asc");
  const [detalleRuta, setDetalleRuta] = useState(null); // {ruta, snapshots} cuando se expande

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await sb.from("maestro_jornada_mx")
          .select("*")
          .eq("fecha", fecha)
          .order("driver_name")
          .limit(5000);
        if (cancel) return;
        if (error) throw error;
        setRutas(data || []);
      } catch (e) {
        console.error(e);
        if (!cancel) setRutas([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [fecha]);

  // Helpers
  const fmtDuracion = (mins) => {
    if (mins == null || mins === 0) return "—";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  };
  const fmtHoraMX = (iso) => {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat("es-MX", {
        timeZone: "America/Mexico_City",
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso));
    } catch { return "—"; }
  };
  const fmtPct = (n) => `${Number(n || 0).toFixed(2)}%`;

  // Reglas de coloración (semáforo)
  const colorDuracion = (mins) => {
    if (mins == null) return "#94a3b8";
    if (mins > 720) return "#dc2626"; // > 12h rojo
    if (mins > 480) return "#d97706"; // > 8h ámbar
    return "#16a34a"; // verde
  };
  const colorNS = (ns) => {
    const n = Number(ns) || 0;
    if (n >= 99.5) return "#16a34a";
    if (n >= 95) return "#d97706";
    return "#dc2626";
  };
  const colorStemOut = (m) => {
    if (m == null) return "#94a3b8";
    if (m > 90) return "#dc2626";
    if (m > 30) return "#d97706";
    return "#16a34a";
  };
  const colorLoyalty = (tier) => {
    const t = String(tier || "").toLowerCase();
    if (t.includes("oro") || t.includes("gold")) return "#ca8a04";
    if (t.includes("plata") || t.includes("silver")) return "#64748b";
    if (t.includes("bronce") || t.includes("bronze")) return "#9a3412";
    return "#94a3b8";
  };

  // Filtrado
  const filtradas = useMemo(() => {
    let res = [...rutas];
    if (busqueda) {
      const q = busqueda.toLowerCase();
      res = res.filter(r =>
        (r.driver_name || "").toLowerCase().includes(q) ||
        (r.placa || "").toLowerCase().includes(q) ||
        (r.service_center_id || "").toLowerCase().includes(q) ||
        (r.id_ruta || "").toLowerCase().includes(q)
      );
    }
    if (filtroAlerta === "rutas_largas") res = res.filter(r => (r.duracion_minutos || 0) > 720);
    else if (filtroAlerta === "cruces") res = res.filter(r => r.cruza_medianoche);
    else if (filtroAlerta === "ns_bajo") res = res.filter(r => Number(r.ns_pct || 0) < 95);
    else if (filtroAlerta === "performance_not_ok") res = res.filter(r => r.performance_score === "NOT_OK");
    else if (filtroAlerta === "retraso_inicial") res = res.filter(r => r.tiene_retraso_inicial);
    else if (filtroAlerta === "incidentes") res = res.filter(r => (r.cantidad_incidentes || 0) > 0);
    else if (filtroAlerta === "loyalty_bronce") res = res.filter(r => (r.loyalty_tier || "").toLowerCase().includes("bronce"));

    res.sort((a, b) => {
      const va = a[orderBy], vb = b[orderBy];
      const numA = typeof va === "number" || (!isNaN(parseFloat(va)) && va !== null);
      const numB = typeof vb === "number" || (!isNaN(parseFloat(vb)) && vb !== null);
      let cmp = 0;
      if (numA && numB) cmp = Number(va) - Number(vb);
      else cmp = String(va || "").localeCompare(String(vb || ""));
      return orderDir === "asc" ? cmp : -cmp;
    });
    return res;
  }, [rutas, busqueda, filtroAlerta, orderBy, orderDir]);

  const toggleOrder = (col) => {
    if (orderBy === col) setOrderDir(orderDir === "asc" ? "desc" : "asc");
    else { setOrderBy(col); setOrderDir("asc"); }
  };
  const ordIcon = (col) => orderBy === col ? (orderDir === "asc" ? " ↑" : " ↓") : "";

  // KPIs
  const kpis = useMemo(() => {
    const conDur = rutas.filter(r => r.duracion_minutos != null);
    const durProm = conDur.length > 0 ? conDur.reduce((s, r) => s + r.duracion_minutos, 0) / conDur.length : 0;
    const kmProm = rutas.length > 0 ? rutas.reduce((s, r) => s + Number(r.km_recorridos || 0), 0) / rutas.length : 0;
    const nsProm = rutas.length > 0 ? rutas.reduce((s, r) => s + Number(r.ns_pct || 0), 0) / rutas.length : 0;
    const tiers = rutas.reduce((acc, r) => {
      const t = r.loyalty_tier || "Sin loyalty";
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});
    return {
      total: rutas.length,
      durProm,
      kmProm,
      nsProm,
      tiers,
      rutasLargas: rutas.filter(r => (r.duracion_minutos || 0) > 720).length,
      cruces: rutas.filter(r => r.cruza_medianoche).length,
      nsBajo: rutas.filter(r => Number(r.ns_pct || 0) < 95).length,
      perfNotOk: rutas.filter(r => r.performance_score === "NOT_OK").length,
      retrasoInicial: rutas.filter(r => r.tiene_retraso_inicial).length,
      conIncidentes: rutas.filter(r => (r.cantidad_incidentes || 0) > 0).length,
      bronces: rutas.filter(r => (r.loyalty_tier || "").toLowerCase().includes("bronce")).length,
    };
  }, [rutas]);

  // Cargar detalle expandido (raw_json del último snapshot)
  const cargarDetalle = async (ruta) => {
    if (detalleRuta?.ruta?.id === ruta.id) {
      setDetalleRuta(null);
      return;
    }
    setDetalleRuta({ ruta, snapshots: null, loading: true });
    try {
      const { data, error } = await sb.from("logistic_ayudantes_snapshots")
        .select("momento_dia, hora_snapshot, status, has_helper, raw_json")
        .eq("id_ruta", Number(ruta.id_ruta))
        .gte("fecha", new Date(new Date(fecha).getTime() - 86400000).toISOString().slice(0, 10))
        .lte("fecha", new Date(new Date(fecha).getTime() + 86400000).toISOString().slice(0, 10))
        .order("hora_snapshot");
      if (error) throw error;
      setDetalleRuta({ ruta, snapshots: data || [], loading: false });
    } catch (e) {
      console.error(e);
      setDetalleRuta({ ruta, snapshots: [], loading: false, error: e.message });
    }
  };

  // Export CSV
  const exportarCSV = () => {
    if (filtradas.length === 0) { alert("No hay datos para exportar"); return; }
    const headers = [
      "Fecha","Chofer","Patente","Vehículo","Tipología","SC","Zona","ID Ruta","Ciclo",
      "Hora inicio MX","Hora fin MX","Duración min","Cruzó medianoche",
      "Km","NS%","No visitado %","Categoría NS",
      "Loyalty","Performance","Retraso inicial","Incidentes","Stem out min",
      "Pago neto",
    ];
    const rows = filtradas.map(r => [
      r.fecha, r.driver_name, r.placa, r.vehiculo_raw, r.tipologia, r.service_center_id, r.zona,
      r.id_ruta, r.ciclo, fmtHoraMX(r.hora_inicio_ruta), fmtHoraMX(r.hora_fin_ruta),
      r.duracion_minutos, r.cruza_medianoche ? "SI" : "NO",
      r.km_recorridos, r.ns_pct, r.ns_no_visitado, r.ns_categoria,
      r.loyalty_tier, r.performance_score, r.tiene_retraso_inicial ? "SI" : "NO",
      r.cantidad_incidentes, r.stem_out_minutos, r.pago_neto,
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `info_ruta_${fecha}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pg" style={{ maxWidth: 1700 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="sec-title">Información de Ruta</div>
        <div className="sec-sub">Análisis operacional · datos del raw_json de Logistic</div>
      </div>

      {/* Selector de fecha + búsqueda + export */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Fecha de operación</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {[
            { l: "Ayer", fn: () => setFecha(fechaOperativaOffset(-1)) },
            { l: "Hoy", fn: () => setFecha(fechaHoyOperativa()) },
            { l: "-2 días", fn: () => setFecha(fechaOperativaOffset(-2)) },
            { l: "-3 días", fn: () => setFecha(fechaOperativaOffset(-3)) },
            { l: "-7 días", fn: () => setFecha(fechaOperativaOffset(-7)) },
          ].map(({ l, fn }) => (
            <button key={l} onClick={fn} style={{ padding: "5px 12px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#f8fafc", color: "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12 }} />
          <input type="text" placeholder="Buscar chofer / patente / SC / id ruta..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
            style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12, flex: 1, minWidth: 240 }} />
          <button onClick={exportarCSV} disabled={filtradas.length === 0}
            style={{ padding: "8px 14px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 600, cursor: filtradas.length === 0 ? "not-allowed" : "pointer", opacity: filtradas.length === 0 ? 0.5 : 1 }}>
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Panel de alertas */}
      {!loading && rutas.length > 0 && (
        <div style={{ background: "#fef9f3", border: "1px solid #fed7aa", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#9a3412", marginBottom: 10 }}>Alertas del día</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
            {[
              { id: "rutas_largas",        label: "Rutas largas (>12h)",     count: kpis.rutasLargas,     col: "#dc2626" },
              { id: "cruces",              label: "Cruzaron medianoche",      count: kpis.cruces,          col: "#7c3aed" },
              { id: "ns_bajo",             label: "NS < 95% (Crítico)",        count: kpis.nsBajo,          col: "#dc2626" },
              { id: "performance_not_ok",  label: "Performance NOT_OK",       count: kpis.perfNotOk,       col: "#dc2626" },
              { id: "retraso_inicial",     label: "Con retraso inicial",      count: kpis.retrasoInicial,  col: "#d97706" },
              { id: "incidentes",          label: "Con incidentes",           count: kpis.conIncidentes,   col: "#d97706" },
              { id: "loyalty_bronce",      label: "Choferes Bronce",          count: kpis.bronces,         col: "#9a3412" },
            ].filter(a => a.count > 0).map(a => (
              <button key={a.id} onClick={() => setFiltroAlerta(filtroAlerta === a.id ? "todas" : a.id)}
                style={{ background: filtroAlerta === a.id ? a.col : "#fff", color: filtroAlerta === a.id ? "#fff" : a.col,
                  border: `1px solid ${a.col}`, borderRadius: 4, padding: "8px 10px", textAlign: "left", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{a.label}</span>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{a.count}</span>
                </div>
              </button>
            ))}
            {kpis.rutasLargas + kpis.cruces + kpis.nsBajo + kpis.perfNotOk + kpis.retrasoInicial + kpis.conIncidentes + kpis.bronces === 0 && (
              <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>Sin alertas — todo en orden ✓</div>
            )}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Rutas</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{kpis.total}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Duración prom.</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{fmtDuracion(Math.round(kpis.durProm))}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Km prom.</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{kpis.kmProm.toFixed(1)}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>NS prom.</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: colorNS(kpis.nsProm), marginTop: 2 }}>{fmtPct(kpis.nsProm)}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Loyalty mix</div>
          <div style={{ fontSize: 11, marginTop: 4, color: "#475569" }}>
            {Object.entries(kpis.tiers).slice(0, 4).map(([t, c]) => (
              <div key={t} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colorLoyalty(t), fontWeight: 600 }}>{t}</span>
                <span>{c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto" }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Cargando datos del {fecha}...</div>
        ) : rutas.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: "#475569" }}>Sin datos para {fecha}</div>
            <div style={{ fontSize: 11 }}>Andá a "Listado de Pagos" y apretá "Calcular pagos del día" para esta fecha.</div>
          </div>
        ) : filtradas.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Ningún registro coincide con los filtros</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 1500 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <Th onClick={() => toggleOrder("driver_name")}>Chofer{ordIcon("driver_name")}</Th>
                <Th onClick={() => toggleOrder("service_center_id")} center>SC · Zona{ordIcon("service_center_id")}</Th>
                <Th onClick={() => toggleOrder("placa")}>Patente · Vehíc.{ordIcon("placa")}</Th>
                <Th onClick={() => toggleOrder("id_ruta")}>ID Ruta{ordIcon("id_ruta")}</Th>
                <Th onClick={() => toggleOrder("hora_inicio_ruta")} center>Inicio MX{ordIcon("hora_inicio_ruta")}</Th>
                <Th onClick={() => toggleOrder("hora_fin_ruta")} center>Fin MX{ordIcon("hora_fin_ruta")}</Th>
                <Th onClick={() => toggleOrder("duracion_minutos")} right>Dur.{ordIcon("duracion_minutos")}</Th>
                <Th onClick={() => toggleOrder("km_recorridos")} right>Km{ordIcon("km_recorridos")}</Th>
                <Th onClick={() => toggleOrder("ns_pct")} right>NS%{ordIcon("ns_pct")}</Th>
                <Th onClick={() => toggleOrder("loyalty_tier")} center>Loyalty{ordIcon("loyalty_tier")}</Th>
                <Th onClick={() => toggleOrder("performance_score")} center>Perf.{ordIcon("performance_score")}</Th>
                <Th onClick={() => toggleOrder("stem_out_minutos")} right>StemOut{ordIcon("stem_out_minutos")}</Th>
                <Th onClick={() => toggleOrder("cantidad_incidentes")} right>Incid.{ordIcon("cantidad_incidentes")}</Th>
                <Th center>Detalle</Th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((r, i) => {
                const expanded = detalleRuta?.ruta?.id === r.id;
                return (
                  <Fragment key={r.id || i}>
                    <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={tdStyle(true)}>{r.driver_name || "—"}</td>
                      <td style={{ ...tdStyle(), textAlign: "center" }}>
                        <div style={{ fontWeight: 700, color: "#1a3a6b" }}>{r.service_center_id}</div>
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "#e0e7ff", color: "#3730a3", fontWeight: 600 }}>{r.zona || "?"}</span>
                      </td>
                      <td style={tdStyle()}>
                        <div style={{ fontFamily: "monospace", fontSize: 10 }}>{r.placa || "—"}</div>
                        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>{r.tipologia || "?"}</div>
                      </td>
                      <td style={{ ...tdStyle(), fontFamily: "monospace", fontSize: 10 }}>{r.id_ruta}</td>
                      <td style={{ ...tdStyle(), textAlign: "center", fontSize: 10 }}>{fmtHoraMX(r.hora_inicio_ruta)}</td>
                      <td style={{ ...tdStyle(), textAlign: "center", fontSize: 10 }}>
                        {fmtHoraMX(r.hora_fin_ruta)}
                        {r.cruza_medianoche && <div style={{ fontSize: 9, color: "#7c3aed", fontWeight: 700 }}>★ cruzó 0h</div>}
                      </td>
                      <td style={{ ...tdStyle(), textAlign: "right", fontWeight: 700, color: colorDuracion(r.duracion_minutos) }}>
                        {fmtDuracion(r.duracion_minutos)}
                      </td>
                      <td style={{ ...tdStyle(), textAlign: "right" }}>{Number(r.km_recorridos || 0).toFixed(1)}</td>
                      <td style={{ ...tdStyle(), textAlign: "right", color: colorNS(r.ns_pct), fontWeight: 600 }}>
                        <div>{fmtPct(r.ns_pct)}</div>
                        <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 400 }}>{r.ns_categoria}</div>
                      </td>
                      <td style={{ ...tdStyle(), textAlign: "center" }}>
                        {r.loyalty_tier ? (
                          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, fontWeight: 600,
                            background: colorLoyalty(r.loyalty_tier) + "22", color: colorLoyalty(r.loyalty_tier) }}>
                            {r.loyalty_tier}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ ...tdStyle(), textAlign: "center", fontSize: 10 }}>
                        {r.performance_score ? (
                          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, fontWeight: 600,
                            background: r.performance_score === "OK" ? "#dcfce7" : "#fee2e2",
                            color: r.performance_score === "OK" ? "#166534" : "#991b1b" }}>
                            {r.performance_score}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ ...tdStyle(), textAlign: "right", color: colorStemOut(r.stem_out_minutos), fontWeight: 600 }}>
                        {r.stem_out_minutos != null ? `${r.stem_out_minutos}m` : "—"}
                      </td>
                      <td style={{ ...tdStyle(), textAlign: "right", color: r.cantidad_incidentes > 0 ? "#dc2626" : "#94a3b8", fontWeight: r.cantidad_incidentes > 0 ? 700 : 400 }}>
                        {r.cantidad_incidentes || 0}
                      </td>
                      <td style={{ ...tdStyle(), textAlign: "center" }}>
                        <button onClick={() => cargarDetalle(r)}
                          style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #e4e7ec",
                            background: expanded ? "#1a3a6b" : "#fff", color: expanded ? "#fff" : "#475569",
                            fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          {expanded ? "Cerrar" : "Ver"}
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detalle expandido — fuera de la tabla para no heredar minWidth */}
      {detalleRuta && (
        <div style={{ marginTop: 14, background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 8, padding: 0 }}>
          <DetalleRutaExpandido detalle={detalleRuta} fmtHoraMX={fmtHoraMX} onClose={() => setDetalleRuta(null)} />
        </div>
      )}
    </div>
  );
}

function DetalleRutaExpandido({ detalle, fmtHoraMX, onClose }) {
  if (detalle.loading) {
    return <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>Cargando detalle...</div>;
  }
  if (!detalle.snapshots || detalle.snapshots.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
        Sin snapshots disponibles para esta ruta
        {onClose && <button onClick={onClose} style={{ marginLeft: 12, padding: "4px 12px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#fff", cursor: "pointer", fontSize: 11 }}>Cerrar</button>}
      </div>
    );
  }
  const r = detalle.ruta;
  // Tomar el último snapshot con raw_json
  const ultimo = [...detalle.snapshots].reverse().find(s => s.raw_json) || detalle.snapshots[detalle.snapshots.length - 1];
  const rj = ultimo?.raw_json || {};
  const stats = rj.driver?.loyalty?.stats || [];
  const counters = rj.counters || {};
  const shipmentData = rj.shipmentData || {};
  const timing = rj.timingData || {};
  const flags = rj.flags || {};

  const Item = ({ label, value, color }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px dashed #e4e7ec", gap: 8 }}>
      <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: color || "#1a3a6b", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );

  return (
    <div>
      {/* Header sticky con título y botón cerrar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 16px", borderBottom: "1px solid #e4e7ec",
        background: "#fff", borderRadius: "8px 8px 0 0",
        position: "sticky", top: 0, zIndex: 5,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b" }}>
            Detalle de la ruta {r.id_ruta}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {r.driver_name} · {r.service_center_id} · {r.placa}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose}
            style={{ padding: "6px 14px", borderRadius: 4, border: "1px solid #e4e7ec",
              background: "#fff", color: "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Cerrar
          </button>
        )}
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        {/* Driver */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", marginBottom: 8 }}>Chofer</div>
          <Item label="ID MELI" value={rj.driver?.driverId || r.driver_id || "—"} />
          <Item label="Nombre" value={rj.driver?.driverName || r.driver_name} />
          <Item label="Loyalty" value={rj.driver?.loyalty?.name || "—"} />
          {stats.map((s, i) => (
            <div key={i} style={{ fontSize: 10, color: "#64748b", padding: "2px 0" }}>· {s.label}</div>
          ))}
          <Item label="Reclamos hoy" value={rj.driver?.driverClaims ?? "—"} color={rj.driver?.driverClaims > 0 ? "#dc2626" : undefined} />
          <Item label="Contact rate" value={rj.driver?.contactRate || "—"} />
        </div>

        {/* Ruta y vehículo */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", marginBottom: 8 }}>Ruta y Vehículo</div>
          <Item label="Patente" value={rj.vehicle?.license || r.placa || "—"} />
          <Item label="Descripción" value={rj.vehicle?.description || r.vehiculo_raw || "—"} />
          <Item label="Cluster" value={rj.cluster || "—"} />
          <Item label="Cycle" value={rj.plannedRoute?.cycleName || r.ciclo || "—"} />
          <Item label="Service Center" value={rj.serviceCenterId || r.service_center_id} />
          <Item label="Performance Score" value={rj.routePerformanceScore || "—"}
            color={rj.routePerformanceScore === "NOT_OK" ? "#dc2626" : "#16a34a"} />
          <Item label="Status" value={rj.status || "—"} />
        </div>

        {/* Tiempos */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#0891b2", textTransform: "uppercase", marginBottom: 8 }}>Tiempos</div>
          <Item label="Inicio asignado" value={fmtHoraMX(r.hora_inicio_ruta)} />
          <Item label="Fin de ruta" value={fmtHoraMX(r.hora_fin_ruta)} />
          <Item label="1ª entrega real" value={rj.dateFirstMovement ? fmtHoraMX(new Date(rj.dateFirstMovement * 1000).toISOString()) : "—"} />
          <Item label="Duración total" value={r.duracion_minutos ? `${Math.floor(r.duracion_minutos/60)}h ${r.duracion_minutos%60}m` : "—"} />
          <Item label="ORH (min en ruta)" value={timing.orh ?? "—"} />
          <Item label="OZH (min en zona)" value={timing.ozh ?? "—"} />
          <Item label="Stem In" value={timing.stemIn != null ? `${timing.stemIn} min` : "—"} />
          <Item label="Stem Out" value={timing.stemOut != null ? `${timing.stemOut} min` : "—"}
            color={timing.stemOut > 90 ? "#dc2626" : timing.stemOut > 30 ? "#d97706" : "#16a34a"} />
          <Item label="Retraso inicial" value={flags.hasInitialDelay ? "SÍ" : "NO"}
            color={flags.hasInitialDelay ? "#dc2626" : "#16a34a"} />
        </div>

        {/* Entregas */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", marginBottom: 8 }}>Entregas</div>
          <Item label="Total despachados" value={counters.total ?? r.envios_despachados ?? "—"} />
          <Item label="Entregados" value={counters.delivered ?? r.envios_entregados ?? "—"} />
          <Item label="No entregados" value={counters.notDelivered ?? "—"}
            color={counters.notDelivered > 0 ? "#dc2626" : undefined} />
          <Item label="NS%" value={`${r.ns_pct}%`} />
          <Item label="No visitado %" value={`${r.ns_no_visitado}%`}
            color={r.ns_no_visitado > 10 ? "#dc2626" : r.ns_no_visitado > 2 ? "#d97706" : "#16a34a"} />
          <Item label="Failed delivery idx" value={flags.failedDeliveryIndex?.percent || "—"} />
          <Item label="Reclamos" value={rj.claimsCount ?? flags.claimsCount ?? 0} />
        </div>

        {/* Incidencias y notas */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", marginBottom: 8 }}>Incidentes y Notas</div>
          <Item label="Incidentes (cant.)" value={rj.incidentTypes?.length || 0}
            color={(rj.incidentTypes?.length || 0) > 0 ? "#dc2626" : "#16a34a"} />
          <Item label="Tipos de incidente" value={rj.incidentTypes?.join(", ") || "—"} />
          <Item label="Notas (cant.)" value={rj.notesQuantity ?? 0} />
          <Item label="Casos abiertos (TOC)" value={rj.tocTotalCases ?? 0}
            color={(rj.tocTotalCases || 0) > 0 ? "#d97706" : undefined} />
          <Item label="Warnings" value={rj.warningsQuantity ?? 0} />
          <Item label="Has comments" value={rj.hasComments ? "SÍ" : "NO"} />
        </div>

        {/* Auxiliar / Pago */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#F47B20", textTransform: "uppercase", marginBottom: 8 }}>Auxiliar y Pago</div>
          <Item label="Estado auxiliar" value={r.auxiliar_estado || "—"} />
          <Item label="Snapshots con helper" value={`${r.auxiliar_snapshots_total || 0} / 5`} />
          <Item label="Tarifa base" value={`$${Number(r.tarifa_base || 0).toLocaleString("es-MX")}`} />
          <Item label="Ajuste NS" value={`$${Number(r.ajuste_ns || 0).toLocaleString("es-MX")}`}
            color={r.ajuste_ns >= 0 ? "#16a34a" : "#dc2626"} />
          <Item label="Monto auxiliar" value={`$${Number(r.monto_auxiliar || 0).toLocaleString("es-MX")}`} />
          <Item label="Pago neto" value={`$${Number(r.pago_neto || 0).toLocaleString("es-MX")}`} color="#16a34a" />
        </div>
        </div>

        {/* Timeline de snapshots */}
        <div style={{ marginTop: 14, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", marginBottom: 8 }}>
            Timeline de snapshots ({detalle.snapshots.length})
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {detalle.snapshots.map((s, i) => (
              <div key={i} style={{ background: s.has_helper ? "#dcfce7" : "#f1f5f9", border: "1px solid #e4e7ec",
                borderRadius: 4, padding: "6px 10px", fontSize: 10 }}>
                <div style={{ fontWeight: 700, color: "#1a3a6b" }}>{s.momento_dia}</div>
                <div style={{ color: "#64748b" }}>{fmtHoraMX(s.hora_snapshot)}</div>
                <div style={{ color: s.has_helper ? "#166534" : "#94a3b8", marginTop: 2 }}>
                  {s.has_helper ? "✓ helper" : "sin helper"}
                </div>
                <div style={{ color: "#64748b", fontSize: 9, marginTop: 1 }}>{s.status}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const N8N_WEBHOOK_RERUN_HELPERS = "https://bigticket2026.app.n8n.cloud/webhook/rerun-helpers-mx";

function AyudantesDetalleDia() {
  // ── Fecha por defecto: día anterior (operativo MX) ──
  const fechaAyerOperativa = () => {
    try {
      const d = new Date(fechaHoyOperativa() + "T12:00:00");
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    } catch { return new Date(Date.now() - 86400000).toISOString().slice(0, 10); }
  };

  const [vista, setVista] = useState("entregas"); // "entregas" | "matriz"
  const [snapshots, setSnapshots] = useState([]);
  const [entregas, setEntregas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fecha, setFecha] = useState(fechaAyerOperativa());
  const [busqueda, setBusqueda] = useState("");
  const [filtroAsignable, setFiltroAsignable] = useState("asignables"); // "asignables" | "no_asignables" | "todas"
  const [disparando, setDisparando] = useState(false);
  const [msgFlujo, setMsgFlujo] = useState("");

  useEffect(() => { cargar(); }, [fecha]);

  // Lectura paginada (Supabase REST corta en 1000 filas)
  const fetchAll = async (tabla, select) => {
    const out = [];
    for (let desde = 0; desde < 20000; desde += 1000) {
      const { data, error } = await sb.from(tabla).select(select).eq("fecha", fecha).range(desde, desde + 999);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  };

  const cargar = async () => {
    setLoading(true);
    try {
      const [snaps, ents] = await Promise.all([
        fetchAll("logistic_ayudantes_snapshots", "id_ruta,service_center_id,cluster,driver_id,driver_name,vehiculo_descripcion,placa,is_assignable,momento_dia,hora_snapshot,has_helper,entregados,total_envios"),
        fetchAll("meli_paquetes_entregados", "id_ruta,service_center_id,driver_id,driver_name,user_id_real,user_name_real"),
      ]);
      setSnapshots(snaps);
      setEntregas(ents);
    } catch (e) { console.error(e); setSnapshots([]); setEntregas([]); }
    setLoading(false);
  };

  // ── Helpers de nombres (MELI duplica: "Pedro Jehonatan Pedro Jehonatan Garduño Lopez") ──
  const normTokens = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const esMismaPersona = (userName, driverName) => {
    const u = new Set(normTokens(userName));
    const d = normTokens(driverName);
    if (d.length === 0 || u.size === 0) return false;
    const hits = d.filter(t => u.has(t)).length;
    return hits >= Math.min(2, d.length);
  };
  const limpiarNombre = (s) => {
    const t = (s || "").trim().split(/\s+/);
    for (let k = Math.floor(t.length / 2); k >= 1; k--) {
      const a = t.slice(0, k).join(" ").toLowerCase();
      const b = t.slice(k, 2 * k).join(" ").toLowerCase();
      if (a === b) return t.slice(k).join(" ");
    }
    return t.join(" ");
  };

  // ── Rutas con helper según snapshots (universo oficial de la vista) ──
  // Prioridad de momentos del día (de inicio a cierre). Por ruta se toma el
  // snapshot MÁS TARDÍO disponible: si hubo cierre se usa el cierre; si el flujo
  // de snapshots se cortó esa noche (p.ej. solo llegó a fin_tarde), cae al último
  // momento capturado en vez de dejar la vista en 0.
  const PRIORIDAD_MOMENTOS = ["inicio", "media_manana", "tarde", "fin_tarde", "pre_cierre", "cierre_dia", "post_cierre"];
  const rangoMomento = (md) => {
    const i = PRIORIDAD_MOMENTOS.indexOf(md);
    return i === -1 ? -1 : i;
  };
  const rutasSnapHelper = useMemo(() => {
    // Por ruta, quedarse con el snapshot del momento más tardío
    const ultimoPorRuta = {};
    for (const s of snapshots) {
      const k = String(s.id_ruta);
      const r = rangoMomento(s.momento_dia);
      if (r < 0) continue;
      if (!ultimoPorRuta[k] || r > ultimoPorRuta[k].rango) {
        ultimoPorRuta[k] = { rango: r, snap: s };
      }
    }
    const m = {};
    for (const [k, { snap: s }] of Object.entries(ultimoPorRuta)) {
      if (s.has_helper) {
        m[k] = { id_ruta: s.id_ruta, sc: s.service_center_id, driver_name: s.driver_name, placa: s.placa };
      }
    }
    return m;
  }, [snapshots]);

  // ── Entregados esperados por ruta (máximo entre snapshots = cierre) ──
  const entregadosEsperados = useMemo(() => {
    const m = {};
    for (const s of snapshots) {
      const k = String(s.id_ruta);
      const e = Number(s.entregados) || 0;
      if (!m[k] || e > m[k]) m[k] = e;
    }
    return m;
  }, [snapshots]);

  // ── Detalle de entregas por ruta: driver vs helpers con % ──
  const detalleEntregas = useMemo(() => {
    const rutas = {};
    for (const p of entregas) {
      const k = String(p.id_ruta);
      if (!rutas[k]) rutas[k] = { id_ruta: p.id_ruta, sc: p.service_center_id, driver_name: p.driver_name, total: 0, sinRegistro: 0, personas: {} };
      rutas[k].total++;
      if (p.user_id_real == null) { rutas[k].sinRegistro++; continue; }
      const uk = String(p.user_id_real);
      if (!rutas[k].personas[uk]) rutas[k].personas[uk] = { user_id: p.user_id_real, nombre: p.user_name_real, paquetes: 0 };
      rutas[k].personas[uk].paquetes++;
    }

    const filas = [];
    const rutasConDataEntregas = new Set(Object.keys(rutas));

    for (const r of Object.values(rutas)) {
      const personas = Object.values(r.personas);
      const driverRows = personas.filter(p => esMismaPersona(p.nombre, r.driver_name));
      const helperRows = personas.filter(p => !esMismaPersona(p.nombre, r.driver_name));
      const pct = (n) => r.total > 0 ? Math.round((n / r.total) * 1000) / 10 : 0;
      const driverPaq = driverRows.reduce((a, p) => a + p.paquetes, 0);
      const tieneSnapHelper = !!rutasSnapHelper[String(r.id_ruta)];

      // Universo oficial: solo rutas con helper flag al CIERRE (mismo criterio del scraper)
      if (!tieneSnapHelper) continue;

      // Cruce contra snapshot: entregados esperados vs capturados (cobertura)
      const esperado = entregadosEsperados[String(r.id_ruta)] || null;
      const cobertura = esperado ? Math.round((r.total / esperado) * 100) : null;
      let estadoFila = helperRows.length > 0 ? "OK" : "SOLO_DRIVER";
      if (esperado && cobertura !== null && cobertura < 95) estadoFila = "INCOMPLETO";

      filas.push({
        id_ruta: r.id_ruta,
        sc: r.sc,
        driver_name: r.driver_name,
        driver_paq: driverPaq,
        driver_pct: pct(driverPaq),
        helpers: helperRows.sort((a, b) => b.paquetes - a.paquetes).map(h => ({
          nombre: limpiarNombre(h.nombre), user_id: h.user_id, paquetes: h.paquetes, pct: pct(h.paquetes),
        })),
        total: r.total,
        esperado,
        cobertura,
        sinRegistro: r.sinRegistro,
        estado: estadoFila,
      });
    }

    // Rutas que el snapshot marca con helper pero SIN data de entregas → gap del flujo
    for (const [k, s] of Object.entries(rutasSnapHelper)) {
      if (!rutasConDataEntregas.has(k)) {
        filas.push({
          id_ruta: s.id_ruta, sc: s.sc, driver_name: s.driver_name,
          driver_paq: null, driver_pct: null, helpers: [], total: 0,
          esperado: entregadosEsperados[k] || null, cobertura: 0, sinRegistro: 0,
          estado: "SIN_DETALLE",
        });
      }
    }

    return filas
      .filter(f => {
        if (!busqueda) return true;
        const q = busqueda.toLowerCase();
        return (
          (f.driver_name || "").toLowerCase().includes(q) ||
          (f.sc || "").toLowerCase().includes(q) ||
          String(f.id_ruta).includes(busqueda) ||
          f.helpers.some(h => (h.nombre || "").toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const ord = { SIN_DETALLE: 0, INCOMPLETO: 1, SOLO_DRIVER: 2, OK: 3 };
        if (ord[a.estado] !== ord[b.estado]) return ord[a.estado] - ord[b.estado];
        if ((a.sc || "") !== (b.sc || "")) return (a.sc || "").localeCompare(b.sc || "");
        return a.id_ruta - b.id_ruta;
      });
  }, [entregas, rutasSnapHelper, entregadosEsperados, busqueda]);

  // ── Salud del flujo ──
  const salud = useMemo(() => {
    const conHelperSnap = Object.keys(rutasSnapHelper).length;
    const sinDetalle = detalleEntregas.filter(f => f.estado === "SIN_DETALLE").length;
    const incompletas = detalleEntregas.filter(f => f.estado === "INCOMPLETO").length;
    const soloDriver = detalleEntregas.filter(f => f.estado === "SOLO_DRIVER").length;
    if (entregas.length === 0) return {
      nivel: "error", color: "#dc2626", bg: "#fef2f2", borde: "#fecaca",
      titulo: "❌ Flujo de entregas NO ejecutado o fallido",
      detalle: `No hay paquetes entregados cargados para ${fecha}. ${conHelperSnap} ruta(s) con helper según snapshots quedan sin detalle. Ejecuta el flujo con el botón.`,
    };
    if (sinDetalle > 0 || incompletas > 0) return {
      nivel: "warn", color: "#b45309", bg: "#fffbeb", borde: "#fde68a",
      titulo: `⚠️ Flujo incompleto: ${sinDetalle} ruta(s) sin detalle · ${incompletas} con captura parcial`,
      detalle: `Se cargaron ${entregas.length.toLocaleString("es-MX")} paquetes. ${sinDetalle} ruta(s) con helper no tienen entregas registradas y ${incompletas} tienen menos paquetes capturados que los entregados según el snapshot de cierre (cobertura <95%)${soloDriver > 0 ? `; ${soloDriver} solo muestran entregas del driver` : ""}. Los % de esas rutas NO son confiables — re-ejecuta el flujo del día.`,
    };
    return {
      nivel: "ok", color: "#166534", bg: "#f0fdf4", borde: "#86efac",
      titulo: "✅ Flujo de entregas completo",
      detalle: `${entregas.length.toLocaleString("es-MX")} paquetes cargados · ${detalleEntregas.length} ruta(s) con helper, todas con cobertura ≥95% contra el snapshot de cierre${soloDriver > 0 ? ` · ${soloDriver} con entregas solo del driver (revisar)` : ""}.`,
    };
  }, [entregas, detalleEntregas, rutasSnapHelper, fecha]);

  // ── Disparar flujo n8n: SELECTIVO (solo incompletas) o día completo ──
  const ejecutarFlujo = async () => {
    if (N8N_WEBHOOK_RERUN_HELPERS.includes("REEMPLAZAR")) {
      setMsgFlujo("❌ Falta configurar la URL del webhook n8n (constante N8N_WEBHOOK_RERUN_HELPERS).");
      return;
    }
    // Rutas a reparar: las marcadas INCOMPLETO o SIN_DETALLE en esta vista
    const rutasReparar = detalleEntregas
      .filter(f => f.estado === "INCOMPLETO" || f.estado === "SIN_DETALLE")
      .map(f => f.id_ruta);
    const esSelectivo = rutasReparar.length > 0;
    const minutos = esSelectivo ? Math.max(5, Math.round(rutasReparar.length * 2)) : null;

    const confirmacion = esSelectivo
      ? `¿Reparar ${rutasReparar.length} ruta(s) incompleta(s) del ${fecha}?\n\nEl barrido recorrerá SOLO esas rutas (~${minutos} min). Requiere sesión MELI vigente (extensión Don B Sync).`
      : `No hay rutas incompletas para ${fecha} — todo está al 100%.\n\n¿Ejecutar igualmente el barrido del día COMPLETO? (~45–90 min)`;
    if (!window.confirm(confirmacion)) return;

    setDisparando(true);
    setMsgFlujo("");
    try {
      const payload = esSelectivo ? { fecha, id_rutas: rutasReparar } : { fecha };
      const r = await fetch(N8N_WEBHOOK_RERUN_HELPERS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMsgFlujo(esSelectivo
        ? `✅ Reparación disparada ${new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })} hrs · ${rutasReparar.length} ruta(s) del ${fecha} (~${minutos} min). Vuelve más tarde y presiona ↻ Refrescar.`
        : `✅ Barrido del día completo disparado ${new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })} hrs para ${fecha} (~45–90 min). Vuelve más tarde y presiona ↻ Refrescar.`);
    } catch (e) {
      setMsgFlujo(`❌ No se pudo disparar el flujo: ${e.message}. Revisa que el workflow webhook esté activo en n8n y que la sesión MELI esté vigente.`);
    }
    setDisparando(false);
  };

  // ════════ Lo siguiente alimenta la vista MATRIZ (snapshots, lógica original) ════════
  const horasMomentos = useMemo(() => {
    const m = {};
    for (const s of snapshots) {
      if (!m[s.momento_dia]) m[s.momento_dia] = s.hora_snapshot;
    }
    return m;
  }, [snapshots]);

  const consolidados = useMemo(() => {
    const m = {};
    for (const s of snapshots) {
      const k = String(s.id_ruta);
      if (!m[k]) m[k] = {
        id_ruta: s.id_ruta,
        cluster: s.cluster,
        service_center_id: s.service_center_id,
        driver_id: s.driver_id,
        driver_name: s.driver_name,
        vehiculo_descripcion: s.vehiculo_descripcion,
        placa: s.placa,
        is_assignable: s.is_assignable,
        snapshots: { inicio: null, media_manana: null, tarde: null, fin_tarde: null, pre_cierre: null },
        snapshots_horas: {},
        snapshots_con_helper: 0,
        total_snapshots: 0,
      };
      m[k].snapshots[s.momento_dia] = s.has_helper;
      m[k].snapshots_horas[s.momento_dia] = s.hora_snapshot;
      m[k].total_snapshots++;
      if (s.has_helper) m[k].snapshots_con_helper++;
      if (s.is_assignable) m[k].is_assignable = true;
    }
    return Object.values(m)
      .filter(c => {
        if (filtroAsignable === "asignables" && !c.is_assignable) return false;
        if (filtroAsignable === "no_asignables" && c.is_assignable) return false;
        if (!busqueda) return true;
        return (
          (c.driver_name || "").toLowerCase().includes(busqueda.toLowerCase()) ||
          (c.placa || "").toLowerCase().includes(busqueda.toLowerCase()) ||
          (c.service_center_id || "").toLowerCase().includes(busqueda.toLowerCase()) ||
          String(c.id_ruta).includes(busqueda)
        );
      })
      .sort((a, b) => {
        if (a.service_center_id !== b.service_center_id) return a.service_center_id.localeCompare(b.service_center_id);
        return (a.cluster || "").localeCompare(b.cluster || "");
      });
  }, [snapshots, busqueda, filtroAsignable]);

  const todasRutas = useMemo(() => {
    const m = {};
    for (const s of snapshots) {
      const k = String(s.id_ruta);
      if (!m[k]) m[k] = { is_assignable: false };
      if (s.is_assignable) m[k].is_assignable = true;
    }
    return Object.values(m);
  }, [snapshots]);

  const conteoAsignables = todasRutas.filter(r => r.is_assignable).length;
  const conteoNoAsignables = todasRutas.filter(r => !r.is_assignable).length;
  const totalConHelper = consolidados.filter(c => c.snapshots_con_helper >= 3).length;
  const totalSospechosos = consolidados.filter(c => c.snapshots_con_helper >= 1 && c.snapshots_con_helper < 3).length;

  const formatHora = (h) => {
    if (!h) return "—";
    try {
      return new Date(h).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });
    } catch { return "—"; }
  };

  const formatHoraMx = (h) => {
    if (!h) return "—";
    try {
      return new Date(h).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
    } catch { return "—"; }
  };

  const renderTicket = (h, hora) => {
    if (h === true) return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span style={{ color: "#16a34a", fontSize: 16, fontWeight: 700 }}>✓</span>
        {hora && <span style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{formatHora(hora)}</span>}
      </div>
    );
    if (h === false) return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span style={{ color: "#cbd5e1", fontSize: 14 }}>—</span>
        {hora && <span style={{ fontSize: 9, color: "#cbd5e1", marginTop: 2 }}>{formatHora(hora)}</span>}
      </div>
    );
    return <span style={{ color: "#e2e8f0", fontSize: 14 }}>·</span>;
  };

  // ── Excel: vista entregas ──
  const descargarExcelEntregas = () => {
    if (detalleEntregas.length === 0) return;
    const headers = ["Fecha", "SC", "ID Ruta", "Chofer", "% Entrega Chofer", "Paq. Chofer", "Ayudante(s)", "% Entrega Ayudante(s)", "Paq. Ayudante(s)", "Paq. Capturados", "Paq. Esperados (snapshot)", "Cobertura %", "Sin Registro", "Estado"];
    const data = detalleEntregas.map(f => [
      fecha, f.sc, f.id_ruta, f.driver_name || "",
      f.driver_pct == null ? "—" : `${f.driver_pct}%`,
      f.driver_paq == null ? "—" : f.driver_paq,
      f.helpers.map(h => h.nombre).join(" // ") || "—",
      f.helpers.map(h => `${h.pct}%`).join(" // ") || "—",
      f.helpers.map(h => h.paquetes).join(" // ") || "—",
      f.total, f.esperado ?? "—", f.cobertura != null ? `${f.cobertura}%` : "—", f.sinRegistro,
      f.estado === "OK" ? "OK" : f.estado === "INCOMPLETO" ? `Incompleto (${f.cobertura}%)` : f.estado === "SOLO_DRIVER" ? "Solo driver" : "Sin detalle",
    ]);
    const ws = window.XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = [10, 8, 12, 26, 14, 10, 40, 18, 14, 12, 14, 11, 10, 16].map(w => ({ wch: w }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Entregas Helper");
    window.XLSX.writeFile(wb, `Ayudantes_Entregas_MX_${fecha}.xlsx`);
  };

  // ── Excel: vista matriz (original) ──
  const descargarExcel = () => {
    if (consolidados.length === 0) return;

    const headers = [
      "Fecha", "Service Center", "Cluster", "ID Ruta", "Driver ID", "Driver",
      "Placa", "Vehículo",
      "Inicio (✓/—)", "Hora Inicio (Chile)", "Hora Inicio (México)",
      "Media Mañana", "Hora MM (Chile)", "Hora MM (México)",
      "Tarde", "Hora Tarde (Chile)", "Hora Tarde (México)",
      "Fin Tarde", "Hora FT (Chile)", "Hora FT (México)",
      "Pre Cierre", "Hora PC (Chile)", "Hora PC (México)",
      "Total Snapshots", "Snapshots con Helper", "Estado", "Pago Auxiliar"
    ];

    const formatHelper = (h) => h === true ? "Sí" : h === false ? "No" : "—";

    const data = consolidados.map(c => {
      const estado = c.snapshots_con_helper >= 3 ? "OK" : c.snapshots_con_helper >= 1 ? "SOSPECHOSO" : "SIN_HELPER";
      const pago = estado === "OK" ? 300 : 0;
      return [
        fecha,
        c.service_center_id,
        c.cluster || "",
        c.id_ruta,
        c.driver_id || "",
        c.driver_name || "",
        c.placa || "",
        c.vehiculo_descripcion || "",
        formatHelper(c.snapshots.inicio), formatHora(c.snapshots_horas.inicio), formatHoraMx(c.snapshots_horas.inicio),
        formatHelper(c.snapshots.media_manana), formatHora(c.snapshots_horas.media_manana), formatHoraMx(c.snapshots_horas.media_manana),
        formatHelper(c.snapshots.tarde), formatHora(c.snapshots_horas.tarde), formatHoraMx(c.snapshots_horas.tarde),
        formatHelper(c.snapshots.fin_tarde), formatHora(c.snapshots_horas.fin_tarde), formatHoraMx(c.snapshots_horas.fin_tarde),
        formatHelper(c.snapshots.pre_cierre), formatHora(c.snapshots_horas.pre_cierre), formatHoraMx(c.snapshots_horas.pre_cierre),
        c.total_snapshots,
        c.snapshots_con_helper,
        estado,
        pago,
      ];
    });

    const ws = window.XLSX.utils.aoa_to_sheet([headers, ...data]);
    const widths = [10, 14, 10, 12, 12, 24, 14, 18, 12, 12, 12, 14, 12, 12, 10, 12, 12, 12, 12, 12, 12, 12, 12, 10, 14, 14, 12];
    ws["!cols"] = widths.map(w => ({ wch: w }));

    const resumen = [
      ["RESUMEN AYUDANTES MX"],
      [""],
      ["Fecha", fecha],
      ["Total rutas detectadas", consolidados.length],
      ["Confirmadas (≥3 snapshots con helper)", totalConHelper],
      ["Sospechosas (1-2 snapshots con helper)", totalSospechosos],
      ["Sin helper", consolidados.length - totalConHelper - totalSospechosos],
      [""],
      ["MONTO A PAGAR (sólo confirmadas)", `$${(totalConHelper * 300).toLocaleString("es-MX")} MXN`],
      [""],
      ["Snapshots ejecutados:"],
      ["  Inicio", formatHora(horasMomentos.inicio) + " Chile / " + formatHoraMx(horasMomentos.inicio) + " MX"],
      ["  Media Mañana", formatHora(horasMomentos.media_manana) + " Chile / " + formatHoraMx(horasMomentos.media_manana) + " MX"],
      ["  Tarde", formatHora(horasMomentos.tarde) + " Chile / " + formatHoraMx(horasMomentos.tarde) + " MX"],
      ["  Fin Tarde", formatHora(horasMomentos.fin_tarde) + " Chile / " + formatHoraMx(horasMomentos.fin_tarde) + " MX"],
      ["  Pre Cierre", formatHora(horasMomentos.pre_cierre) + " Chile / " + formatHoraMx(horasMomentos.pre_cierre) + " MX"],
    ];
    const wsResumen = window.XLSX.utils.aoa_to_sheet(resumen);
    wsResumen["!cols"] = [{ wch: 40 }, { wch: 30 }];

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");
    window.XLSX.utils.book_append_sheet(wb, ws, "Detalle");
    window.XLSX.writeFile(wb, `Ayudantes_MX_${fecha}.xlsx`);
  };

  const pctBadge = (pct) => {
    if (pct == null) return <span style={{ color: "#94a3b8" }}>—</span>;
    const color = pct >= 50 ? "#16a34a" : pct >= 20 ? "#1a3a6b" : "#64748b";
    return <span style={{ fontWeight: 700, color }}>{pct}%</span>;
  };

  return (
    <div className="pg" style={{ maxWidth: 1400 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">Ayudantes — Entregas del Día</div>
          <div className="sec-sub">Rutas con helper al cierre: driver vs ayudante(s) con su % de entrega, validado contra el snapshot</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 6, padding: 2 }}>
            <button onClick={() => setVista("entregas")}
              style={{ padding: "6px 12px", borderRadius: 4, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: vista === "entregas" ? "#1a3a6b" : "transparent", color: vista === "entregas" ? "#fff" : "#475569" }}>
              Entregas
            </button>
            <button onClick={() => setVista("matriz")}
              style={{ padding: "6px 12px", borderRadius: 4, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: vista === "matriz" ? "#1a3a6b" : "transparent", color: vista === "matriz" ? "#fff" : "#475569" }}>
              Matriz snapshots
            </button>
          </div>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: 4, padding: "7px 10px", fontSize: 12 }} />
          <button onClick={cargar} title="Refrescar datos"
            style={{ padding: "8px 12px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer" }}>
            ↻ Refrescar
          </button>
          <button onClick={vista === "entregas" ? descargarExcelEntregas : descargarExcel}
            disabled={vista === "entregas" ? detalleEntregas.length === 0 : consolidados.length === 0}
            style={{ padding: "8px 14px", background: "#16a34a", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "#fff",
              cursor: (vista === "entregas" ? detalleEntregas.length === 0 : consolidados.length === 0) ? "not-allowed" : "pointer",
              opacity: (vista === "entregas" ? detalleEntregas.length === 0 : consolidados.length === 0) ? 0.5 : 1 }}>
            Descargar Excel
          </button>
        </div>
      </div>

      {/* ── Salud del flujo + botón de ejecución ── */}
      <div style={{ background: salud.bg, border: `1px solid ${salud.borde}`, borderRadius: 6, padding: "12px 14px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: salud.color }}>{salud.titulo}</div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>{salud.detalle}</div>
          </div>
          <button onClick={ejecutarFlujo} disabled={disparando}
            style={{ padding: "9px 16px", background: disparando ? "#94a3b8" : "#F47B20", border: "none", borderRadius: 6,
              fontSize: 12, fontWeight: 700, color: "#fff", cursor: disparando ? "wait" : "pointer", whiteSpace: "nowrap" }}>
            {disparando ? "Disparando..." : (detalleEntregas.some(f => f.estado === "INCOMPLETO" || f.estado === "SIN_DETALLE")
              ? `▶ Reparar ${detalleEntregas.filter(f => f.estado === "INCOMPLETO" || f.estado === "SIN_DETALLE").length} incompletas del ${fecha}`
              : `▶ Ejecutar flujo del ${fecha}`)}
          </button>
        </div>
        {msgFlujo && (
          <div style={{ marginTop: 10, padding: "8px 10px", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, fontSize: 12, color: "#1f2937" }}>
            {msgFlujo}
          </div>
        )}
      </div>

      {vista === "entregas" && (
        <>
          {/* KPIs vista entregas */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #1a3a6b", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Rutas con helper</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{detalleEntregas.length}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #16a34a", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Con detalle OK</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>{detalleEntregas.filter(f => f.estado === "OK").length}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #b45309", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Captura incompleta</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#b45309", marginTop: 2 }}>{detalleEntregas.filter(f => f.estado === "INCOMPLETO").length}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>cobertura &lt;95% vs snapshot</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #F47B20", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Solo driver</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#F47B20", marginTop: 2 }}>{detalleEntregas.filter(f => f.estado === "SOLO_DRIVER").length}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>helper en snapshot, sin entregas</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #dc2626", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Sin detalle</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#dc2626", marginTop: 2 }}>{detalleEntregas.filter(f => f.estado === "SIN_DETALLE").length}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>gap del flujo · re-ejecutar</div>
            </div>
          </div>

          <input type="text" placeholder="Buscar por driver, ayudante, SC o ID ruta..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
            style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: "7px 10px", fontSize: 12, width: "100%", marginBottom: 14, boxSizing: "border-box" }} />

          {/* Tabla entregas */}
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto" }}>
            {loading ? (
              <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Cargando...</div>
            ) : detalleEntregas.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                Sin rutas con helper para esta fecha (o el flujo de entregas no ha corrido).
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>Fecha</th>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>SC</th>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>ID Ruta</th>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>Chofer</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#475569" }}>% Entrega</th>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>Ayudante(s)</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#475569" }}>% Entrega</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#475569" }}>Total Paq.</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#475569" }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {detalleEntregas.map((f, i) => {
                    const estiloEstado = f.estado === "OK"
                      ? { bg: "#dcfce7", color: "#16a34a", txt: "OK" }
                      : f.estado === "INCOMPLETO"
                        ? { bg: "#fef3c7", color: "#b45309", txt: `INCOMPLETO ${f.cobertura}%` }
                        : f.estado === "SOLO_DRIVER"
                          ? { bg: "#fed7aa", color: "#b45309", txt: "SOLO DRIVER" }
                          : { bg: "#fee2e2", color: "#dc2626", txt: "SIN DETALLE" };
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #f0f0f0", background: f.estado === "SIN_DETALLE" ? "#fef2f2" : f.estado === "INCOMPLETO" ? "#fffbeb" : "transparent" }}>
                        <td style={{ padding: "8px", color: "#64748b", fontSize: 11 }}>{fecha}</td>
                        <td style={{ padding: "8px", fontWeight: 500 }}>{f.sc || "—"}</td>
                        <td style={{ padding: "8px", fontFamily: "monospace", color: "#64748b", fontSize: 11 }}>{f.id_ruta}</td>
                        <td style={{ padding: "8px", fontWeight: 500 }}>{f.driver_name || "—"}</td>
                        <td style={{ padding: "8px", textAlign: "center" }}>
                          {pctBadge(f.driver_pct)}
                          {f.driver_paq != null && <div style={{ fontSize: 9, color: "#94a3b8" }}>{f.driver_paq} paq.</div>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {f.helpers.length > 0
                            ? f.helpers.map(h => h.nombre).join(" // ")
                            : <span style={{ color: "#94a3b8", fontSize: 11 }}>{f.estado === "SIN_DETALLE" ? "Sin datos de entrega" : "—"}</span>}
                        </td>
                        <td style={{ padding: "8px", textAlign: "center" }}>
                          {f.helpers.length > 0 ? (
                            <>
                              <span>{f.helpers.map((h, j) => (
                                <span key={j}>{j > 0 && <span style={{ color: "#cbd5e1" }}> // </span>}{pctBadge(h.pct)}</span>
                              ))}</span>
                              <div style={{ fontSize: 9, color: "#94a3b8" }}>{f.helpers.map(h => `${h.paquetes} paq.`).join(" // ")}</div>
                            </>
                          ) : <span style={{ color: "#94a3b8" }}>—</span>}
                        </td>
                        <td style={{ padding: "8px", textAlign: "center", color: "#475569" }}>
                          <span style={{ fontWeight: f.estado === "INCOMPLETO" ? 700 : 400, color: f.estado === "INCOMPLETO" ? "#b45309" : "#475569" }}>
                            {f.total > 0 ? f.total : "—"}{f.esperado ? ` / ${f.esperado}` : ""}
                          </span>
                          {f.esperado && f.cobertura !== null && (
                            <div style={{ fontSize: 9, color: f.cobertura >= 95 ? "#16a34a" : "#b45309" }}>cobertura {f.cobertura}%</div>
                          )}
                          {f.sinRegistro > 0 && <div style={{ fontSize: 9, color: "#b45309" }}>{f.sinRegistro} sin registro</div>}
                        </td>
                        <td style={{ padding: "8px", textAlign: "center" }}>
                          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: estiloEstado.bg, color: estiloEstado.color, fontWeight: 600 }}>
                            {estiloEstado.txt}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {vista === "matriz" && (
        <>
          {/* Resumen de horas de los snapshots */}
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Snapshots del día (zona México)</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                  Se ejecutan automáticamente 5 veces al día. Horario operativo: México.
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#475569" }}>
                <strong>{Object.keys(horasMomentos).length}/5</strong> ejecutados
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              {[
                { id: "inicio",       l: "Inicio",       e: "07:00 MX · 09:00 CL" },
                { id: "media_manana", l: "Media mañana", e: "11:00 MX · 13:00 CL" },
                { id: "tarde",        l: "Tarde",        e: "15:00 MX · 17:00 CL" },
                { id: "fin_tarde",    l: "Fin tarde",    e: "19:00 MX · 21:00 CL" },
                { id: "pre_cierre",   l: "Pre cierre",   e: "23:00 MX · 01:00 CL+1" },
              ].map(m => {
                const hora = horasMomentos[m.id];
                const ejecutado = !!hora;
                return (
                  <div key={m.id} style={{
                    padding: "8px 10px",
                    borderRadius: 4,
                    background: ejecutado ? "#f0fdf4" : "#f8fafc",
                    border: `1px solid ${ejecutado ? "#86efac" : "#e4e7ec"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: ejecutado ? "#16a34a" : "#cbd5e1" }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: ejecutado ? "#166534" : "#475569" }}>{m.l}</span>
                    </div>
                    {ejecutado ? (
                      <div style={{ fontSize: 11, color: "#1f2937", paddingLeft: 14 }}>
                        <div><strong>{formatHora(hora)}</strong> Chile · {formatHoraMx(hora)} MX</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "#94a3b8", paddingLeft: 14 }}>
                        Programado: {m.e}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #1a3a6b", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Total rutas</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{consolidados.length}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #16a34a", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Confirmados</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>{totalConHelper}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>≥3 snapshots con helper</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #F47B20", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Sospechosos</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#F47B20", marginTop: 2 }}>{totalSospechosos}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>1-2 snapshots</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #16a34a", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Pago auxiliares</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>${(totalConHelper * 300).toLocaleString("es-MX")}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>$300 × {totalConHelper} rutas</div>
            </div>
          </div>

          {/* Filtros */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setFiltroAsignable("asignables")}
                style={{ padding: "7px 14px", borderRadius: 4, border: `1px solid ${filtroAsignable === "asignables" ? "#1a3a6b" : "#e4e7ec"}`,
                  background: filtroAsignable === "asignables" ? "#1a3a6b" : "#fff",
                  color: filtroAsignable === "asignables" ? "#fff" : "#475569",
                  fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Asignadas ({conteoAsignables})
              </button>
              <button onClick={() => setFiltroAsignable("no_asignables")}
                style={{ padding: "7px 14px", borderRadius: 4, border: `1px solid ${filtroAsignable === "no_asignables" ? "#1a3a6b" : "#e4e7ec"}`,
                  background: filtroAsignable === "no_asignables" ? "#1a3a6b" : "#fff",
                  color: filtroAsignable === "no_asignables" ? "#fff" : "#475569",
                  fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Sin asignar ({conteoNoAsignables})
              </button>
              <button onClick={() => setFiltroAsignable("todas")}
                style={{ padding: "7px 14px", borderRadius: 4, border: `1px solid ${filtroAsignable === "todas" ? "#1a3a6b" : "#e4e7ec"}`,
                  background: filtroAsignable === "todas" ? "#1a3a6b" : "#fff",
                  color: filtroAsignable === "todas" ? "#fff" : "#475569",
                  fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Todas ({conteoAsignables + conteoNoAsignables})
              </button>
            </div>
            <input type="text" placeholder="Buscar por driver, placa, SC o ID ruta..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
              style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: "7px 10px", fontSize: 12, flex: 1, minWidth: 240 }} />
          </div>

          {/* Tabla */}
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto" }}>
            {loading ? (
              <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Cargando...</div>
            ) : consolidados.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                Sin datos para esta fecha. Los snapshots se capturan automáticamente 5 veces al día.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>SC</th>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>Cluster</th>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>ID Ruta</th>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>Placa</th>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>Driver</th>
                    <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#475569" }}>Vehículo</th>
                    {[
                      { id: "inicio", l: "Inicio" },
                      { id: "media_manana", l: "Media mañana" },
                      { id: "tarde", l: "Tarde" },
                      { id: "fin_tarde", l: "Fin tarde" },
                      { id: "pre_cierre", l: "Pre cierre" },
                    ].map(m => (
                      <th key={m.id} style={{ padding: "10px 4px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#475569", minWidth: 90 }}>
                        <div>{m.l}</div>
                        {horasMomentos[m.id] ? (
                          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 400, marginTop: 2, lineHeight: 1.3 }}>
                            <div>{formatHora(horasMomentos[m.id])} CL</div>
                            <div>{formatHoraMx(horasMomentos[m.id])} MX</div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 9, color: "#cbd5e1", fontWeight: 400, marginTop: 2 }}>—</div>
                        )}
                      </th>
                    ))}
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#475569" }}>Estado</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#475569" }}>Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidados.map((c, i) => {
                    const estado = c.snapshots_con_helper >= 3 ? "OK" : c.snapshots_con_helper >= 1 ? "SOSPECHOSO" : "SIN_HELPER";
                    const colorEstado = estado === "OK" ? "#16a34a" : estado === "SOSPECHOSO" ? "#F47B20" : "#94a3b8";
                    const bgEstado = estado === "OK" ? "#dcfce7" : estado === "SOSPECHOSO" ? "#fed7aa" : "#f1f5f9";
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "8px", fontWeight: 500 }}>{c.service_center_id}</td>
                        <td style={{ padding: "8px" }}>{c.cluster}</td>
                        <td style={{ padding: "8px", fontFamily: "monospace", color: "#64748b", fontSize: 11 }}>{c.id_ruta}</td>
                        <td style={{ padding: "8px", fontSize: 11 }}>{c.placa || "—"}</td>
                        <td style={{ padding: "8px", fontWeight: 500 }}>{c.driver_name || "—"}</td>
                        <td style={{ padding: "8px", color: "#64748b", fontSize: 11 }}>{c.vehiculo_descripcion}</td>
                        <td style={{ padding: "8px 4px", textAlign: "center" }}>{renderTicket(c.snapshots.inicio, c.snapshots_horas.inicio)}</td>
                        <td style={{ padding: "8px 4px", textAlign: "center" }}>{renderTicket(c.snapshots.media_manana, c.snapshots_horas.media_manana)}</td>
                        <td style={{ padding: "8px 4px", textAlign: "center" }}>{renderTicket(c.snapshots.tarde, c.snapshots_horas.tarde)}</td>
                        <td style={{ padding: "8px 4px", textAlign: "center" }}>{renderTicket(c.snapshots.fin_tarde, c.snapshots_horas.fin_tarde)}</td>
                        <td style={{ padding: "8px 4px", textAlign: "center" }}>{renderTicket(c.snapshots.pre_cierre, c.snapshots_horas.pre_cierre)}</td>
                        <td style={{ padding: "8px", textAlign: "center" }}>
                          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: bgEstado, color: colorEstado, fontWeight: 600 }}>
                            {estado}
                          </span>
                        </td>
                        <td style={{ padding: "8px", textAlign: "right", fontWeight: 600, color: estado === "OK" ? "#16a34a" : "#94a3b8" }}>
                          {estado === "OK" ? "$300" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PagosPausados({ usuario }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [incluirLiberados, setIncluirLiberados] = useState(false);
  const fmtMon = (v) => "$ " + Math.round(Number(v || 0)).toLocaleString("es-CL");
  const fmtDT = (s) => { if (!s) return "\u2014"; try { return new Date(s).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (e) { return String(s).slice(0, 16); } };
  const cargar = async () => {
    setLoading(true);
    try {
      let q = sb.from("maestro_jornada_mx").select("id, fecha, driver_name, placa, id_ruta, service_center_id, pago_neto, pausado, pausa_motivo, pausa_por, pausa_at, liberado_at, liberado_por").order("fecha", { ascending: false }).order("driver_name").limit(8000);
      q = incluirLiberados ? q.or("pausado.eq.true,liberado_at.not.is.null") : q.eq("pausado", true);
      const { data } = await q;
      setRows(data || []);
    } catch (e) { console.error("pagos pausados:", e); setRows([]); }
    setLoading(false);
  };
  useEffect(() => { cargar(); }, [incluirLiberados]);
  const activar = async (r) => {
    if (!confirm(`\u00bfActivar (liberar) el pago de ${r.driver_name || r.placa} \u00b7 ruta ${r.id_ruta} del ${r.fecha}?`)) return;
    try {
      const por = (usuario && (usuario.nombre || usuario.email)) || "Brain";
      const { error } = await sb.from("maestro_jornada_mx").update({ pausado: false, liberado_at: new Date().toISOString(), liberado_por: por }).eq("id", r.id);
      if (error) throw error;
      cargar();
    } catch (e) { alert("Error activando: " + (e.message || e)); }
  };
  const porDia = {}; for (const r of rows) (porDia[r.fecha] = porDia[r.fecha] || []).push(r);
  const dias = Object.keys(porDia).sort().reverse();
  const pausCount = rows.filter(r => r.pausado).length;
  const th = { textAlign: "left", padding: "6px 8px", fontSize: 10, color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #e4e7ec" };
  const td = { padding: "6px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 12 };
  return (
    <div className="pg" style={{ maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div>
          <div className="sec-title">Pagos pausados</div>
          <div className="sec-sub">Rutas con el pago retenido por el analista · por día · con su motivo. Desde aquí se pueden activar (liberar).</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "#475569", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={incluirLiberados} onChange={e => setIncluirLiberados(e.target.checked)} /> incluir liberados
          </label>
          <button onClick={cargar} style={{ padding: "7px 14px", border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↻ Actualizar</button>
          <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 6, padding: "8px 14px" }}>
            <div style={{ fontSize: 10, color: "#9a3412", fontWeight: 700, textTransform: "uppercase" }}>Pausados</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#9a3412" }}>{pausCount}</div>
          </div>
        </div>
      </div>
      {loading ? <div style={{ color: "#94a3b8", padding: 20 }}>Cargando…</div> : dias.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", border: "1px solid #e4e7ec", borderRadius: 8, background: "#fff" }}>No hay pagos pausados.</div>
      ) : dias.map(dia => (
        <div key={dia} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#1a3a6b", marginBottom: 6 }}>{dia} · {porDia[dia].length} ruta(s)</div>
          <div style={{ border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Chofer", "Patente", "SC", "Ruta", "Pago neto", "Motivo", "Pausado por", "Cuando", "Estado", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{porDia[dia].map(r => (
                <tr key={r.id} style={{ background: r.pausado ? "#fffbeb" : "#f0fdf4" }}>
                  <td style={td}>{r.driver_name || "\u2014"}</td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{r.placa || "\u2014"}</td>
                  <td style={td}>{r.service_center_id || "\u2014"}</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: 10 }}>{r.id_ruta || "\u2014"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmtMon(r.pago_neto)}</td>
                  <td style={{ ...td, maxWidth: 280, whiteSpace: "normal", color: "#92400e" }}>{r.pausa_motivo || "\u2014"}</td>
                  <td style={td}>{r.pausa_por || "\u2014"}</td>
                  <td style={{ ...td, fontSize: 10, color: "#64748b" }}>{fmtDT(r.pausa_at)}</td>
                  <td style={td}>{r.pausado ? <span style={{ fontSize: 10, fontWeight: 800, color: "#92400e", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, padding: "2px 6px" }}>⏸ Pausado</span> : <span style={{ fontSize: 10, fontWeight: 800, color: "#166534", background: "#dcfce7", borderRadius: 6, padding: "2px 6px" }}>✓ Liberado</span>}</td>
                  <td style={td}>{r.pausado && <button onClick={() => activar(r)} style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#166534", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Activar pago</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfigAlertas() {
  const CAMPOS = [
    { v: "observaciones", l: "Observaciones (texto)" },
    { v: "ns_pct", l: "NS %" },
    { v: "pct_visitado_real", l: "Visitado %" },
    { v: "ruta_no_operada", l: "Ruta no operada (s\u00ed/no)" },
    { v: "empresa_asignada", l: "Empresa asignada" },
    { v: "tarifa_base", l: "Tarifa base" },
    { v: "pago_meli", l: "Pago MELI" },
    { v: "ns_categoria", l: "Categor\u00eda NS" },
  ];
  const OPERADORES = [
    { v: "menor", l: "menor que (<)" }, { v: "mayor", l: "mayor que (>)" },
    { v: "igual", l: "igual a (=)" }, { v: "distinto", l: "distinto de" },
    { v: "vacio", l: "vac\u00edo / sin valor" }, { v: "no_vacio", l: "tiene valor" },
    { v: "verdadero", l: "es s\u00ed / verdadero" }, { v: "falso", l: "es no / falso" },
  ];
  const necesitaValor = (op) => ["menor", "mayor", "igual", "distinto"].includes(op);
  const [reglas, setReglas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(null);
  const cargar = async () => { setLoading(true); try { const { data } = await sb.from("config_alertas_pago").select("*").order("orden"); setReglas(data || []); } catch (e) { console.error(e); } setLoading(false); };
  useEffect(() => { cargar(); }, []);
  const setCampo = (i, k, v) => setReglas(rs => rs.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const agregar = () => setReglas(rs => [...rs, { nombre: "", campo: "ns_pct", operador: "menor", valor: "", color: "#f59e0b", activa: true, orden: rs.length + 1 }]);
  const guardar = async (i) => {
    const r = reglas[i]; if (!r.nombre || !r.nombre.trim()) return alert("Pon\u00e9 un nombre a la regla.");
    setGuardando(i);
    try {
      const payload = { nombre: r.nombre.trim(), campo: r.campo, operador: r.operador, valor: necesitaValor(r.operador) ? (r.valor || null) : null, color: r.color || "#f59e0b", activa: !!r.activa, orden: Number(r.orden || 0) };
      if (r.id) await sb.from("config_alertas_pago").update(payload).eq("id", r.id);
      else await sb.from("config_alertas_pago").insert(payload);
      await cargar();
    } catch (e) { alert("Error guardando: " + (e.message || e)); }
    setGuardando(null);
  };
  const eliminar = async (i) => {
    const r = reglas[i];
    if (r.id) { if (!confirm(`\u00bfEliminar la regla "${r.nombre}"?`)) return; try { await sb.from("config_alertas_pago").delete().eq("id", r.id); } catch (e) { alert("Error: " + (e.message || e)); return; } }
    setReglas(rs => rs.filter((_, idx) => idx !== i));
    if (r.id) await cargar();
  };
  const inp = { padding: "5px 8px", border: "1px solid #e4e7ec", borderRadius: 6, fontSize: 12, width: "100%" };
  const th = { textAlign: "left", padding: "8px", fontSize: 10, color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #e4e7ec" };
  const td = { padding: "6px 8px", borderBottom: "1px solid #f1f5f9", verticalAlign: "middle" };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12, color: "#64748b", maxWidth: 720 }}>Reglas que marcan una línea del Listado de Pagos como <b>alerta</b>. El analista las usa para revisar y (próximamente) pausar pagos. Una línea con alerta es la que cumple <b>cualquiera</b> de las reglas activas.</div>
        <button onClick={agregar} style={{ padding: "7px 14px", background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>+ Agregar regla</button>
      </div>
      {loading ? <div style={{ color: "#94a3b8", padding: 20 }}>Cargando…</div> : (
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>{["Activa", "Nombre", "Campo", "Operador", "Valor", "Color", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {reglas.length === 0 ? <tr><td colSpan={7} style={{ padding: 20, color: "#94a3b8", textAlign: "center" }}>Sin reglas. Agregá una.</td></tr> : reglas.map((r, i) => (
                <tr key={r.id || ("n" + i)}>
                  <td style={{ ...td, textAlign: "center" }}><input type="checkbox" checked={!!r.activa} onChange={e => setCampo(i, "activa", e.target.checked)} /></td>
                  <td style={td}><input value={r.nombre || ""} onChange={e => setCampo(i, "nombre", e.target.value)} placeholder="Nombre de la alerta" style={inp} /></td>
                  <td style={td}><select value={r.campo} onChange={e => setCampo(i, "campo", e.target.value)} style={inp}>{CAMPOS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select></td>
                  <td style={td}><select value={r.operador} onChange={e => setCampo(i, "operador", e.target.value)} style={inp}>{OPERADORES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select></td>
                  <td style={td}><input value={r.valor || ""} onChange={e => setCampo(i, "valor", e.target.value)} disabled={!necesitaValor(r.operador)} placeholder={necesitaValor(r.operador) ? "valor" : "\u2014"} style={{ ...inp, background: necesitaValor(r.operador) ? "#fff" : "#f1f5f9" }} /></td>
                  <td style={{ ...td, textAlign: "center" }}><input type="color" value={r.color || "#f59e0b"} onChange={e => setCampo(i, "color", e.target.value)} style={{ width: 32, height: 28, border: "none", background: "none", cursor: "pointer" }} /></td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button onClick={() => guardar(i)} disabled={guardando === i} style={{ padding: "5px 10px", background: "#166534", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", marginRight: 6 }}>{guardando === i ? "\u2026" : "Guardar"}</button>
                    <button onClick={() => eliminar(i)} style={{ padding: "5px 10px", background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConfiguracionPagos() {
  const [subtab, setSubtab] = useState("tarifario");
  return (
    <div className="pg" style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="sec-title">Configuración</div>
        <div className="sec-sub">Reglas y valores que alimentan el motor de cálculo de pagos</div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { id: "tarifario", l: "Tarifario (por pagar)" },
          { id: "por_cobrar", l: "Por cobrar MELI" },
          { id: "especiales", l: "Tarifas Especiales" },
          { id: "zonas", l: "Mapeo SC ↔ Zonas" },
          { id: "auxiliares", l: "Matriz Auxiliares" },
          { id: "bonificaciones", l: "Bonificaciones" },
          { id: "ns", l: "Reglas NS" },
          { id: "alertas", l: "Alertas" },
        ].map(t => (
          <button key={t.id} onClick={() => setSubtab(t.id)}
            style={{ padding: "7px 14px", borderRadius: 4, border: `1px solid ${subtab === t.id ? "#1a3a6b" : "#e4e7ec"}`,
              background: subtab === t.id ? "#1a3a6b" : "#fff", color: subtab === t.id ? "#fff" : "#475569",
              fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {t.l}
          </button>
        ))}
      </div>
      {subtab === "tarifario" && <ConfigPorPagar />}
      {subtab === "por_cobrar" && <ConfigPorCobrarMeli />}
      {subtab === "especiales" && <ConfigTarifasEspeciales />}
      {subtab === "zonas" && <ConfigZonas />}
      {subtab === "auxiliares" && <ConfigMatrizAuxiliares />}
      {subtab === "bonificaciones" && <ConfigBonificaciones />}
      {subtab === "ns" && <ConfigReglasNS />}
      {subtab === "alertas" && <ConfigAlertas />}
    </div>
  );
}

function ConfigPorPagar() {
  const [data, setData] = useState([]);
  const [edits, setEdits] = useState({});
  const [orig, setOrig] = useState({});
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);

  const [extraCats, setExtraCats] = useState([]);
  const [extraTramos, setExtraTramos] = useState([]);
  const [extraZonas, setExtraZonas] = useState([]);
  const [newCat, setNewCat] = useState("");
  const [newTramo, setNewTramo] = useState("");
  const [newZona, setNewZona] = useState("");
  const parseMinKm = (s) => { const x = String(s).trim(); return x.endsWith("+") ? (parseInt(x, 10) || 0) : (parseInt(x.split("-")[0], 10) || 0); };
  const tramos = Array.from(new Set(["0-100", "101-150", "151-200", "201-250", "251+", ...data.map(d => d.tramo_km), ...extraTramos].filter(Boolean))).sort((a, b) => parseMinKm(a) - parseMinKm(b));
  const categorias = Array.from(new Set(["LARGE VAN", "SMALL VAN", "CAR", ...data.map(d => d.tipo_vehiculo), ...extraCats].filter(Boolean)));
  const zonas = Array.from(new Set(["L1", "L2", "L3", "L4", ...data.map(d => d.zonificacion), ...extraZonas].filter(Boolean)));
  const agregarCat = () => { const v = newCat.trim().toUpperCase(); if (!v) return; if (categorias.includes(v)) { setMsg({ ok: false, txt: "Esa categoría ya existe." }); return; } setExtraCats(p => [...p, v]); setNewCat(""); setMsg(null); };
  const agregarZona = () => { const v = newZona.trim().toUpperCase(); if (!v) return; if (zonas.includes(v)) { setMsg({ ok: false, txt: "Esa zona ya existe." }); return; } setExtraZonas(p => [...p, v]); setNewZona(""); setMsg(null); };
  const agregarTramo = () => { const v = newTramo.trim().replace(/\s+/g, ""); if (!/^\d+-\d+$/.test(v) && !/^\d+\+$/.test(v)) { setMsg({ ok: false, txt: 'Rango inválido. Usá "151-200" o "251+".' }); return; } if (tramos.includes(v)) { setMsg({ ok: false, txt: "Ese rango ya existe." }); return; } setExtraTramos(p => [...p, v]); setNewTramo(""); setMsg(null); };

  useEffect(() => { cargar(); }, []);
  const cargar = async () => {
    setLoading(true);
    try {
      const { data: d } = await sb.from("matriz_precios").select("*");
      setData(d || []);
      const m = {};
      for (const r of (d || [])) m[`${r.tipo_vehiculo}|${r.zonificacion}|${r.tramo_km}`] = String(r.tarifa_mxn);
      setEdits(m); setOrig(m);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const setCell = (cat, z, tr, val) => setEdits(prev => ({ ...prev, [`${cat}|${z}|${tr}`]: val }));

  const guardar = async () => {
    setGuardando(true); setMsg(null);
    try {
      let updates = 0, inserts = 0;
      for (const cat of categorias) for (const z of zonas) for (const tr of tramos) {
        const k = `${cat}|${z}|${tr}`;
        const v = edits[k];
        if (v === undefined || v === "" || isNaN(Number(v))) continue;
        const num = Number(v);
        if (orig[k] !== undefined) {
          if (String(num) !== orig[k]) {
            const { error } = await sb.from("matriz_precios").update({ tarifa_mxn: num })
              .eq("tipo_vehiculo", cat).eq("zonificacion", z).eq("tramo_km", tr);
            if (error) throw error;
            updates++;
          }
        } else {
          const _km = String(tr).trim().endsWith("+")
            ? { mn: parseInt(tr, 10) || 0, mx: null }
            : (() => { const p = String(tr).split("-"); const b = parseInt(p[1], 10); return { mn: parseInt(p[0], 10) || 0, mx: isNaN(b) ? null : b }; })();
          const { error } = await sb.from("matriz_precios")
            .insert({ tipo_vehiculo: cat, zonificacion: z, tramo_km: tr, km_min: _km.mn, km_max: _km.mx, tarifa_mxn: num, activo: true });
          if (error) throw error;
          inserts++;
        }
      }
      setMsg({ ok: true, txt: `Guardado: ${updates} actualizadas, ${inserts} nuevas.` });
      cargar();
    } catch (e) {
      console.error(e);
      setMsg({ ok: false, txt: "Error al guardar: " + (e.message || e) });
    }
    setGuardando(false);
  };
  const baseCats = ["LARGE VAN", "SMALL VAN", "CAR"];
  const baseZonas = ["L1", "L2", "L3", "L4"];
  const baseTramos = ["0-100", "101-150", "151-200", "201-250", "251+"];
  const eliminarCat = async (cat) => { if (!confirm(`¿Eliminar la categoría "${cat}"? Se borran sus tarifas guardadas y el motor deja de usarla.`)) return; try { const { error } = await sb.from("matriz_precios").delete().eq("tipo_vehiculo", cat); if (error) throw error; setExtraCats(p => p.filter(x => x !== cat)); setMsg({ ok: true, txt: `Categoría "${cat}" eliminada.` }); cargar(); } catch (e) { setMsg({ ok: false, txt: "Error: " + (e.message || e) }); } };
  const eliminarTramo = async (tr) => { if (!confirm(`¿Eliminar el rango "${tr}"? Se borran sus tarifas guardadas.`)) return; try { const { error } = await sb.from("matriz_precios").delete().eq("tramo_km", tr); if (error) throw error; setExtraTramos(p => p.filter(x => x !== tr)); setMsg({ ok: true, txt: `Rango "${tr}" eliminado.` }); cargar(); } catch (e) { setMsg({ ok: false, txt: "Error: " + (e.message || e) }); } };
  const eliminarZona = async (z) => { if (!confirm(`¿Eliminar la zona "${z}"? Se borran sus tarifas guardadas.`)) return; try { const { error } = await sb.from("matriz_precios").delete().eq("zonificacion", z); if (error) throw error; setExtraZonas(p => p.filter(x => x !== z)); setMsg({ ok: true, txt: `Zona "${z}" eliminada.` }); cargar(); } catch (e) { setMsg({ ok: false, txt: "Error: " + (e.message || e) }); } };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;

  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>Tarifario por Pagar (costo)</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Lo que le pagamos al chofer · tabla viva matriz_precios · MXN · editable</div>
        </div>
        <button onClick={guardar} disabled={guardando}
          style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: guardando ? "#94a3b8" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: guardando ? "wait" : "pointer" }}>
          {guardando ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
      <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 6, padding: 12, marginBottom: 14, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Nueva categoría</span>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Ej: MOTO" style={{ border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 8px", fontSize: 12 }} />
            <button onClick={agregarCat} style={{ padding: "5px 10px", borderRadius: 4, border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Categoría</button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Nuevo rango de km</span>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newTramo} onChange={e => setNewTramo(e.target.value)} placeholder="Ej: 251-300 o 301+" style={{ border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 8px", fontSize: 12 }} />
            <button onClick={agregarTramo} style={{ padding: "5px 10px", borderRadius: 4, border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Rango</button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Nueva zona</span>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newZona} onChange={e => setNewZona(e.target.value)} placeholder="Ej: L5" style={{ border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 8px", fontSize: 12 }} />
            <button onClick={agregarZona} style={{ padding: "5px 10px", borderRadius: 4, border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Zona</button>
          </div>
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", flexBasis: "100%" }}>Agregá la categoría/rango/zona, completá sus valores en la tabla y apretá "Guardar cambios". Se guarda en matriz_precios y el motor de pago lo toma automáticamente.</div>
        {(() => {
          const cC = categorias.filter(c => !baseCats.includes(c));
          const cT = tramos.filter(x => !baseTramos.includes(x));
          const cZ = zonas.filter(z => !baseZonas.includes(z));
          if (!cC.length && !cT.length && !cZ.length) return null;
          const chip = { display: "inline-flex", alignItems: "center", gap: 4, background: "#fff", border: "1px solid #cbd5e1", borderRadius: 12, padding: "3px 8px", fontSize: 11, color: "#334155" };
          const cbtn = { border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 700, fontSize: 12, lineHeight: 1, padding: 0 };
          return (
            <div style={{ flexBasis: "100%", borderTop: "1px solid #e2e8f0", paddingTop: 10, marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginRight: 4 }}>Creados (✕ para eliminar):</span>
              {cC.map(c => <span key={"c" + c} style={chip}>{c}<button onClick={() => eliminarCat(c)} title="Eliminar categoría" style={cbtn}>✕</button></span>)}
              {cT.map(x => <span key={"t" + x} style={chip}>{x} km<button onClick={() => eliminarTramo(x)} title="Eliminar rango" style={cbtn}>✕</button></span>)}
              {cZ.map(z => <span key={"z" + z} style={chip}>Zona {z}<button onClick={() => eliminarZona(z)} title="Eliminar zona" style={cbtn}>✕</button></span>)}
            </div>
          );
        })()}
      </div>
      {msg && (
        <div style={{ background: msg.ok ? "#ecfdf5" : "#fef2f2", border: `1px solid ${msg.ok ? "#a7f3d0" : "#fca5a5"}`, color: msg.ok ? "#065f46" : "#991b1b", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 12 }}>{msg.txt}</div>
      )}
      {zonas.map(z => (
        <div key={z} style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>Zona {z}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Categoría</th>
                {tramos.map(tr => <th key={tr} style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>{tr} km</th>)}
              </tr>
            </thead>
            <tbody>
              {categorias.map(cat => (
                <tr key={cat} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 10px", fontWeight: 600 }}>{cat}</td>
                  {tramos.map(tr => (
                    <td key={tr} style={{ padding: "4px 6px", textAlign: "right" }}>
                      <input type="number" value={edits[`${cat}|${z}|${tr}`] ?? ""} onChange={e => setCell(cat, z, tr, e.target.value)}
                        style={{ width: 74, textAlign: "right", border: "1px solid #e4e7ec", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ConfigPorCobrarMeli() {
  const [data, setData] = useState([]);
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { cargar(); }, []);
  const cargar = async () => {
    setLoading(true);
    try {
      const { data: d } = await sb.from("tarifas_cobrar_meli_mx").select("*");
      setData(d || []);
      const m = {};
      for (const r of (d || [])) m[`${r.categoria}|${r.zonificacion}|${r.tramo_km}`] = String(r.tarifa_mxn);
      setEdits(m);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const [extraCats, setExtraCats] = useState([]);
  const [extraTramos, setExtraTramos] = useState([]);
  const [extraZonas, setExtraZonas] = useState([]);
  const [newCat, setNewCat] = useState("");
  const [newTramo, setNewTramo] = useState("");
  const [newZona, setNewZona] = useState("");
  const parseMinKm = (s) => { const x = String(s).trim(); return x.endsWith("+") ? (parseInt(x, 10) || 0) : (parseInt(x.split("-")[0], 10) || 0); };
  const categorias = Array.from(new Set(["LARGE VAN", "SMALL VAN", "CAR", "CANCELACION", ...data.map(d => d.categoria), ...extraCats].filter(Boolean)));
  const zonas = Array.from(new Set(["L1", "L2", "L3", "L4", ...data.map(d => d.zonificacion), ...extraZonas].filter(Boolean)));
  const tramos = Array.from(new Set(["0-100", "101-150", "151-200", "201-250", "251+", ...data.map(d => d.tramo_km), ...extraTramos].filter(Boolean))).sort((a, b) => parseMinKm(a) - parseMinKm(b));
  const agregarCat = () => { const v = newCat.trim().toUpperCase(); if (!v) return; if (categorias.includes(v)) { setMsg({ ok: false, txt: "Esa categoría ya existe." }); return; } setExtraCats(p => [...p, v]); setNewCat(""); setMsg(null); };
  const agregarZona = () => { const v = newZona.trim().toUpperCase(); if (!v) return; if (zonas.includes(v)) { setMsg({ ok: false, txt: "Esa zona ya existe." }); return; } setExtraZonas(p => [...p, v]); setNewZona(""); setMsg(null); };
  const agregarTramo = () => { const v = newTramo.trim().replace(/\s+/g, ""); if (!/^\d+-\d+$/.test(v) && !/^\d+\+$/.test(v)) { setMsg({ ok: false, txt: 'Rango inválido. Usá "151-200" o "251+".' }); return; } if (tramos.includes(v)) { setMsg({ ok: false, txt: "Ese rango ya existe." }); return; } setExtraTramos(p => [...p, v]); setNewTramo(""); setMsg(null); };

  const setCell = (cat, z, tr, val) => setEdits(prev => ({ ...prev, [`${cat}|${z}|${tr}`]: val }));

  const guardar = async () => {
    setGuardando(true); setMsg(null);
    try {
      const rows = [];
      for (const cat of categorias) for (const z of zonas) for (const tr of tramos) {
        const v = edits[`${cat}|${z}|${tr}`];
        if (v !== undefined && v !== "" && !isNaN(Number(v))) {
          rows.push({ categoria: cat, zonificacion: z, tramo_km: tr, tarifa_mxn: Number(v), activo: true });
        }
      }
      const { error } = await sb.from("tarifas_cobrar_meli_mx").upsert(rows, { onConflict: "categoria,zonificacion,tramo_km" });
      if (error) throw error;
      setMsg({ ok: true, txt: `Guardado: ${rows.length} tarifas por cobrar.` });
      cargar();
    } catch (e) {
      console.error(e);
      setMsg({ ok: false, txt: "Error al guardar: " + (e.message || e) });
    }
    setGuardando(false);
  };
  const baseCats = ["LARGE VAN", "SMALL VAN", "CAR", "CANCELACION"];
  const baseZonas = ["L1", "L2", "L3", "L4"];
  const baseTramos = ["0-100", "101-150", "151-200", "201-250", "251+"];
  const eliminarCat = async (cat) => { if (!confirm(`¿Eliminar la categoría "${cat}"? Se borran sus tarifas guardadas y el motor deja de usarla.`)) return; try { const { error } = await sb.from("tarifas_cobrar_meli_mx").delete().eq("categoria", cat); if (error) throw error; setExtraCats(p => p.filter(x => x !== cat)); setMsg({ ok: true, txt: `Categoría "${cat}" eliminada.` }); cargar(); } catch (e) { setMsg({ ok: false, txt: "Error: " + (e.message || e) }); } };
  const eliminarTramo = async (tr) => { if (!confirm(`¿Eliminar el rango "${tr}"? Se borran sus tarifas guardadas.`)) return; try { const { error } = await sb.from("tarifas_cobrar_meli_mx").delete().eq("tramo_km", tr); if (error) throw error; setExtraTramos(p => p.filter(x => x !== tr)); setMsg({ ok: true, txt: `Rango "${tr}" eliminado.` }); cargar(); } catch (e) { setMsg({ ok: false, txt: "Error: " + (e.message || e) }); } };
  const eliminarZona = async (z) => { if (!confirm(`¿Eliminar la zona "${z}"? Se borran sus tarifas guardadas.`)) return; try { const { error } = await sb.from("tarifas_cobrar_meli_mx").delete().eq("zonificacion", z); if (error) throw error; setExtraZonas(p => p.filter(x => x !== z)); setMsg({ ok: true, txt: `Zona "${z}" eliminada.` }); cargar(); } catch (e) { setMsg({ ok: false, txt: "Error: " + (e.message || e) }); } };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;

  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>Tarifas por Cobrar a MELI</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Lo que MELI nos paga · categoría × zona × tramo km · MXN · editable</div>
        </div>
        <button onClick={guardar} disabled={guardando}
          style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: guardando ? "#94a3b8" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: guardando ? "wait" : "pointer" }}>
          {guardando ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
      {msg && (
        <div style={{ background: msg.ok ? "#ecfdf5" : "#fef2f2", border: `1px solid ${msg.ok ? "#a7f3d0" : "#fca5a5"}`, color: msg.ok ? "#065f46" : "#991b1b", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 12 }}>{msg.txt}</div>
      )}
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>Dejá una celda vacía si esa combinación no aplica (ej. CAR solo opera 0-100).</div>
      <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 6, padding: 12, marginBottom: 14, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Nueva categoría</span>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Ej: MOTO" style={{ border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 8px", fontSize: 12 }} />
            <button onClick={agregarCat} style={{ padding: "5px 10px", borderRadius: 4, border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Categoría</button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Nuevo rango de km</span>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newTramo} onChange={e => setNewTramo(e.target.value)} placeholder="Ej: 251-300 o 301+" style={{ border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 8px", fontSize: 12 }} />
            <button onClick={agregarTramo} style={{ padding: "5px 10px", borderRadius: 4, border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Rango</button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Nueva zona</span>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newZona} onChange={e => setNewZona(e.target.value)} placeholder="Ej: L5" style={{ border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 8px", fontSize: 12 }} />
            <button onClick={agregarZona} style={{ padding: "5px 10px", borderRadius: 4, border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Zona</button>
          </div>
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", flexBasis: "100%" }}>Se guarda en tarifas_cobrar_meli_mx. Completá los valores de la nueva fila/columna y apretá "Guardar cambios".</div>
        {(() => {
          const cC = categorias.filter(c => !baseCats.includes(c));
          const cT = tramos.filter(x => !baseTramos.includes(x));
          const cZ = zonas.filter(z => !baseZonas.includes(z));
          if (!cC.length && !cT.length && !cZ.length) return null;
          const chip = { display: "inline-flex", alignItems: "center", gap: 4, background: "#fff", border: "1px solid #cbd5e1", borderRadius: 12, padding: "3px 8px", fontSize: 11, color: "#334155" };
          const cbtn = { border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 700, fontSize: 12, lineHeight: 1, padding: 0 };
          return (
            <div style={{ flexBasis: "100%", borderTop: "1px solid #e2e8f0", paddingTop: 10, marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginRight: 4 }}>Creados (✕ para eliminar):</span>
              {cC.map(c => <span key={"c" + c} style={chip}>{c}<button onClick={() => eliminarCat(c)} title="Eliminar categoría" style={cbtn}>✕</button></span>)}
              {cT.map(x => <span key={"t" + x} style={chip}>{x} km<button onClick={() => eliminarTramo(x)} title="Eliminar rango" style={cbtn}>✕</button></span>)}
              {cZ.map(z => <span key={"z" + z} style={chip}>Zona {z}<button onClick={() => eliminarZona(z)} title="Eliminar zona" style={cbtn}>✕</button></span>)}
            </div>
          );
        })()}
      </div>
      {zonas.map(z => (
        <div key={z} style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>Zona {z}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Categoría</th>
                {tramos.map(tr => <th key={tr} style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>{tr} km</th>)}
              </tr>
            </thead>
            <tbody>
              {categorias.map(cat => (
                <tr key={cat} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 10px", fontWeight: 600 }}>{cat}</td>
                  {tramos.map(tr => (
                    <td key={tr} style={{ padding: "4px 6px", textAlign: "right" }}>
                      <input type="number" value={edits[`${cat}|${z}|${tr}`] ?? ""} onChange={e => setCell(cat, z, tr, e.target.value)}
                        style={{ width: 74, textAlign: "right", border: "1px solid #e4e7ec", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ConfigTarifasEspeciales() {
  const [rows, setRows] = useState([]);
  const [deletedIds, setDeletedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);

  const TIPOS = ["Large Van", "Small Van", "Car", "Cancelacion"];
  const ZONAS = ["L1", "L2", "L3", "L4"];
  const TRAMOS = ["0-100", "101-150", "151-200", "201-250", "251+"];

  useEffect(() => { cargar(); }, []);
  const cargar = async () => {
    setLoading(true);
    try {
      const { data: d } = await sb.from("tarifas_especiales_mx").select("*").order("empresa").order("zona").order("tramo_km");
      setRows((d || []).map(r => ({ id: r.id, empresa: r.empresa || r.driver_name || "", tipologia: r.tipologia || "Large Van", zona: r.zona || "L1", tramo_km: r.tramo_km || "0-100", monto: r.monto != null ? String(r.monto) : "" })));
      setDeletedIds([]);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const setField = (i, f, v) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [f]: v } : r));
  const addRow = () => setRows(prev => [...prev, { empresa: "", tipologia: "Large Van", zona: "L1", tramo_km: "0-100", monto: "" }]);
  const delRow = (i) => setRows(prev => {
    const r = prev[i];
    if (r.id != null) setDeletedIds(d => [...d, r.id]);
    return prev.filter((_, idx) => idx !== i);
  });

  const guardar = async () => {
    for (const r of rows) {
      if (!r.empresa.trim()) { setMsg({ ok: false, txt: "Hay una regla sin empresa." }); return; }
      if (r.monto === "" || isNaN(Number(r.monto))) { setMsg({ ok: false, txt: `Monto inválido para ${r.empresa}.` }); return; }
    }
    setGuardando(true); setMsg(null);
    try {
      let upd = 0, ins = 0, del = 0;
      for (const id of deletedIds) {
        const { error } = await sb.from("tarifas_especiales_mx").delete().eq("id", id);
        if (error) throw error; del++;
      }
      for (const r of rows) {
        const payload = { empresa: r.empresa.trim(), driver_name: r.empresa.trim(), tipologia: r.tipologia, zona: r.zona, tramo_km: r.tramo_km, monto: Number(r.monto) };
        if (r.id != null) {
          const { error } = await sb.from("tarifas_especiales_mx").update(payload).eq("id", r.id);
          if (error) throw error; upd++;
        } else {
          const { error } = await sb.from("tarifas_especiales_mx").insert(payload);
          if (error) throw error; ins++;
        }
      }
      setMsg({ ok: true, txt: `Guardado: ${upd} actualizadas, ${ins} nuevas, ${del} eliminadas.` });
      cargar();
    } catch (e) {
      console.error(e);
      setMsg({ ok: false, txt: "Error al guardar: " + (e.message || e) });
    }
    setGuardando(false);
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;

  const inp = { border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 7px", fontSize: 12 };

  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>Tarifas Especiales por Empresa</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Override de tarifa por empresa (patente → empresa) · gana sobre el tarifario general · {rows.length} reglas · editable</div>
        </div>
        <button onClick={addRow} style={{ padding: "8px 14px", borderRadius: 4, border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Agregar regla</button>
        <button onClick={guardar} disabled={guardando} style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: guardando ? "#94a3b8" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: guardando ? "wait" : "pointer" }}>{guardando ? "Guardando..." : "Guardar cambios"}</button>
      </div>
      {msg && (<div style={{ background: msg.ok ? "#ecfdf5" : "#fef2f2", border: `1px solid ${msg.ok ? "#a7f3d0" : "#fca5a5"}`, color: msg.ok ? "#065f46" : "#991b1b", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 12 }}>{msg.txt}</div>)}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 720 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
              <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Empresa</th>
              <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Tipología</th>
              <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Zona</th>
              <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Tramo km</th>
              <th style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Monto MXN</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (<tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#94a3b8" }}>Sin tarifas especiales. Agregá una con "+ Agregar regla".</td></tr>)}
            {rows.map((r, i) => (
              <tr key={r.id ?? `new-${i}`} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "4px 6px" }}><input value={r.empresa} onChange={e => setField(i, "empresa", e.target.value)} placeholder="Nombre EXACTO de la empresa (flota)" style={{ ...inp, width: 260 }} /></td>
                <td style={{ padding: "4px 6px" }}><select value={r.tipologia} onChange={e => setField(i, "tipologia", e.target.value)} style={inp}>{TIPOS.map(x => <option key={x} value={x}>{x}</option>)}</select></td>
                <td style={{ padding: "4px 6px", textAlign: "center" }}><select value={r.zona} onChange={e => setField(i, "zona", e.target.value)} style={inp}>{ZONAS.map(z => <option key={z} value={z}>{z}</option>)}</select></td>
                <td style={{ padding: "4px 6px", textAlign: "center" }}><select value={r.tramo_km} onChange={e => setField(i, "tramo_km", e.target.value)} style={inp}>{TRAMOS.map(tr => <option key={tr} value={tr}>{tr}</option>)}</select></td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}><input type="number" value={r.monto} onChange={e => setField(i, "monto", e.target.value)} style={{ ...inp, width: 90, textAlign: "right" }} /></td>
                <td style={{ padding: "4px 6px", textAlign: "center" }}><button onClick={() => delRow(i)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Eliminar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConfigZonas() {
  const [data, setData] = useState([]);
  const [huerfanos, setHuerfanos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingHuerfanos, setLoadingHuerfanos] = useState(true);
  const [filtroZona, setFiltroZona] = useState("todas");
  const [busqueda, setBusqueda] = useState("");

  // Modal de edición/creación
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', data: {...} }
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { cargar(); detectarHuerfanos(); }, []);

  const cargar = async () => {
    setLoading(true);
    try {
      const { data: d } = await sb.from("sc_zonas_mx").select("*").order("zona").order("service_center_id");
      setData(d || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const detectarHuerfanos = async () => {
    setLoadingHuerfanos(true);
    try {
      // Traer SCs distintos de viajes MX en últimos 7 días vs sc_zonas_mx
      const fechaDesde = new Date();
      fechaDesde.setDate(fechaDesde.getDate() - 7);
      const fdStr = fechaDesde.toISOString().split("T")[0];

      const [vRes, zRes] = await Promise.all([
        sb.from("viajes").select("tms_raw, fecha_salida")
          .eq("pais", "MX")
          .gte("fecha_salida", fdStr),
        sb.from("sc_zonas_mx").select("service_center_id"),
      ]);

      const viajes = vRes.data || [];
      const zonasMapeadas = new Set((zRes.data || []).map(z => z.service_center_id));

      // Agrupar por SC
      const map = {};
      for (const v of viajes) {
        const sc = v.tms_raw?.["Service center"];
        if (!sc) continue;
        if (zonasMapeadas.has(sc)) continue;
        if (!map[sc]) map[sc] = { sc, viajes: 0, primera: v.fecha_salida, ultima: v.fecha_salida };
        map[sc].viajes++;
        if (v.fecha_salida < map[sc].primera) map[sc].primera = v.fecha_salida;
        if (v.fecha_salida > map[sc].ultima) map[sc].ultima = v.fecha_salida;
      }
      const lista = Object.values(map).sort((a, b) => b.viajes - a.viajes);
      setHuerfanos(lista);
    } catch (e) { console.error(e); }
    setLoadingHuerfanos(false);
  };

  const abrirCrear = (scIdPreset = "") => {
    setModal({
      mode: "create",
      data: {
        service_center_id: scIdPreset,
        zona: "L1",
        ciudad: "",
        observaciones: "",
        vigente_desde: new Date().toISOString().split("T")[0],
      }
    });
  };

  const abrirEditar = (sc) => {
    setModal({
      mode: "edit",
      data: { ...sc, vigente_desde: sc.vigente_desde || new Date().toISOString().split("T")[0] }
    });
  };

  const cerrarModal = () => setModal(null);

  const guardar = async () => {
    if (!modal) return;
    const d = modal.data;
    if (!d.service_center_id?.trim()) { alert("El ID del Service Center es obligatorio"); return; }
    if (!["L1", "L2", "L3", "L4"].includes(d.zona)) { alert("Zona inválida"); return; }

    setGuardando(true);
    try {
      const payload = {
        service_center_id: d.service_center_id.trim().toUpperCase(),
        zona: d.zona,
        ciudad: d.ciudad?.trim() || null,
        observaciones: d.observaciones?.trim() || null,
        vigente_desde: d.vigente_desde,
        actualizado_por: "brain",
      };

      if (modal.mode === "create") {
        // Verificar duplicado
        const ya = data.find(x => x.service_center_id === payload.service_center_id);
        if (ya) { alert(`Ya existe el SC ${payload.service_center_id}. Usá "Editar" en su lugar.`); setGuardando(false); return; }
        payload.creado_por = "brain";
        const { error } = await sb.from("sc_zonas_mx").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await sb.from("sc_zonas_mx").update(payload).eq("id", d.id);
        if (error) throw error;
      }

      cerrarModal();
      await cargar();
      await detectarHuerfanos();
    } catch (e) {
      console.error(e);
      alert("Error al guardar: " + e.message);
    }
    setGuardando(false);
  };

  const eliminar = async (sc) => {
    if (!confirm(`¿Dar de baja el SC ${sc.service_center_id}?\n\nSe marcará como vigente_hasta = hoy. Los registros históricos se mantienen.`)) return;
    try {
      const hoy = new Date().toISOString().split("T")[0];
      const { error } = await sb.from("sc_zonas_mx").update({ vigente_hasta: hoy, actualizado_por: "brain" }).eq("id", sc.id);
      if (error) throw error;
      await cargar();
    } catch (e) {
      alert("Error: " + e.message);
    }
  };

  const filtrados = useMemo(() => {
    let res = filtroZona === "todas" ? data : data.filter(d => d.zona === filtroZona);
    if (busqueda) res = res.filter(d => d.service_center_id?.toLowerCase().includes(busqueda.toLowerCase()) || d.ciudad?.toLowerCase().includes(busqueda.toLowerCase()));
    return res;
  }, [data, filtroZona, busqueda]);

  const conteo = data.reduce((acc, d) => { acc[d.zona] = (acc[d.zona] || 0) + 1; return acc; }, {});
  const activos = data.filter(d => !d.vigente_hasta).length;

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;

  return (
    <div>
      {/* Detector de huérfanos */}
      {loadingHuerfanos ? (
        <div style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 11, color: "#94a3b8" }}>
          Buscando SCs sin mapeo en viajes recientes...
        </div>
      ) : huerfanos.length > 0 ? (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", marginBottom: 2 }}>
                {huerfanos.length} Service Center{huerfanos.length > 1 ? "s" : ""} sin mapear
              </div>
              <div style={{ fontSize: 11, color: "#7f1d1d" }}>
                Detectados en viajes MX de los últimos 7 días pero ausentes en sc_zonas_mx. Sin zona, esos viajes no calculan pago.
              </div>
            </div>
            <button onClick={detectarHuerfanos}
              style={{ padding: "5px 10px", borderRadius: 4, border: "1px solid #fca5a5", background: "#fff", color: "#991b1b", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              Refrescar
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
            {huerfanos.map(h => (
              <div key={h.sc} style={{ background: "#fff", border: "1px solid #fca5a5", borderRadius: 4, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{h.sc}</div>
                  <div style={{ fontSize: 10, color: "#7f1d1d", marginTop: 2 }}>
                    {h.viajes} viaje{h.viajes > 1 ? "s" : ""} · desde {String(h.primera).slice(0, 10)}
                  </div>
                </div>
                <button onClick={() => abrirCrear(h.sc)}
                  style={{ padding: "5px 10px", borderRadius: 4, border: "none", background: "#F47B20", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Mapear
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 11, color: "#065f46", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Sin Service Centers huérfanos en últimos 7 días — todos los viajes pueden calcular pago.</span>
          <button onClick={detectarHuerfanos}
            style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #a7f3d0", background: "#fff", color: "#065f46", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
            Refrescar
          </button>
        </div>
      )}

      {/* Header con KPIs y acciones */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>Mapeo Service Center ↔ Zona</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{activos} Service Centers activos · {data.length} totales</div>
          </div>
          <button onClick={() => abrirCrear()}
            style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: "#1a3a6b", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            + Agregar Service Center
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <button onClick={() => setFiltroZona("todas")}
            style={{ padding: "5px 12px", borderRadius: 4, border: `1px solid ${filtroZona === "todas" ? "#1a3a6b" : "#e4e7ec"}`,
              background: filtroZona === "todas" ? "#1a3a6b" : "#fff", color: filtroZona === "todas" ? "#fff" : "#475569",
              fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Todas ({data.length})</button>
          {["L1", "L2", "L3", "L4"].map(z => (
            <button key={z} onClick={() => setFiltroZona(z)}
              style={{ padding: "5px 12px", borderRadius: 4, border: `1px solid ${filtroZona === z ? "#1a3a6b" : "#e4e7ec"}`,
                background: filtroZona === z ? "#1a3a6b" : "#fff", color: filtroZona === z ? "#fff" : "#475569",
                fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{z} ({conteo[z] || 0})</button>
          ))}
        </div>
        <input type="text" placeholder="Buscar por SC o ciudad..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
          style={{ width: "100%", background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12 }} />
      </div>

      {/* Tabla de SCs */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "hidden" }}>
        {filtrados.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>Sin resultados</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#475569" }}>SC ID</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#475569" }}>Zona</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#475569" }}>Ciudad</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#475569" }}>Observaciones</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#475569" }}>Vigente</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#475569" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(sc => {
                const dadoBaja = sc.vigente_hasta && new Date(sc.vigente_hasta) <= new Date();
                return (
                  <tr key={sc.id} style={{ borderBottom: "1px solid #f0f0f0", opacity: dadoBaja ? 0.5 : 1 }}>
                    <td style={{ padding: "10px 14px", fontFamily: "monospace", fontWeight: 700, color: "#1a3a6b" }}>{sc.service_center_id}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, background: "#1a3a6b", color: "#fff", fontWeight: 600 }}>{sc.zona}</span>
                    </td>
                    <td style={{ padding: "10px 14px", color: sc.ciudad ? "#1f2937" : "#cbd5e1" }}>{sc.ciudad || "—"}</td>
                    <td style={{ padding: "10px 14px", fontSize: 11, color: "#64748b" }}>{sc.observaciones || ""}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center", fontSize: 11 }}>
                      {dadoBaja ? (
                        <span style={{ color: "#dc2626", fontWeight: 600 }}>Baja {String(sc.vigente_hasta).slice(0, 10)}</span>
                      ) : (
                        <span style={{ color: "#16a34a", fontWeight: 600 }}>Activo</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <button onClick={() => abrirEditar(sc)}
                        style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#fff", color: "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer", marginRight: 4 }}>
                        Editar
                      </button>
                      {!dadoBaja && (
                        <button onClick={() => eliminar(sc)}
                          style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #fca5a5", background: "#fff", color: "#991b1b", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          Baja
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal de edición/creación */}
      {modal && (
        <div onClick={cerrarModal}
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 8, padding: 20, width: "90%", maxWidth: 480, boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b", marginBottom: 16 }}>
              {modal.mode === "create" ? "Agregar Service Center" : `Editar ${modal.data.service_center_id}`}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Service Center ID *</label>
              <input type="text" value={modal.data.service_center_id} disabled={modal.mode === "edit"}
                onChange={e => setModal({ ...modal, data: { ...modal.data, service_center_id: e.target.value.toUpperCase() } })}
                placeholder="Ej: SMX7"
                style={{ width: "100%", background: modal.mode === "edit" ? "#f1f5f9" : "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "8px 10px", fontSize: 12, fontFamily: "monospace", fontWeight: 600 }} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Zona *</label>
              <div style={{ display: "flex", gap: 6 }}>
                {["L1", "L2", "L3", "L4"].map(z => (
                  <button key={z} onClick={() => setModal({ ...modal, data: { ...modal.data, zona: z } })}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 4, border: `1px solid ${modal.data.zona === z ? "#1a3a6b" : "#e4e7ec"}`,
                      background: modal.data.zona === z ? "#1a3a6b" : "#fff", color: modal.data.zona === z ? "#fff" : "#475569",
                      fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    {z}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Ciudad</label>
              <input type="text" value={modal.data.ciudad || ""}
                onChange={e => setModal({ ...modal, data: { ...modal.data, ciudad: e.target.value } })}
                placeholder="Ej: Pachuca"
                style={{ width: "100%", background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "8px 10px", fontSize: 12 }} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Vigente desde</label>
              <input type="date" value={modal.data.vigente_desde}
                onChange={e => setModal({ ...modal, data: { ...modal.data, vigente_desde: e.target.value } })}
                style={{ width: "100%", background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "8px 10px", fontSize: 12 }} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Observaciones</label>
              <textarea value={modal.data.observaciones || ""}
                onChange={e => setModal({ ...modal, data: { ...modal.data, observaciones: e.target.value } })}
                placeholder="Notas internas (opcional)"
                style={{ width: "100%", background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "8px 10px", fontSize: 12, fontFamily: "inherit", minHeight: 60, resize: "vertical" }} />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={cerrarModal} disabled={guardando}
                style={{ padding: "8px 16px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Cancelar
              </button>
              <button onClick={guardar} disabled={guardando}
                style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: guardando ? "#94a3b8" : "#1a3a6b", color: "#fff", fontSize: 12, fontWeight: 600, cursor: guardando ? "wait" : "pointer" }}>
                {guardando ? "Guardando..." : modal.mode === "create" ? "Crear" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigMatrizAuxiliares() {
  const [cfg, setCfg] = useState({});
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { cargar(); }, []);
  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await sb.from("config_pagos_mx").select("*");
      const m = {}; for (const c of (data || [])) m[c.clave] = String(c.valor);
      setCfg(m);
    } catch (e) { console.error(e); }
    setLoading(false);
  };
  const set = (k, v) => setCfg(p => ({ ...p, [k]: v }));
  const guardar = async () => {
    setGuardando(true); setMsg(null);
    try {
      const rows = [
        { clave: "aux_por_pagar", valor: Number(cfg.aux_por_pagar), descripcion: "Monto que se paga al chofer por helper aprobado" },
        { clave: "aux_por_cobrar", valor: Number(cfg.aux_por_cobrar), descripcion: "Monto que MELI nos paga por ruta con helper" },
      ];
      for (const r of rows) if (isNaN(r.valor)) { setMsg({ ok: false, txt: "Montos inválidos." }); setGuardando(false); return; }
      const { error } = await sb.from("config_pagos_mx").upsert(rows, { onConflict: "clave" });
      if (error) throw error;
      setMsg({ ok: true, txt: "Montos de auxiliar guardados." });
      cargar();
    } catch (e) { setMsg({ ok: false, txt: "Error: " + (e.message || e) }); }
    setGuardando(false);
  };
  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;
  const inp = { border: "1px solid #e4e7ec", borderRadius: 4, padding: "8px 10px", fontSize: 14, width: 120, textAlign: "right" };
  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>Montos de Auxiliar (Helper)</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>Lo que se le paga al chofer y lo que MELI nos paga por ruta con helper · alimenta el cálculo</div>
      </div>
      {msg && (<div style={{ background: msg.ok ? "#ecfdf5" : "#fef2f2", border: `1px solid ${msg.ok ? "#a7f3d0" : "#fca5a5"}`, color: msg.ok ? "#065f46" : "#991b1b", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 12 }}>{msg.txt}</div>)}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 18, display: "flex", gap: 30, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 6 }}>Por pagar al chofer (MXN)</div>
          <input type="number" value={cfg.aux_por_pagar ?? ""} onChange={e => set("aux_por_pagar", e.target.value)} style={inp} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 6 }}>Por cobrar a MELI (MXN)</div>
          <input type="number" value={cfg.aux_por_cobrar ?? ""} onChange={e => set("aux_por_cobrar", e.target.value)} style={inp} />
        </div>
        <button onClick={guardar} disabled={guardando} style={{ padding: "9px 18px", borderRadius: 4, border: "none", background: guardando ? "#94a3b8" : "#16a34a", color: "#fff", fontSize: 13, fontWeight: 600, cursor: guardando ? "wait" : "pointer" }}>{guardando ? "Guardando..." : "Guardar"}</button>
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 10 }}>El auxiliar se paga solo si el helper queda APROBADO; se cobra a MELI cuando la ruta tuvo helper. Recalculá el día para aplicar cambios.</div>
    </div>
  );
}

function ConfigReglasNS() {
  const [cfg, setCfg] = useState({});
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);

  const campos = [
    { k: "vis_min_pago", l: "Visitado mínimo para pagar (%)", h: "Debajo de esto, no se paga" },
    { k: "vis_premio_min", l: "Visitado para banda premio (%)", h: "Desde esto entra a banda alta" },
    { k: "ns_premio_min", l: "NS mínimo para premio (%)", h: "NS estrictamente mayor a esto" },
    { k: "ns_castigo_max", l: "NS máximo para castigo (%)", h: "NS menor a esto castiga" },
    { k: "ns_premio_pct", l: "Premio (%)", h: "Se suma a la tarifa" },
    { k: "ns_castigo_pct", l: "Castigo (%)", h: "Se resta de la tarifa" },
  ];

  useEffect(() => { cargar(); }, []);
  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await sb.from("config_pagos_mx").select("*");
      const m = {}; for (const c of (data || [])) m[c.clave] = String(c.valor);
      setCfg(m);
    } catch (e) { console.error(e); }
    setLoading(false);
  };
  const set = (k, v) => setCfg(p => ({ ...p, [k]: v }));
  const guardar = async () => {
    setGuardando(true); setMsg(null);
    try {
      const rows = campos.map(c => ({ clave: c.k, valor: Number(cfg[c.k]), descripcion: c.l }));
      for (const r of rows) if (isNaN(r.valor)) { setMsg({ ok: false, txt: "Hay un valor inválido." }); setGuardando(false); return; }
      const { error } = await sb.from("config_pagos_mx").upsert(rows, { onConflict: "clave" });
      if (error) throw error;
      setMsg({ ok: true, txt: "Reglas NS guardadas." });
      cargar();
    } catch (e) { setMsg({ ok: false, txt: "Error: " + (e.message || e) }); }
    setGuardando(false);
  };
  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;
  const inp = { border: "1px solid #e4e7ec", borderRadius: 4, padding: "7px 9px", fontSize: 13, width: 90, textAlign: "right" };
  const g = (k, d) => (cfg[k] !== undefined && cfg[k] !== "") ? Number(cfg[k]) : d;
  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>Reglas de Ajuste (Visitado × NS)</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Premio/castigo sobre la tarifa según % visitado y nivel de servicio · alimenta el cálculo</div>
        </div>
        <button onClick={guardar} disabled={guardando} style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: guardando ? "#94a3b8" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: guardando ? "wait" : "pointer" }}>{guardando ? "Guardando..." : "Guardar"}</button>
      </div>
      {msg && (<div style={{ background: msg.ok ? "#ecfdf5" : "#fef2f2", border: `1px solid ${msg.ok ? "#a7f3d0" : "#fca5a5"}`, color: msg.ok ? "#065f46" : "#991b1b", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 12 }}>{msg.txt}</div>)}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16, marginBottom: 14 }}>
        {campos.map(c => (
          <div key={c.k}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>{c.l}</div>
            <input type="number" value={cfg[c.k] ?? ""} onChange={e => set(c.k, e.target.value)} style={inp} />
            <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 3 }}>{c.h}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>Matriz resultante (lo que aplica el cálculo)</div>
        <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.9 }}>
          <div>· Visitado &lt; {g("vis_min_pago", 90)}% → <b style={{ color: "#991b1b" }}>NO PAGA</b></div>
          <div>· Visitado ≥ {g("vis_premio_min", 99.5)}% y NS &gt; {g("ns_premio_min", 99.5)}% → <b style={{ color: "#16a34a" }}>+{g("ns_premio_pct", 5)}%</b></div>
          <div>· Visitado entre {g("vis_min_pago", 90)}% y {g("vis_premio_min", 99.5)}% y NS &lt; {g("ns_castigo_max", 95)}% → <b style={{ color: "#dc2626" }}>−{g("ns_castigo_pct", 3)}%</b></div>
          <div>· Cualquier otro caso pagable → <b>0%</b></div>
        </div>
      </div>
    </div>
  );
}

const PADRON_CFG = {
  drivers: {
    tabla: "meli_drivers_master",
    rpcDiff: "get_drivers_padron_diff",
    llave: "driver_id",
    label: "conductores",
    icono: "ti-user",
    selectData: "driver_id,nombre,first_name,last_name,document_type,document_value,status,disabled,is_only_helper,carrier_id,email,phone,fecha_snapshot,created_at",
    cols: ["driver_id", "nombre", "document_value", "status", "disabled", "is_only_helper", "carrier_id", "email", "phone", "first_name", "last_name", "created_at"],
    diffCols: [
      { k: "driver_id", l: "Driver ID", mono: true },
      { k: "nombre", l: "Nombre", bold: true },
      { k: "document_value", l: "CURP", mono: true, small: true },
      { k: "status", l: "Status", badge: true },
      { k: "carrier_id", l: "Carrier", mono: true, small: true },
      { k: "detalle", l: "Detalle", muted: true },
    ],
    cambioTipos: ["cambio_status", "cambio_disabled", "cambio_carrier"],
    tieneRepetidas: false,
  },
  vehiculos: {
    tabla: "meli_vehicles_master",
    rpcDiff: "get_vehiculos_padron_diff",
    llave: "vehicle_id",
    label: "vehículos",
    icono: "ti-truck",
    selectData: "vehicle_id,placa,tipo_nombre,tipo_id,capacidad,es_sdd,is_traction,status,carrier_id,amount_plate,fecha_snapshot,created_at",
    cols: ["vehicle_id", "placa", "tipo_nombre", "capacidad", "es_sdd", "is_traction", "status", "carrier_id", "amount_plate", "created_at"],
    diffCols: [
      { k: "vehicle_id", l: "Vehicle ID", mono: true },
      { k: "placa", l: "Placa", bold: true, mono: true },
      { k: "tipo_nombre", l: "Tipo", small: true },
      { k: "capacidad", l: "Cap.", mono: true, small: true },
      { k: "status", l: "Status", badge: true },
      { k: "detalle", l: "Detalle", muted: true },
    ],
    cambioTipos: ["cambio_tipo", "cambio_status"],
    tieneRepetidas: true,
  },
};

function padronCsv(headers, rows, filename) {
  const csv = [headers.join(",")].concat(
    rows.map(r => r.map(v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(","))
  ).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
}

function padronFmt(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return String(v);
}

function padronRolMeta(isOnlyHelper) {
  if (isOnlyHelper === true)  return { label: "Helper", color: "#F47B20", bg: "#fff3e6" };
  if (isOnlyHelper === false) return { label: "Driver", color: "#1a3a6b", bg: "#e8edf5" };
  return { label: "Sin dato", color: "#94a3b8", bg: "#f1f5f9" };
}

function PadronRolBadge({ value }) {
  const m = padronRolMeta(value);
  return <span style={{ background: m.bg, color: m.color, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>{m.label}</span>;
}

function padronInfraccionLabel(key) {
  if (!key) return "Infracción";
  const map = {
    driver_advertencia: "Advertencia",
    driver_suspension: "Suspensión",
    driver_bloqueo: "Bloqueo",
  };
  return map[key] || String(key).replace(/^driver_/, "").replace(/_/g, " ");
}

function PadronDriversData({ fecha }) {
  const [masterRows, setMasterRows] = useState([]);
  const [detalleMap, setDetalleMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [soloInfractores, setSoloInfractores] = useState(false);
  const [expandidos, setExpandidos] = useState(new Set());

  const PNAVY = "#1a3a6b", PMUTED = "#64748b", PLIGHT = "#94a3b8", PBORDER = "#e4e7ec";

  useEffect(() => {
    if (!fecha) return;
    let alive = true;
    (async () => {
      setLoading(true); setError(null); setExpandidos(new Set());
      try {
        // Snapshot del día (universo operativo) + detalle enriquecido (1 fila por driver)
        const [mRes, dRes] = await Promise.all([
          sb.from("meli_drivers_master")
            .select("driver_id,nombre,first_name,last_name,document_value,status")
            .eq("fecha_snapshot", fecha).limit(5000),
          sb.from("meli_drivers_detalle")
            .select("driver_id,first_name,last_name,document_value,email,phone,creation_date,status,tiene_infraccion,infraction_status,esta_bloqueado,blocking_reason,is_only_helper")
            .limit(5000),
        ]);
        if (mRes.error) throw mRes.error;
        if (dRes.error) throw dRes.error;
        const map = new Map((dRes.data || []).map(d => [Number(d.driver_id), d]));
        if (alive) { setMasterRows(mRes.data || []); setDetalleMap(map); }
      } catch (e) { if (alive) setError(e.message || "Error"); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [fecha]);

  // Merge master + detalle por driver_id
  const rows = useMemo(() => {
    return masterRows.map(m => {
      const d = detalleMap.get(Number(m.driver_id)) || null;
      const nombre = (d && (d.first_name || d.last_name))
        ? `${d.first_name || ""} ${d.last_name || ""}`.trim()
        : (m.first_name || m.last_name) ? `${m.first_name || ""} ${m.last_name || ""}`.trim()
        : (m.nombre || "—");
      return {
        driver_id: m.driver_id,
        nombre_completo: nombre || "—",
        curp: m.document_value || (d && d.document_value) || "—",
        creation_date: d ? d.creation_date : null,
        email: d ? d.email : null,
        phone: d ? d.phone : null,
        status: m.status || (d && d.status) || "—",
        is_only_helper: d ? d.is_only_helper : null,
        tiene_infraccion: !!(d && d.tiene_infraccion),
        infraction_status: d ? d.infraction_status : null,
        esta_bloqueado: !!(d && d.esta_bloqueado),
        blocking_reason: d ? d.blocking_reason : null,
        enriquecido: !!d,
      };
    });
  }, [masterRows, detalleMap]);

  const kpis = useMemo(() => ({
    total: rows.length,
    infractores: rows.filter(r => r.tiene_infraccion).length,
    conEmail: rows.filter(r => r.email).length,
    conTel: rows.filter(r => r.phone).length,
  }), [rows]);

  const filtradas = useMemo(() => {
    let res = rows;
    if (soloInfractores) res = res.filter(r => r.tiene_infraccion);
    const q = busqueda.toLowerCase().trim();
    if (q) {
      res = res.filter(r =>
        [r.driver_id, r.nombre_completo, r.curp, r.email, r.phone]
          .some(v => String(v ?? "").toLowerCase().includes(q))
      );
    }
    return res;
  }, [rows, busqueda, soloInfractores]);

  const toggleExpand = (id) => {
    setExpandidos(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const exportar = () => {
    const headers = ["ID conductor", "Nombre completo", "CURP", "Fecha de creación (MX)", "Correo", "Teléfono", "Estado", "Infracción"];
    const filas = filtradas.map(r => {
      const inf = r.tiene_infraccion && r.infraction_status
        ? `${padronInfraccionLabel(r.infraction_status.key)} ${r.infraction_status.date || ""}`.trim()
        : "";
      return [r.driver_id, r.nombre_completo, r.curp, fmtFechaHoraMX(r.creation_date), r.email || "", r.phone || "", r.status, inf];
    });
    padronCsv(headers, filas, "padron_conductores");
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: PMUTED, fontSize: 13 }}>Cargando conductores…</div>;
  if (error) return <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 14, fontSize: 12, color: "#991b1b" }}>{error}</div>;

  const COLS = 9;

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
        <PKpi l="Total conductores" v={kpis.total} s={`snapshot ${fecha || "—"}`} accent={PNAVY} />
        <PKpi l="⚠️ Con infracción" v={kpis.infractores} s="advertencias / sanciones" accent="#d97706" />
        <PKpi l="Con correo" v={kpis.conEmail} s={`${kpis.total ? Math.round(100 * kpis.conEmail / kpis.total) : 0}% del padrón`} accent="#10b981" />
        <PKpi l="Con teléfono" v={kpis.conTel} s={`${kpis.total ? Math.round(100 * kpis.conTel / kpis.total) : 0}% del padrón`} accent="#10b981" />
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder={`Buscar por nombre, CURP, correo, teléfono o ID…`}
          style={{ flex: 1, minWidth: 240, maxWidth: 400, padding: "7px 10px", border: `1px solid #d0d5dd`, borderRadius: 6, fontSize: 12, fontFamily: "'Geist', sans-serif" }} />
        <button onClick={() => setSoloInfractores(v => !v)} style={{
          fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, cursor: "pointer",
          border: soloInfractores ? "none" : `1px solid ${PBORDER}`,
          background: soloInfractores ? "#d97706" : "#fff",
          color: soloInfractores ? "#fff" : PMUTED,
          fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 14 }} />
          {soloInfractores ? `Mostrando infractores (${kpis.infractores})` : "Solo infractores"}
        </button>
        <span style={{ fontSize: 12, color: PMUTED }}>{filtradas.length} de {rows.length}</span>
        <button onClick={exportar} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, padding: "6px 11px", borderRadius: 6, border: "none", background: PNAVY, color: "#fff", cursor: "pointer", fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i className="ti ti-download" style={{ fontSize: 12 }} />Exportar CSV
        </button>
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", borderRadius: 12, border: `0.5px solid ${PBORDER}`, overflow: "hidden" }}>
        <div style={{ maxHeight: "60vh", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#f8fafc" }}>
              <tr>
                <ApTh>ID conductor</ApTh>
                <ApTh>Nombre completo</ApTh>
                <ApTh>CURP</ApTh>
                <ApTh>Fecha de creación (MX)</ApTh>
                <ApTh>Correo</ApTh>
                <ApTh>Teléfono</ApTh>
                <ApTh>Estado</ApTh>
                <ApTh>Rol</ApTh>
                <ApTh>Infracción</ApTh>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr><td colSpan={COLS} style={{ padding: 30, textAlign: "center", color: PLIGHT }}>Sin resultados</td></tr>
              )}
              {filtradas.map((r, i) => {
                const abierto = expandidos.has(r.driver_id);
                const inf = r.infraction_status || {};
                return (
                  <Fragment key={r.driver_id ?? i}>
                    <tr
                      onClick={() => r.tiene_infraccion && toggleExpand(r.driver_id)}
                      style={{ borderBottom: abierto ? "none" : "0.5px solid #f4f5f7", cursor: r.tiene_infraccion ? "pointer" : "default", background: abierto ? "#fffbeb" : "transparent" }}>
                      <ApTd mono>{r.driver_id}</ApTd>
                      <ApTd bold>{r.nombre_completo}</ApTd>
                      <ApTd mono small>{r.curp}</ApTd>
                      <ApTd small>{fmtFechaHoraMX(r.creation_date)}</ApTd>
                      <ApTd small>{r.email || <span style={{ color: PLIGHT }}>—</span>}</ApTd>
                      <ApTd mono small>{r.phone || <span style={{ color: PLIGHT }}>—</span>}</ApTd>
                      <ApTd>
                        <span style={{ background: r.status === "active" ? "#d1fae5" : "#fef3c7", color: r.status === "active" ? "#065f46" : "#92400e", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>{r.status}</span>
                      </ApTd>
                      <ApTd><PadronRolBadge value={r.is_only_helper} /></ApTd>
                      <ApTd>
                        {r.tiene_infraccion ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#fef3c7", color: "#92400e", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>
                            <i className="ti ti-alert-triangle" style={{ fontSize: 12 }} />
                            {padronInfraccionLabel(inf.key)}
                            <i className={`ti ${abierto ? "ti-chevron-up" : "ti-chevron-down"}`} style={{ fontSize: 12 }} />
                          </span>
                        ) : (
                          <span style={{ color: PLIGHT }}>—</span>
                        )}
                      </ApTd>
                    </tr>
                    {abierto && r.tiene_infraccion && (
                      <tr style={{ borderBottom: "0.5px solid #f4f5f7", background: "#fffbeb" }}>
                        <td colSpan={COLS} style={{ padding: "10px 16px 14px 16px" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, fontSize: 12, color: "#1a1a1a" }}>
                            <div><span style={{ color: PMUTED, fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 2 }}>Tipo</span>{padronInfraccionLabel(inf.key)}</div>
                            <div><span style={{ color: PMUTED, fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 2 }}>Fecha infracción</span>{inf.date || "—"}</div>
                            <div><span style={{ color: PMUTED, fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 2 }}>Clasificación</span>{inf.sentenceType || "—"}</div>
                            <div><span style={{ color: PMUTED, fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 2 }}>Clave MELI</span><code style={{ fontSize: 11 }}>{inf.key || "—"}</code></div>
                            {r.esta_bloqueado && (
                              <div><span style={{ color: "#991b1b", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 2 }}>🔒 Bloqueado</span>{JSON.stringify(r.blocking_reason)}</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: PLIGHT, fontStyle: "italic" }}>
        ℹ️ Contacto, fecha de creación e infracciones provienen del detalle de MELI (tabla de enriquecimiento). Conductores sin estos datos aún no fueron enriquecidos o MELI no los expone. Clic en una fila con <strong style={{ color: "#92400e" }}>infracción</strong> para ver el detalle.
      </div>
    </div>
  );
}

function PadronCursos() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [soloOperan, setSoloOperan] = useState(false);
  const PNAVY = "#1a3a6b", PMUTED = "#64748b", PLIGHT = "#94a3b8", PBORDER = "#e4e7ec";

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error } = await sb.from("vw_cursos_actividad").select("*").limit(5000);
        if (error) throw error;
        if (alive) setRows(data || []);
      } catch (e) { if (alive) setError(e.message || "Error"); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const kpis = useMemo(() => ({
    total: rows.length,
    operan: rows.filter(r => r.opera_hoy).length,
    sin_op: rows.filter(r => !r.opera_hoy).length,
  }), [rows]);

  const filtradas = useMemo(() => {
    let res = rows;
    if (soloOperan) res = res.filter(r => r.opera_hoy);
    const q = busqueda.toLowerCase().trim();
    if (q) res = res.filter(r =>
      [r.driver_id, r.nombre, r.email, r.telefono, r.curp].some(v => String(v ?? "").toLowerCase().includes(q)));
    return res;
  }, [rows, busqueda, soloOperan]);

  const exportar = () => {
    const headers = ["ID conductor", "Nombre", "Curso", "Estado", "Correo", "Teléfono", "CURP", "Opera hoy"];
    const filas = filtradas.map(r => [r.driver_id, r.nombre, r.course_name, r.status,
      r.email || "", r.telefono || "", r.curp || "", r.opera_hoy ? "Sí" : "No"]);
    padronCsv(headers, filas, "cursos_pendientes");
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: PMUTED, fontSize: 13 }}>Cargando cursos…</div>;
  if (error) return <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 14, fontSize: 12, color: "#991b1b" }}>{error}</div>;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
        <PKpi l="Cursos pendientes" v={kpis.total} s='"Cómo hacer entregas con la app"' accent={PNAVY} />
        <PKpi l="Operan hoy" v={kpis.operan} s="en el padrón operativo · accionables" accent="#d97706" />
        <PKpi l="No operan hoy" v={kpis.sin_op} s="pendientes fuera de operación" accent={PLIGHT} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre, ID, correo, teléfono…"
          style={{ flex: 1, minWidth: 240, maxWidth: 400, padding: "7px 10px", border: "1px solid #d0d5dd", borderRadius: 6, fontSize: 12, fontFamily: "'Geist', sans-serif" }} />
        <button onClick={() => setSoloOperan(v => !v)} style={{
          fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, cursor: "pointer",
          border: soloOperan ? "none" : `1px solid ${PBORDER}`,
          background: soloOperan ? "#d97706" : "#fff", color: soloOperan ? "#fff" : PMUTED,
          fontFamily: "'Geist', sans-serif",
        }}>{soloOperan ? `Mostrando operativos (${kpis.operan})` : "Solo los que operan hoy"}</button>
        <span style={{ fontSize: 12, color: PMUTED }}>{filtradas.length} de {rows.length}</span>
        <button onClick={exportar} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, padding: "6px 11px", borderRadius: 6, border: "none", background: PNAVY, color: "#fff", cursor: "pointer", fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i className="ti ti-download" style={{ fontSize: 12 }} />Exportar CSV
        </button>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, border: `0.5px solid ${PBORDER}`, overflow: "hidden" }}>
        <div style={{ maxHeight: "60vh", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#f8fafc" }}>
              <tr>
                <ApTh>ID conductor</ApTh><ApTh>Nombre</ApTh><ApTh>Curso</ApTh>
                <ApTh>Estado</ApTh><ApTh>Rol</ApTh><ApTh>Correo</ApTh><ApTh>Teléfono</ApTh><ApTh>Opera hoy</ApTh>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: PLIGHT }}>Sin resultados</td></tr>
              )}
              {filtradas.map((r, i) => (
                <tr key={r.driver_id ?? i} style={{ borderBottom: "0.5px solid #f4f5f7" }}>
                  <ApTd mono>{r.driver_id}</ApTd>
                  <ApTd bold>{r.nombre || "—"}</ApTd>
                  <ApTd small>{r.course_name}</ApTd>
                  <ApTd>
                    <span style={{ background: "#fef3c7", color: "#92400e", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>
                      {r.status === "urgent" ? "Urgente" : r.status}
                    </span>
                  </ApTd>
                  <ApTd><PadronRolBadge value={r.is_only_helper} /></ApTd>
                  <ApTd small>{r.email || <span style={{ color: PLIGHT }}>—</span>}</ApTd>
                  <ApTd mono small>{r.telefono || <span style={{ color: PLIGHT }}>—</span>}</ApTd>
                  <ApTd center>
                    {r.opera_hoy
                      ? <span style={{ background: "#d1fae5", color: "#065f46", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>Opera</span>
                      : <span style={{ color: PLIGHT }}>—</span>}
                  </ApTd>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: PLIGHT, fontStyle: "italic" }}>
        ℹ️ Cursos pendientes capturados desde el hub de capacitación de MELI. "Opera hoy" = aparece en el último snapshot del padrón operativo.
      </div>
    </div>
  );
}

function PadronRechazados() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [soloActivos, setSoloActivos] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);
  const PNAVY = "#1a3a6b", PMUTED = "#64748b", PLIGHT = "#94a3b8", PBORDER = "#e4e7ec";

  async function cargar() {
    setLoading(true); setError(null);
    try {
      const { data, error } = await sb.from("vw_rechazados_actividad").select("*").limit(5000);
      if (error) throw error;
      setRows(data || []);
    } catch (e) { setError(e.message || "Error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  // Parsea fechas tipo Excel a ISO (o null)
  function aFecha(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return v.toISOString();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  async function onArchivo(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setCargando(true); setMsg(null); setError(null);
    try {
      // Asegurar SheetJS
      if (!window.XLSX) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js";
          s.onload = res; s.onerror = rej; document.head.appendChild(s);
        });
      }
      const XLSX = window.XLSX;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const hoja = wb.Sheets["DATOS"] || wb.Sheets[wb.SheetNames[0]];
      const arr = XLSX.utils.sheet_to_json(hoja, { defval: null });

      // Mapeo por nombre de columna (formato estable del reporte)
      const norm = s => String(s ?? "").trim();
      const filas = arr.map(r => ({
        svc:            norm(r["SVC"]),
        nombre:         norm(r["Nombres"]),
        cargo:          norm(r["CARGO"]),
        empresa:        norm(r["EMPRESA"]),
        fecha_llegada:  aFecha(r["F. LLEGADA"]),
        enviado_meli:   aFecha(r["ENVIADO MELI"]),
        respuesta_meli: norm(r["RESPUESTA MELI"]).toUpperCase(),
        respuesta_at:   aFecha(r["H. RESPUESTA MELI"]),
        validacion_bt:  norm(r["VALIDACION BIGTICKET"]),
        rfc:            norm(r["RFC"]),
        curp:           norm(r["CURP"]).toUpperCase(),
        email:          norm(r["Email"]),
        telefono:       norm(r["Teléfono"]),
        lote:           new Date().toISOString().slice(0, 10),
      })).filter(f => f.curp || f.nombre);

      if (filas.length === 0) throw new Error("No se encontraron filas en la hoja DATOS. ¿El archivo tiene el formato esperado?");

      // REEMPLAZAR: borrar todo e insertar lo nuevo
      const { error: eDel } = await sb.from("meli_validacion_tripulaciones").delete().neq("id", -1);
      if (eDel) throw new Error("No pude limpiar la tabla: " + eDel.message);
      for (let i = 0; i < filas.length; i += 200) {
        const { error: eIns } = await sb.from("meli_validacion_tripulaciones").insert(filas.slice(i, i + 200));
        if (eIns) throw new Error("Error al insertar: " + eIns.message);
      }
      const rech = filas.filter(f => f.respuesta_meli === "RECHAZADO").length;
      setMsg(`✓ Cargadas ${filas.length} filas (${rech} rechazados). Cruzando con el padrón…`);
      await cargar();
      setMsg(`✓ Carga completa: ${filas.length} filas · ${rech} rechazados. Tabla actualizada.`);
    } catch (err) {
      setError(err.message || "Error al procesar el archivo");
    } finally {
      setCargando(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Dedup por CURP: la vista trae filas repetidas cuando una persona tiene
  // más de un driver_id en el padrón (universos MELI rostering vs operación).
  // Colapsamos a una fila por persona tomando el máximo de actividad.
  const rowsUnicas = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = String(r.curp ?? "").toUpperCase().trim();
      const prev = m.get(k);
      if (!prev) { m.set(k, { ...r }); continue; }
      prev.viajes_ayer = Math.max(prev.viajes_ayer || 0, r.viajes_ayer || 0);
      prev.viajes_7d   = Math.max(prev.viajes_7d   || 0, r.viajes_7d   || 0);
      prev.viajes_15d  = Math.max(prev.viajes_15d  || 0, r.viajes_15d  || 0);
      prev.viajes_30d  = Math.max(prev.viajes_30d  || 0, r.viajes_30d  || 0);
      prev.esta_en_padron = prev.esta_en_padron || r.esta_en_padron;
      if (!prev.driver_id && r.driver_id) prev.driver_id = r.driver_id;
      if (r.ultimo_viaje && (!prev.ultimo_viaje || r.ultimo_viaje > prev.ultimo_viaje)) {
        prev.ultimo_viaje = r.ultimo_viaje;
        prev.sc_ultimo = r.sc_ultimo;
        prev.supervisor_ultimo = r.supervisor_ultimo;
      }
    }
    return [...m.values()];
  }, [rows]);

  const kpis = useMemo(() => ({
    total: rowsUnicas.length,
    en_padron: rowsUnicas.filter(r => r.esta_en_padron).length,
    con_act: rowsUnicas.filter(r => r.viajes_30d > 0).length,
    ayer: rowsUnicas.filter(r => r.viajes_ayer > 0).length,
    semana: rowsUnicas.filter(r => r.viajes_7d > 0).length,
  }), [rowsUnicas]);

  const filtradas = useMemo(() => {
    let res = rowsUnicas;
    if (soloActivos) res = res.filter(r => r.viajes_30d > 0);
    const q = busqueda.toLowerCase().trim();
    if (q) res = res.filter(r =>
      [r.curp, r.driver_id, r.nombre, r.empresa, r.sc_ultimo, r.supervisor_ultimo].some(v => String(v ?? "").toLowerCase().includes(q)));
    // orden: viajes_30d desc
    return [...res].sort((a, b) => (b.viajes_30d || 0) - (a.viajes_30d || 0));
  }, [rowsUnicas, busqueda, soloActivos]);

  const exportar = () => {
    const headers = ["CURP", "ID conductor", "Nombre", "Empresa", "SC último", "Supervisor último",
      "Último viaje", "Viajes ayer", "Viajes 7d", "Viajes 15d", "Viajes 30d"];
    const filas = filtradas.map(r => [r.curp, r.driver_id ?? "", r.nombre || "", r.empresa || "",
      r.sc_ultimo || "", r.supervisor_ultimo || "", r.ultimo_viaje || "",
      r.viajes_ayer, r.viajes_7d, r.viajes_15d, r.viajes_30d]);
    padronCsv(headers, filas, "rechazados_meli");
  };

  return (
    <div style={{ padding: 20 }}>
      {/* Barra de carga */}
      <div style={{ background: "#fff", border: `1px solid ${PBORDER}`, borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: PNAVY }}>Validación de tripulaciones</div>
          <div style={{ fontSize: 11, color: PMUTED }}>Cargá el Excel de validación. Reemplaza la carga anterior y vuelve a cruzar con el padrón.</div>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onArchivo} style={{ display: "none" }} id="rech-file" />
        <button onClick={() => fileRef.current && fileRef.current.click()} disabled={cargando} style={{
          fontSize: 12, fontWeight: 700, padding: "9px 16px", borderRadius: 8, border: "none",
          background: cargando ? "#94a3b8" : "#F47B20", color: "#fff", cursor: cargando ? "default" : "pointer",
          fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <i className={`ti ${cargando ? "ti-loader-2" : "ti-upload"}`} style={{ fontSize: 15 }} />
          {cargando ? "Procesando…" : "Cargar Excel"}
        </button>
      </div>
      {msg && <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#065f46", marginBottom: 12 }}>{msg}</div>}
      {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#991b1b", marginBottom: 12 }}>{error}</div>}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
        <PKpi l="Rechazados (total)" v={kpis.total} s={`únicos por CURP · ${kpis.en_padron} en el padrón`} accent={PNAVY} />
        <PKpi l="Con actividad 30d" v={kpis.con_act} s="rechazados que operaron" accent="#d97706" />
        <PKpi l="⚠️ Operaron ayer" v={kpis.ayer} s="rechazados en ruta ayer" accent="#c0392b" />
        <PKpi l="Operaron 7 días" v={kpis.semana} s="actividad reciente" accent="#d97706" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por CURP, nombre, empresa, SC, supervisor…"
          style={{ flex: 1, minWidth: 240, maxWidth: 400, padding: "7px 10px", border: "1px solid #d0d5dd", borderRadius: 6, fontSize: 12, fontFamily: "'Geist', sans-serif" }} />
        <button onClick={() => setSoloActivos(v => !v)} style={{
          fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, cursor: "pointer",
          border: soloActivos ? "none" : `1px solid ${PBORDER}`,
          background: soloActivos ? "#c0392b" : "#fff", color: soloActivos ? "#fff" : PMUTED,
          fontFamily: "'Geist', sans-serif",
        }}>{soloActivos ? `Solo con viajes (${kpis.con_act})` : "Solo con viajes"}</button>
        <span style={{ fontSize: 12, color: PMUTED }}>{filtradas.length} de {rowsUnicas.length}</span>
        <button onClick={exportar} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, padding: "6px 11px", borderRadius: 6, border: "none", background: PNAVY, color: "#fff", cursor: "pointer", fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i className="ti ti-download" style={{ fontSize: 12 }} />Exportar CSV
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: PMUTED, fontSize: 13 }}>Cargando…</div>
      ) : rowsUnicas.length === 0 ? (
        <div style={{ background: "#fff", border: `1px dashed ${PBORDER}`, borderRadius: 10, padding: 40, textAlign: "center", color: PLIGHT, fontSize: 13 }}>
          No hay datos de validación cargados. Usá "Cargar Excel" para subir el archivo de tripulaciones.
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 12, border: `0.5px solid ${PBORDER}`, overflow: "hidden" }}>
          <div style={{ maxHeight: "55vh", overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#f8fafc" }}>
                <tr>
                  <ApTh>CURP</ApTh><ApTh>ID</ApTh><ApTh>Nombre</ApTh><ApTh>Empresa</ApTh><ApTh>Rol</ApTh>
                  <ApTh>SC último</ApTh><ApTh>Supervisor último</ApTh><ApTh>Último viaje</ApTh>
                  <ApTh>Ayer</ApTh><ApTh>7d</ApTh><ApTh>15d</ApTh><ApTh>30d</ApTh>
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 && (
                  <tr><td colSpan={12} style={{ padding: 30, textAlign: "center", color: PLIGHT }}>Sin resultados</td></tr>
                )}
                {filtradas.map((r, i) => {
                  const ayer = r.viajes_ayer > 0, sem = r.viajes_7d > 0;
                  const bg = ayer ? "#fbeceb" : sem ? "#fffbeb" : "transparent";
                  return (
                    <tr key={(r.curp || "") + (r.driver_id || i)} style={{ borderBottom: "0.5px solid #f4f5f7", background: bg }}>
                      <ApTd mono small>{r.curp}</ApTd>
                      <ApTd mono>{r.driver_id || <span style={{ color: PLIGHT }}>—</span>}</ApTd>
                      <ApTd bold>{r.nombre || "—"}</ApTd>
                      <ApTd small>{r.empresa || <span style={{ color: PLIGHT }}>—</span>}</ApTd>
                      <ApTd><PadronRolBadge value={r.is_only_helper} /></ApTd>
                      <ApTd center small>{r.sc_ultimo || <span style={{ color: PLIGHT }}>—</span>}</ApTd>
                      <ApTd small>{r.supervisor_ultimo || <span style={{ color: PLIGHT }}>—</span>}</ApTd>
                      <ApTd center small>{r.ultimo_viaje || <span style={{ color: PLIGHT }}>—</span>}</ApTd>
                      <ApTd center>{r.viajes_ayer > 0
                        ? <span style={{ color: "#c0392b", fontWeight: 800 }}>{r.viajes_ayer}</span>
                        : <span style={{ color: PLIGHT }}>0</span>}</ApTd>
                      <ApTd center>{r.viajes_7d || <span style={{ color: PLIGHT }}>0</span>}</ApTd>
                      <ApTd center>{r.viajes_15d || <span style={{ color: PLIGHT }}>0</span>}</ApTd>
                      <ApTd center bold>{r.viajes_30d || <span style={{ color: PLIGHT }}>0</span>}</ApTd>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 11, color: PLIGHT, fontStyle: "italic" }}>
        🔴 Fila roja = rechazado que operó <strong>ayer</strong> · 🟡 ámbar = operó en los últimos 7 días. El cruce es por CURP contra el padrón enriquecido; ventanas relativas a hoy.
      </div>
    </div>
  );
}

function PadronLimpieza() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEsc, setFiltroEsc] = useState(null); // escalón seleccionado del embudo
  const PNAVY = "#1a3a6b", PMUTED = "#64748b", PLIGHT = "#94a3b8", PBORDER = "#e4e7ec";

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error } = await sb.from("vw_padron_embudo").select("*").limit(5000);
        if (error) throw error;
        if (alive) setRows(data || []);
      } catch (e) { if (alive) setError(e.message || "Error"); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  // Definición del embudo (orden y etiquetas)
  const ESCALONES = [
    { id: "ayer",  label: "Operó ayer/hoy",   color: "#10b981" },
    { id: "7d",    label: "Últimos 7 días",   color: "#22c55e" },
    { id: "15d",   label: "Últimos 15 días",  color: "#84cc16" },
    { id: "30d",   label: "Últimos 30 días",  color: "#eab308" },
    { id: "45d",   label: "Últimos 45 días",  color: "#f59e0b" },
    { id: "60d",   label: "Últimos 60 días",  color: "#f97316" },
    { id: "mas60", label: "Inactivo +60 días", color: "#ef4444" },
    { id: "nunca", label: "Nunca operó",      color: "#991b1b" },
  ];

  const conteos = useMemo(() => {
    const c = {};
    ESCALONES.forEach(e => c[e.id] = 0);
    rows.forEach(r => { if (c[r.escalon] != null) c[r.escalon]++; });
    return c;
  }, [rows]);

  const alertas = useMemo(() => ({
    a7:  rows.filter(r => r.alerta === "alerta_7").length,
    a15: rows.filter(r => r.alerta === "alerta_15").length,
    a30: rows.filter(r => r.alerta === "alerta_30").length,
    dep: rows.filter(r => r.alerta === "depurar").length,
  }), [rows]);

  const maxC = useMemo(() => Math.max(1, ...ESCALONES.map(e => conteos[e.id] || 0)), [conteos]);

  const filtradas = useMemo(() => {
    let res = rows;
    if (filtroEsc) res = res.filter(r => r.escalon === filtroEsc);
    const q = busqueda.toLowerCase().trim();
    if (q) res = res.filter(r => [r.driver_id, r.nombre].some(v => String(v ?? "").toLowerCase().includes(q)));
    // orden: más inactivos primero (nunca arriba, luego por días desc)
    const rank = { nunca: 999, mas60: 998 };
    return [...res].sort((a, b) => {
      const ra = rank[a.escalon] ?? (a.dias_sin_operar || 0);
      const rb = rank[b.escalon] ?? (b.dias_sin_operar || 0);
      return rb - ra;
    });
  }, [rows, busqueda, filtroEsc]);

  const escMeta = (id) => ESCALONES.find(e => e.id === id) || { label: id, color: PMUTED };

  const exportar = () => {
    const headers = ["driver_id", "Nombre", "Estado", "Escalón", "Último viaje", "Días sin operar", "Total viajes", "Alerta"];
    const filas = filtradas.map(r => [r.driver_id, r.nombre || "", r.status, escMeta(r.escalon).label,
      r.ultimo_viaje || "", r.dias_sin_operar ?? "", r.total_viajes,
      r.alerta === "depurar" ? "DEPURAR" : r.alerta === "alerta_30" ? "+30 días" :
      r.alerta === "alerta_15" ? "+15 días" : r.alerta === "alerta_7" ? "+7 días" : "OK"]);
    padronCsv(headers, filas, "padron_limpieza");
  };

  // Descarga un Excel con TODOS los conductores, una hoja por escalón + resumen
  const descargarExcelPorEscalon = async () => {
    const H = ["ID conductor", "Nombre", "Estado", "Último viaje", "Días sin operar", "Total viajes"];
    const filaDe = r => [r.driver_id, r.nombre || "(sin nombre)", r.status, r.ultimo_viaje || "—",
      r.dias_sin_operar != null ? r.dias_sin_operar : "nunca", r.total_viajes || 0];

    // Hoja resumen (embudo)
    const resumen = [["Escalón", "Conductores", "% del padrón"]];
    ESCALONES.forEach(e => {
      const n = conteos[e.id] || 0;
      resumen.push([e.label, n, (total ? Math.round(100 * n / total) : 0) + "%"]);
    });
    resumen.push(["", "", ""]);
    resumen.push(["TOTAL PADRÓN", total, "100%"]);
    resumen.push(["Candidatos a depurar (nunca + +60d)", depurar, ""]);
    resumen.push(["Activos (≤60 días)", activos, ""]);

    const hojas = [{ nombre: "Resumen embudo", datos: resumen }];

    // Una hoja por escalón (ordenado del más activo al más inactivo)
    ESCALONES.forEach(e => {
      const grupo = rows
        .filter(r => r.escalon === e.id)
        .sort((a, b) => (b.dias_sin_operar || 0) - (a.dias_sin_operar || 0));
      const datos = [H, ...grupo.map(filaDe)];
      if (grupo.length === 0) datos.push(["(sin conductores en este escalón)", "", "", "", "", ""]);
      // nombre de hoja: Excel no admite > 31 chars ni ciertos símbolos
      const nombreHoja = `${e.label} (${grupo.length})`.replace(/[\\/?*:\[\]]/g, "").slice(0, 31);
      hojas.push({ nombre: nombreHoja, datos });
    });

    await descargarExcelMultihoja(hojas, "padron_limpieza_por_escalon");
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: PMUTED, fontSize: 13 }}>Cargando embudo…</div>;
  if (error) return <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 14, fontSize: 12, color: "#991b1b" }}>{error}</div>;

  const total = rows.length;
  const activos = (conteos.ayer || 0) + (conteos["7d"] || 0) + (conteos["15d"] || 0) + (conteos["30d"] || 0) + (conteos["45d"] || 0) + (conteos["60d"] || 0);
  const depurar = (conteos.nunca || 0) + (conteos.mas60 || 0);

  return (
    <div style={{ padding: 20 }}>
      {/* KPIs + alertas */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <PKpi l="Padrón total" v={total} s="conductores en snapshot" accent={PNAVY} />
        <PKpi l="Activos (≤60 días)" v={activos} s="operaron en el período" accent="#10b981" />
        <PKpi l="⚠️ Candidatos a depurar" v={depurar} s="nunca operó o +60 días" accent="#ef4444" />
        <PKpi l="Alerta +30 días" v={alertas.a30} s="sin operar (revisar)" accent="#f59e0b" />
      </div>

      {/* EMBUDO */}
      <div style={{ background: "#fff", border: `1px solid ${PBORDER}`, borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: PNAVY, marginBottom: 12 }}>Embudo de actividad
          <span style={{ fontWeight: 400, color: PLIGHT, fontSize: 11, marginLeft: 8 }}>· clic en un escalón para filtrar la tabla</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ESCALONES.map(e => {
            const n = conteos[e.id] || 0;
            const pct = Math.round((n / maxC) * 100);
            const sel = filtroEsc === e.id;
            return (
              <div key={e.id} onClick={() => setFiltroEsc(sel ? null : e.id)}
                style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", opacity: filtroEsc && !sel ? 0.5 : 1 }}>
                <div style={{ width: 130, fontSize: 12, fontWeight: sel ? 800 : 600, color: sel ? e.color : PMUTED, textAlign: "right", flexShrink: 0 }}>{e.label}</div>
                <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 6, height: 26, position: "relative", overflow: "hidden" }}>
                  <div style={{ width: `${Math.max(pct, n > 0 ? 4 : 0)}%`, height: "100%", background: e.color, borderRadius: 6, transition: "width .3s", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 8 }}>
                    {pct > 12 && <span style={{ color: "#fff", fontSize: 11, fontWeight: 800 }}>{n}</span>}
                  </div>
                  {pct <= 12 && <span style={{ position: "absolute", left: `calc(${Math.max(pct,4)}% + 6px)`, top: 5, fontSize: 11, fontWeight: 800, color: e.color }}>{n}</span>}
                </div>
                <div style={{ width: 42, fontSize: 11, color: PLIGHT, textAlign: "left", flexShrink: 0 }}>{total ? Math.round(100*n/total) : 0}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Banda de alertas de limpieza */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { k: "alerta_7",  label: "+7 días sin operar",  n: alertas.a7,  c: "#eab308" },
          { k: "alerta_15", label: "+15 días sin operar", n: alertas.a15, c: "#f59e0b" },
          { k: "alerta_30", label: "+30 días sin operar", n: alertas.a30, c: "#f97316" },
          { k: "depurar",   label: "Nunca operó",         n: alertas.dep, c: "#ef4444" },
        ].map(a => (
          <div key={a.k} style={{ flex: 1, minWidth: 140, background: "#fff", border: `1px solid ${PBORDER}`, borderLeft: `4px solid ${a.c}`, borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: a.c }}>{a.n}</div>
            <div style={{ fontSize: 11, color: PMUTED }}>{a.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre o ID…"
          style={{ flex: 1, minWidth: 220, maxWidth: 360, padding: "7px 10px", border: "1px solid #d0d5dd", borderRadius: 6, fontSize: 12, fontFamily: "'Geist', sans-serif" }} />
        {filtroEsc && (
          <button onClick={() => setFiltroEsc(null)} style={{ fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, cursor: "pointer", border: "none", background: escMeta(filtroEsc).color, color: "#fff", fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 6 }}>
            {escMeta(filtroEsc).label} <i className="ti ti-x" style={{ fontSize: 13 }} />
          </button>
        )}
        <span style={{ fontSize: 12, color: PMUTED }}>{filtradas.length} de {total}</span>
        <button onClick={descargarExcelPorEscalon} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 6, border: "none", background: "#1f7a4d", color: "#fff", cursor: "pointer", fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i className="ti ti-file-spreadsheet" style={{ fontSize: 13 }} />Excel por escalón
        </button>
        <button onClick={exportar} style={{ fontSize: 11, fontWeight: 600, padding: "6px 11px", borderRadius: 6, border: `1px solid ${PBORDER}`, background: "#fff", color: PMUTED, cursor: "pointer", fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i className="ti ti-download" style={{ fontSize: 12 }} />CSV vista
        </button>
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", borderRadius: 12, border: `0.5px solid ${PBORDER}`, overflow: "hidden" }}>
        <div style={{ maxHeight: "50vh", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#f8fafc" }}>
              <tr>
                <ApTh>ID conductor</ApTh><ApTh>Nombre</ApTh><ApTh>Rol</ApTh><ApTh>Escalón</ApTh>
                <ApTh>Último viaje</ApTh><ApTh>Días sin operar</ApTh><ApTh>Total viajes</ApTh>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: PLIGHT }}>Sin resultados</td></tr>
              )}
              {filtradas.map((r, i) => {
                const meta = escMeta(r.escalon);
                const depurar = r.escalon === "nunca" || r.escalon === "mas60";
                return (
                  <tr key={r.driver_id ?? i} style={{ borderBottom: "0.5px solid #f4f5f7", background: depurar ? "#fef2f2" : "transparent" }}>
                    <ApTd mono>{r.driver_id}</ApTd>
                    <ApTd bold>{r.nombre || <span style={{ color: PLIGHT }}>(sin nombre)</span>}</ApTd>
                    <ApTd><PadronRolBadge value={r.is_only_helper} /></ApTd>
                    <ApTd>
                      <span style={{ background: meta.color + "22", color: meta.color, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>{meta.label}</span>
                    </ApTd>
                    <ApTd center small>{r.ultimo_viaje || <span style={{ color: PLIGHT }}>—</span>}</ApTd>
                    <ApTd center>{r.dias_sin_operar != null
                      ? <span style={{ fontWeight: depurar ? 800 : 400, color: depurar ? "#ef4444" : "inherit" }}>{r.dias_sin_operar}</span>
                      : <span style={{ color: "#ef4444", fontWeight: 800 }}>nunca</span>}</ApTd>
                    <ApTd center>{r.total_viajes || <span style={{ color: PLIGHT }}>0</span>}</ApTd>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: PLIGHT, fontStyle: "italic" }}>
        ℹ️ Combina histórico cargado + operación diaria. Filas en rojo = candidatos a depurar (nunca operó o +60 días sin operar). Ventanas relativas a hoy; se actualiza solo con los viajes diarios.
      </div>
    </div>
  );
}

function PadronMeliAdmin({ usuario }) {
  const [mundo, setMundo] = useState("drivers"); // drivers (principal) | vehiculos
  return (
    <div style={{ fontFamily: "'Geist', sans-serif", background: "#f0f2f5", minHeight: "60vh" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "10px 24px", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginRight: 4 }}>Padrón MELI</span>
        {[
          { id: "drivers", label: "Conductores", icon: "ti-user" },
          { id: "vehiculos", label: "Vehículos", icon: "ti-truck" },
          { id: "cursos", label: "Cursos", icon: "ti-school" },
          { id: "rechazados", label: "Rechazados", icon: "ti-user-x" },
          { id: "limpieza", label: "Limpieza", icon: "ti-filter" },
        ].map(m => (
          <button key={m.id} onClick={() => setMundo(m.id)} style={{
            border: "none", cursor: "pointer", padding: "7px 16px", borderRadius: 8,
            fontSize: 13, fontWeight: 700, fontFamily: "'Geist', sans-serif",
            background: mundo === m.id ? "#1a3a6b" : "#eef2f7",
            color: mundo === m.id ? "#fff" : "#64748b",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <i className={`ti ${m.icon}`} style={{ fontSize: 15 }} />{m.label}
          </button>
        ))}
      </div>
      {mundo === "cursos" ? <PadronCursos key="cursos" />
        : mundo === "rechazados" ? <PadronRechazados key="rechazados" />
        : mundo === "limpieza" ? <PadronLimpieza key="limpieza" />
        : <PadronMundo key={mundo} tipo={mundo} />}
    </div>
  );
}

function PadronMundo({ tipo }) {
  const cfg = PADRON_CFG[tipo];
  const [vista, setVista] = useState("data"); // data | altasbajas | repetidas | cambios
  const [fechasDisp, setFechasDisp] = useState([]);
  const [fechaSel, setFechaSel] = useState(null);       // data + repetidas
  const [fechaA, setFechaA] = useState(null);           // altas/bajas A
  const [fechaB, setFechaB] = useState(null);           // altas/bajas B
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");

  const [dataRows, setDataRows] = useState([]);
  const [diffRows, setDiffRows] = useState([]);
  const [repRows, setRepRows] = useState([]);
  const [cambiosDia, setCambiosDia] = useState([]);   // [{fecha, altas, bajas, cambios, rows}]
  const [diaDetalle, setDiaDetalle] = useState(null); // fecha seleccionada en "cambios"

  // 1) Fechas disponibles
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error } = await sb
          .from(cfg.tabla)
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(5000);
        if (error) throw error;
        const fechas = [...new Set((data || []).map(f => f.fecha_snapshot))];
        if (!alive) return;
        setFechasDisp(fechas);
        setFechaSel(fechas[0] || null);
        setFechaB(fechas[0] || null);
        setFechaA(fechas[1] || fechas[0] || null);
      } catch (e) {
        if (alive) { setError(e.message || "Error cargando fechas"); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [tipo]);

  // 2) Data completa del snapshot seleccionado
  useEffect(() => {
    if (vista !== "data" || !fechaSel || tipo === "drivers") return;
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error } = await sb
          .from(cfg.tabla).select(cfg.selectData)
          .eq("fecha_snapshot", fechaSel).limit(5000);
        if (error) throw error;
        if (alive) setDataRows(data || []);
      } catch (e) { if (alive) setError(e.message || "Error"); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [vista, fechaSel, tipo]);

  // 3) Altas / bajas / cambios entre A y B
  useEffect(() => {
    if (vista !== "altasbajas" || !fechaA || !fechaB) return;
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error } = await sb.rpc(cfg.rpcDiff, { fecha_a: fechaA, fecha_b: fechaB });
        if (error) throw error;
        if (alive) setDiffRows(data || []);
      } catch (e) { if (alive) setError(e.message || "Error"); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [vista, fechaA, fechaB, tipo]);

  // 4) Placas repetidas SDD (solo vehículos)
  useEffect(() => {
    if (vista !== "repetidas" || !cfg.tieneRepetidas || !fechaSel) return;
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error } = await sb
          .from(cfg.tabla)
          .select("vehicle_id,placa,tipo_nombre,capacidad,es_sdd")
          .eq("fecha_snapshot", fechaSel).limit(5000);
        if (error) throw error;
        const norm = p => String(p || "").replace(/^SDD-/, "");
        const baseTipo = t => String(t || "").replace(/\s*SDD$/i, "").trim();
        const grupos = {};
        (data || []).forEach(r => {
          const k = norm(r.placa);
          (grupos[k] = grupos[k] || []).push(r);
        });
        const out = Object.keys(grupos).filter(k => grupos[k].length > 1).map(k => {
          const items = grupos[k].sort((a, b) => (a.es_sdd === b.es_sdd ? 0 : a.es_sdd ? 1 : -1));
          const tiposBase = new Set(items.map(i => baseTipo(i.tipo_nombre)));
          return {
            placa_norm: k,
            variantes: items.length,
            mismo_tipo: tiposBase.size === 1,
            detalle: items.map(i => `${i.placa} = ${i.tipo_nombre}`).join("  |  "),
            items,
          };
        }).sort((a, b) => (a.mismo_tipo === b.mismo_tipo ? a.placa_norm.localeCompare(b.placa_norm) : a.mismo_tipo ? 1 : -1));
        if (alive) setRepRows(out);
      } catch (e) { if (alive) setError(e.message || "Error"); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [vista, fechaSel, tipo]);

  // 5) Cambios por día (últimos 30 pares consecutivos)
  useEffect(() => {
    if (vista !== "cambios" || fechasDisp.length < 2) return;
    let alive = true;
    (async () => {
      setLoading(true); setError(null); setDiaDetalle(null);
      try {
        const asc = [...fechasDisp].sort();
        const pares = [];
        for (let i = 1; i < asc.length; i++) pares.push([asc[i - 1], asc[i]]);
        const ultimos = pares.slice(-30);
        const res = await Promise.all(ultimos.map(([a, b]) =>
          sb.rpc(cfg.rpcDiff, { fecha_a: a, fecha_b: b })
            .then(r => ({ a, b, rows: r.data || [] }))
        ));
        const filas = res.map(({ a, b, rows }) => ({
          fecha: b, prev: a,
          altas: rows.filter(x => x.tipo_cambio === "alta").length,
          bajas: rows.filter(x => x.tipo_cambio === "baja").length,
          cambios: rows.filter(x => cfg.cambioTipos.includes(x.tipo_cambio)).length,
          rows,
        })).sort((x, y) => (x.fecha < y.fecha ? 1 : -1));
        if (alive) setCambiosDia(filas);
      } catch (e) { if (alive) setError(e.message || "Error"); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [vista, fechasDisp, tipo]);

  // ── derivados ──
  const altas = useMemo(() => diffRows.filter(r => r.tipo_cambio === "alta"), [diffRows]);
  const bajas = useMemo(() => diffRows.filter(r => r.tipo_cambio === "baja"), [diffRows]);
  const cambios = useMemo(() => diffRows.filter(r => cfg.cambioTipos.includes(r.tipo_cambio)), [diffRows, tipo]);

  const dataFiltrada = useMemo(() => {
    if (!busqueda.trim()) return dataRows;
    const q = busqueda.toLowerCase().trim();
    return dataRows.filter(r => cfg.cols.some(c => String(r[c] ?? "").toLowerCase().includes(q)));
  }, [dataRows, busqueda, tipo]);

  const PNAVY = "#1a3a6b", PMUTED = "#64748b", PLIGHT = "#94a3b8", PBORDER = "#e4e7ec", PORANGE = "#F47B20";

  const subTabs = [
    { id: "data", label: "Data completa", icon: "ti-table" },
    { id: "altasbajas", label: "Altas y bajas", icon: "ti-arrows-diff" },
    ...(cfg.tieneRepetidas ? [{ id: "repetidas", label: "Placas repetidas (SDD)", icon: "ti-copy" }] : []),
    { id: "cambios", label: "Cambios por día", icon: "ti-history" },
  ];

  const selStyle = {
    fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 6,
    border: `1px solid ${PBORDER}`, background: "#fff", color: PNAVY,
    fontFamily: "'Geist', sans-serif", cursor: "pointer", outline: "none",
  };

  return (
    <div>
      {/* Sub-tabs de vista */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${PBORDER}`, padding: "0 24px", display: "flex", gap: 0, flexWrap: "wrap" }}>
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setVista(t.id)} style={{
            background: "transparent", border: "none", padding: "11px 16px", cursor: "pointer",
            fontSize: 12.5, fontWeight: 600, color: vista === t.id ? PNAVY : PMUTED,
            borderBottom: vista === t.id ? `2px solid ${PORANGE}` : "2px solid transparent",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 14 }} />{t.label}
          </button>
        ))}
      </div>

      {/* Toolbar de fechas según vista */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${PBORDER}`, padding: "10px 24px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {(vista === "data" || vista === "repetidas") && (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, color: PMUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>Snapshot</span>
            <select value={fechaSel || ""} onChange={e => setFechaSel(e.target.value)} style={selStyle}>
              {fechasDisp.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </>
        )}
        {vista === "altasbajas" && (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, color: PMUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>Comparar</span>
            <select value={fechaA || ""} onChange={e => setFechaA(e.target.value)} style={selStyle}>
              {fechasDisp.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <span style={{ color: PLIGHT }}>→</span>
            <select value={fechaB || ""} onChange={e => setFechaB(e.target.value)} style={selStyle}>
              {fechasDisp.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </>
        )}
        <div style={{ marginLeft: "auto", fontSize: 11, color: PMUTED, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
          Última: <strong style={{ color: PNAVY }}>{fechasDisp[0] || "—"}</strong>
          <span style={{ color: PLIGHT }}>· cron 08:00 MX</span>
        </div>
      </div>

      <div style={{ padding: "16px 24px" }}>
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 12, color: "#991b1b" }}>
            {error}
          </div>
        )}
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: PMUTED, fontSize: 13 }}>Cargando padrón de {cfg.label}…</div>
        ) : (
          <>
            {/* ── DATA COMPLETA ── */}
            {vista === "data" && (
              tipo === "drivers" ? (
                <PadronDriversData fecha={fechaSel} />
              ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder={`Buscar en ${dataRows.length} ${cfg.label}…`}
                    style={{ flex: 1, maxWidth: 360, padding: "7px 10px", border: `1px solid #d0d5dd`, borderRadius: 6, fontSize: 12, fontFamily: "'Geist', sans-serif" }} />
                  <span style={{ fontSize: 12, color: PMUTED }}>{dataFiltrada.length} de {dataRows.length}</span>
                  <button onClick={() => padronCsv(cfg.cols, dataFiltrada.map(r => cfg.cols.map(c => padronFmt(r[c]))), `padron_${tipo}`)}
                    style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, padding: "6px 11px", borderRadius: 6, border: "none", background: PNAVY, color: "#fff", cursor: "pointer", fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <i className="ti ti-download" style={{ fontSize: 12 }} />Exportar CSV
                  </button>
                </div>
                <div style={{ background: "#fff", borderRadius: 12, border: `0.5px solid ${PBORDER}`, overflow: "hidden" }}>
                  <div style={{ maxHeight: "62vh", overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#f8fafc" }}>
                        <tr>{cfg.cols.map(c => <ApTh key={c}>{c}</ApTh>)}</tr>
                      </thead>
                      <tbody>
                        {dataFiltrada.length === 0 && (
                          <tr><td colSpan={cfg.cols.length} style={{ padding: 30, textAlign: "center", color: PLIGHT }}>Sin resultados</td></tr>
                        )}
                        {dataFiltrada.map((r, i) => (
                          <tr key={i} style={{ borderBottom: "0.5px solid #f4f5f7" }}>
                            {cfg.cols.map(c => (
                              <ApTd key={c} mono={["driver_id", "vehicle_id", "carrier_id", "document_value", "placa", "tipo_id", "amount_plate"].includes(c)} small>
                                {c === "status" ? (
                                  <span style={{ background: r[c] === "active" ? "#d1fae5" : "#fef3c7", color: r[c] === "active" ? "#065f46" : "#92400e", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>{padronFmt(r[c])}</span>
                                ) : padronFmt(r[c])}
                              </ApTd>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              )
            )}

            {/* ── ALTAS Y BAJAS ── */}
            {vista === "altasbajas" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
                  <PKpi l="➕ Altas" v={altas.length} s={`nuevos en ${fechaB}`} accent="#10b981" />
                  <PKpi l="➖ Bajas" v={bajas.length} s={`removidos vs ${fechaA}`} accent="#dc2626" />
                  <PKpi l="🔄 Cambios" v={cambios.length} s="status / tipo / carrier" accent={PORANGE} />
                </div>
                <PadronDiffTabla titulo="Altas" rows={altas} cols={cfg.diffCols} tipo={tipo} archivo={`altas_${tipo}`} vacio="Sin altas entre las fechas" />
                <div style={{ height: 14 }} />
                <PadronDiffTabla titulo="Bajas" rows={bajas} cols={cfg.diffCols} tipo={tipo} archivo={`bajas_${tipo}`} vacio="Sin bajas entre las fechas" />
                {cambios.length > 0 && (
                  <>
                    <div style={{ height: 14 }} />
                    <PadronDiffTabla titulo="Cambios" rows={cambios} cols={cfg.diffCols} tipo={tipo} archivo={`cambios_${tipo}`} vacio="Sin cambios" />
                  </>
                )}
              </div>
            )}

            {/* ── PLACAS REPETIDAS SDD ── */}
            {vista === "repetidas" && cfg.tieneRepetidas && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
                  <PKpi l="Placas con doble registro" v={repRows.length} s="normal + SDD el mismo día" accent={PNAVY} />
                  <PKpi l="Mismo tipo base" v={repRows.filter(r => r.mismo_tipo).length} s="solo difieren en SDD" accent="#10b981" />
                  <PKpi l="⚠️ Tipo distinto" v={repRows.filter(r => !r.mismo_tipo).length} s="normal vs SDD difieren" accent="#dc2626" />
                </div>
                <div style={{ background: "#fff", borderRadius: 12, border: `0.5px solid ${PBORDER}`, overflow: "hidden" }}>
                  <div style={{ padding: "8px 14px", borderBottom: `1px solid ${PBORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: PMUTED }}>{repRows.length} placas con variante normal + SDD · snapshot {fechaSel}</div>
                    <button onClick={() => padronCsv(["placa", "variantes", "mismo_tipo_base", "detalle"], repRows.map(r => [r.placa_norm, r.variantes, r.mismo_tipo ? "Sí" : "No", r.detalle]), "placas_repetidas_sdd")}
                      style={{ fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 6, border: "none", background: PNAVY, color: "#fff", cursor: "pointer", fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <i className="ti ti-download" style={{ fontSize: 12 }} />Exportar CSV
                    </button>
                  </div>
                  <div style={{ maxHeight: "58vh", overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#f8fafc" }}>
                        <tr><ApTh>Placa</ApTh><ApTh>Variantes</ApTh><ApTh>Tipo base</ApTh><ApTh>Detalle (placa = tipo)</ApTh></tr>
                      </thead>
                      <tbody>
                        {repRows.length === 0 && (
                          <tr><td colSpan={4} style={{ padding: 30, textAlign: "center", color: PLIGHT }}>Sin placas repetidas en este snapshot</td></tr>
                        )}
                        {repRows.map((r, i) => (
                          <tr key={i} style={{ borderBottom: "0.5px solid #f4f5f7", background: r.mismo_tipo ? "transparent" : "#fff7ed" }}>
                            <ApTd mono bold>{r.placa_norm}</ApTd>
                            <ApTd center>{r.variantes}</ApTd>
                            <ApTd>
                              <span style={{ background: r.mismo_tipo ? "#d1fae5" : "#fee2e2", color: r.mismo_tipo ? "#065f46" : "#991b1b", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>
                                {r.mismo_tipo ? "Mismo" : "DISTINTO"}
                              </span>
                            </ApTd>
                            <ApTd small>{r.detalle}</ApTd>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: PLIGHT, fontStyle: "italic" }}>
                  ℹ️ Las marcadas <strong style={{ color: "#991b1b" }}>DISTINTO</strong> tienen la variante SDD con un tipo base diferente al normal (ej. Large vs Small) — conviene revisarlas en MELI.
                </div>
              </div>
            )}

            {/* ── CAMBIOS POR DÍA ── */}
            {vista === "cambios" && (
              <div>
                <div style={{ background: "#fff", borderRadius: 12, border: `0.5px solid ${PBORDER}`, overflow: "hidden", marginBottom: 14 }}>
                  <div style={{ padding: "8px 14px", borderBottom: `1px solid ${PBORDER}`, fontSize: 11, color: PMUTED }}>
                    Cambios día a día (cada fila compara contra el snapshot anterior disponible) · clic en una fila para ver el detalle
                  </div>
                  <div style={{ maxHeight: "40vh", overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#f8fafc" }}>
                        <tr><ApTh>Día</ApTh><ApTh>vs</ApTh><ApTh>➕ Altas</ApTh><ApTh>➖ Bajas</ApTh><ApTh>🔄 Cambios</ApTh></tr>
                      </thead>
                      <tbody>
                        {cambiosDia.length === 0 && (
                          <tr><td colSpan={5} style={{ padding: 30, textAlign: "center", color: PLIGHT }}>Sin historial suficiente</td></tr>
                        )}
                        {cambiosDia.map((d, i) => (
                          <tr key={i} onClick={() => setDiaDetalle(diaDetalle === d.fecha ? null : d.fecha)}
                            style={{ borderBottom: "0.5px solid #f4f5f7", cursor: "pointer", background: diaDetalle === d.fecha ? "#eff6ff" : "transparent" }}>
                            <ApTd mono bold>{d.fecha}</ApTd>
                            <ApTd mono small muted>{d.prev}</ApTd>
                            <ApTd center><span style={{ color: d.altas ? "#059669" : PLIGHT, fontWeight: 700 }}>{d.altas}</span></ApTd>
                            <ApTd center><span style={{ color: d.bajas ? "#dc2626" : PLIGHT, fontWeight: 700 }}>{d.bajas}</span></ApTd>
                            <ApTd center><span style={{ color: d.cambios ? PORANGE : PLIGHT, fontWeight: 700 }}>{d.cambios}</span></ApTd>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {diaDetalle && (() => {
                  const d = cambiosDia.find(x => x.fecha === diaDetalle);
                  if (!d) return null;
                  const det = d.rows;
                  return (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: PNAVY, marginBottom: 8 }}>
                        Detalle {d.prev} → {d.fecha}
                      </div>
                      <PadronDiffTabla titulo="Altas" rows={det.filter(r => r.tipo_cambio === "alta")} cols={cfg.diffCols} tipo={tipo} archivo={`altas_${tipo}_${d.fecha}`} vacio="Sin altas" />
                      <div style={{ height: 12 }} />
                      <PadronDiffTabla titulo="Bajas" rows={det.filter(r => r.tipo_cambio === "baja")} cols={cfg.diffCols} tipo={tipo} archivo={`bajas_${tipo}_${d.fecha}`} vacio="Sin bajas" />
                      <div style={{ height: 12 }} />
                      <PadronDiffTabla titulo="Cambios" rows={det.filter(r => cfg.cambioTipos.includes(r.tipo_cambio))} cols={cfg.diffCols} tipo={tipo} archivo={`cambios_${tipo}_${d.fecha}`} vacio="Sin cambios" />
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PadronDiffTabla({ titulo, rows, cols, tipo, archivo, vacio }) {
  const color = titulo === "Altas" ? "#10b981" : titulo === "Bajas" ? "#dc2626" : "#F47B20";
  const exportar = () => padronCsv(
    cols.map(c => c.l),
    rows.map(r => cols.map(c => r[c.k] == null ? "" : r[c.k])),
    archivo
  );
  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "0.5px solid #e4e7ec", overflow: "hidden" }}>
      <div style={{ padding: "8px 14px", borderBottom: "1px solid #e4e7ec", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
          {titulo} <span style={{ color: "#94a3b8", fontWeight: 600 }}>({rows.length})</span>
        </div>
        {rows.length > 0 && (
          <button onClick={exportar} style={{ fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 6, border: "none", background: "#1a3a6b", color: "#fff", cursor: "pointer", fontFamily: "'Geist', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <i className="ti ti-download" style={{ fontSize: 12 }} />CSV
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>{vacio}</div>
      ) : (
        <div style={{ maxHeight: "48vh", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#f8fafc" }}>
              <tr>{cols.map(c => <ApTh key={c.k}>{c.l}</ApTh>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: "0.5px solid #f4f5f7" }}>
                  {cols.map(c => (
                    <ApTd key={c.k} mono={c.mono} bold={c.bold} small={c.small} muted={c.muted}>
                      {c.badge ? (
                        <span style={{ background: r[c.k] === "active" ? "#d1fae5" : "#fef3c7", color: r[c.k] === "active" ? "#065f46" : "#92400e", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>{padronFmt(r[c.k])}</span>
                      ) : padronFmt(r[c.k])}
                    </ApTd>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PKpi({ l, v, s, accent }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e4e7ec', padding: 14 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{l}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || '#1a1a1a', letterSpacing: -0.5, lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>{s}</div>
    </div>
  );
}

function ApTh({ children }) {
  return <th style={{ padding: '8px 10px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', textAlign: 'left', borderBottom: '1px solid #e4e7ec', whiteSpace: 'nowrap' }}>{children}</th>;
}

function ApTd({ children, bold, muted, mono, center, small }) {
  return <td style={{ padding: '8px 10px', fontSize: small ? 11 : 12, fontFamily: mono ? 'monospace' : "'Geist', sans-serif", color: muted ? '#64748b' : '#1a1a1a', fontWeight: bold ? 600 : 'normal', textAlign: center ? 'center' : 'left' }}>{children}</td>;
}

const PREFACTURAS_WEBHOOK = "https://bigticket2026.app.n8n.cloud/webhook/prefacturas-enviar-mx";

const PAUSA_ENTRE_ENVIOS_MS = 1500;

const VARIABLES_PLANTILLA = [
  "TRANSPORTISTA", "CECO", "PERIODO", "RFC", "OPERACION", "SUPERVISOR",
];

const REGEX_CECO = /S[A-Z]{1,3}\d{1,2}/g;

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";

const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const LS_KEY_ASUNTO = "pref_mx_ultimo_asunto";

const LS_KEY_CUERPO = "pref_mx_ultimo_cuerpo";

const ASUNTO_DEFAULT = "Prefactura {CECO} — período {PERIODO} — {OPERACION}";

const CUERPO_DEFAULT = `Estimado(a) {TRANSPORTISTA},

Adjunto encontrará su prefactura correspondiente al período {PERIODO}, operación {CECO}.

Favor emitir su factura como máximo el día jueves XX/XX a las 12:00 Hrs para que esta pueda ser procesada y pagada el mismo XX-XX. En caso contrario, su pago será reagendado para el día lunes XX-XX.

En caso de presentar diferencias, favor notificar vía mail a su supervisor directo para que estas puedan ser validadas e informadas a nuestra área para reliquidación.

Quedamos a sus órdenes ante cualquier consulta.

Saludos cordiales,
Equipo BigTicket MX`;

function pf_correoValido(c) {
  if (!c) return false;
  return /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/.test(String(c).trim());
}

function pf_limpiarLista(s) {
  if (s == null) return { limpia: "", valida: true };
  const partes = String(s).split(/[;,]/).map(x => x.trim()).filter(Boolean);
  if (partes.length === 0) return { limpia: "", valida: true };
  return { limpia: partes.join("; "), valida: partes.every(pf_correoValido) };
}

function pf_fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function pf_aplicarPlantilla(template, vars) {
  if (!template) return "";
  let out = template;
  Object.entries(vars).forEach(([k, v]) => {
    const val = (v == null) ? "" : String(v);
    out = out.replace(new RegExp("\\{" + k + "\\}", "g"), val);
  });
  return out;
}

async function pf_cargarPDFJS() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PDFJS_CDN;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return window.pdfjsLib;
}

async function pf_extraerTextoPDF(file) {
  const pdfjs = await pf_cargarPDFJS();
  if (!pdfjs) throw new Error("No se pudo cargar PDF.js");
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let textoCompleto = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Reconstruir el texto preservando orden vertical y agregando espacios
    const items = content.items.map(it => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
    }));
    // Ordenar por Y descendente (arriba primero) y X ascendente
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    // Agrupar items por línea (mismo Y aproximado)
    const lineas = [];
    let lineaActual = [];
    let yPrev = null;
    const TOL = 3;
    for (const it of items) {
      if (yPrev === null || Math.abs(it.y - yPrev) <= TOL) {
        lineaActual.push(it);
      } else {
        if (lineaActual.length) lineas.push(lineaActual);
        lineaActual = [it];
      }
      yPrev = it.y;
    }
    if (lineaActual.length) lineas.push(lineaActual);
    const textoPag = lineas.map(l => l.map(x => x.str).join(" ")).join("\n");
    textoCompleto += textoPag + "\n";
  }
  return textoCompleto;
}

function pf_parsearPDF(texto) {
  const t = texto.replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ");

  // EMPRESA TRANSPORTE: nombre en mayúsculas, corta al encontrar RFC/RESUMEN/PATENTE/$/etc
  const reTransp = /EMPRESA\s+TRANSPORTE\s*:?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s\.]+?)(?=\s*(?:RFC\b|RESUMEN\b|OPERACI[ÓO]N\b|SUPERVISOR\b|PERIODO\b|MES\s+FACTURA\b|VALOR\s+UF\b|PATENTE\b|\$|\n|$))/i;
  const mTransp = t.match(reTransp);
  const transportista = mTransp ? mTransp[1].trim().replace(/\s+/g, " ") : "";

  // RFC EMPRESA TRANSPORTE
  const reRfc = /RFC\s+EMPRESA\s+TRANSPORTE\s*:?\s*([A-Z0-9]{10,15})/i;
  const mRfc = t.match(reRfc);
  const rfc = mRfc ? mRfc[1].trim().toUpperCase() : "";

  // OPERACIÓN: solo el token tipo ML_MXSMX7 (letras/dígitos/_), sin texto extra a la derecha
  const reOp = /OPERACI[ÓO]N\s*:?\s*([A-Z][A-Z0-9_]+)/i;
  const mOp = t.match(reOp);
  const operacion = mOp ? mOp[1].trim() : "";

  // SUPERVISOR: nombre en mayúsculas, corta al encontrar patrón de patente o label
  const reSup = /SUPERVISOR\s*:?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s\.]+?)(?=\s*(?:[A-Z]{3,}\d|PERIODO|MES|VALOR|\$|\n|$))/i;
  const mSup = t.match(reSup);
  const supervisorPDF = mSup ? mSup[1].trim().replace(/\s+/g, " ") : "";

  // PERIODO PREFACTURADO: formato "XX DE MES AL XX DE MES"
  const rePer = /PERIODO\s+PREFACTURADO\s*:?\s*(\d{1,2}\s+DE\s+[A-ZÁÉÍÓÚ]+\s+AL\s+\d{1,2}\s+DE\s+[A-ZÁÉÍÓÚ]+)/i;
  const mPer = t.match(rePer);
  const periodo = mPer ? mPer[1].trim().toUpperCase() : "";

  // CECO: dentro de OPERACIÓN primero (debe coincidir con SMX7 dentro de ML_MXSMX7),
  // luego en todo el texto como fallback
  let ceco = "";
  if (operacion) {
    const m = operacion.match(REGEX_CECO);
    if (m && m.length > 0) ceco = m[m.length - 1]; // el último match en la operación
  }
  if (!ceco) {
    const m = t.match(REGEX_CECO);
    if (m && m.length > 0) ceco = m[0];
  }

  return { transportista, rfc, operacion, supervisorPDF, periodo, ceco };
}

function ModuloPrefacturasMX({ usuario }) {
  const [subtab, setSubtab] = useState("envio");
  const [transportistas, setTransportistas] = useState([]);
  const [parametros, setParametros] = useState([]);
  const [cargando, setCargando] = useState(true);

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const [{ data: t }, { data: p }] = await Promise.all([
        sb.from("prefacturas_transportistas_mx").select("*").order("nombre"),
        sb.from("prefacturas_parametros_mx").select("*").order("ceco"),
      ]);
      setTransportistas(t || []);
      setParametros(p || []);
    } catch (e) {
      console.error("Error cargando datos prefacturas:", e);
    }
    setCargando(false);
  };

  useEffect(() => { cargarDatos(); }, []);

  const subtabs = [
    { id: "envio",          label: "Envío masivo",       icon: "📨" },
    { id: "transportistas", label: "Transportistas",     icon: "🚚" },
    { id: "parametros",     label: "Parámetros / CECOs", icon: "⚙️" },
    { id: "historial",      label: "Historial",          icon: "📋" },
  ];

  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {subtabs.map(t => (
            <button key={t.id} onClick={() => setSubtab(t.id)}
              style={{
                padding: "8px 16px", borderRadius: 8,
                border: `1px solid ${subtab === t.id ? "#1a3a6b" : "#e4e7ec"}`,
                background: subtab === t.id ? "#1a3a6b" : "#fff",
                color: subtab === t.id ? "#fff" : "#475569",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "Geist, sans-serif",
              }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {cargando ? (
        <div className="loading">Cargando configuración de prefacturas...</div>
      ) : (
        <>
          {subtab === "envio"          && <PrefEnvioMasivo transportistas={transportistas} parametros={parametros} usuario={usuario} onActualizarMaestros={cargarDatos} />}
          {subtab === "transportistas" && <PrefTransportistas data={transportistas} onChange={cargarDatos} />}
          {subtab === "parametros"     && <PrefParametros data={parametros} onChange={cargarDatos} />}
          {subtab === "historial"      && <PrefHistorial pais="MX" />}
        </>
      )}
    </div>
  );
}

function PrefEnvioMasivo({ transportistas, parametros, usuario, onActualizarMaestros }) {
  const [pdfsEnProceso, setPdfsEnProceso] = useState(0);
  const [filas, setFilas] = useState([]);          // [{ idx, file, parsed, ... }]
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 });
  const [editFila, setEditFila] = useState(null);
  const [logFinal, setLogFinal] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [modalAgregar, setModalAgregar] = useState(null);
  const pdfInputRef = useRef(null);

  // ★ Editor de asunto/cuerpo del lote (se aplica a TODOS los envíos)
  // Persiste en localStorage para que Esteban no tenga que reescribir cada vez
  const [asuntoLote, setAsuntoLote] = useState(() => {
    try { return localStorage.getItem(LS_KEY_ASUNTO) || ASUNTO_DEFAULT; }
    catch { return ASUNTO_DEFAULT; }
  });
  const [cuerpoLote, setCuerpoLote] = useState(() => {
    try { return localStorage.getItem(LS_KEY_CUERPO) || CUERPO_DEFAULT; }
    catch { return CUERPO_DEFAULT; }
  });

  // Guardar en localStorage cuando cambian
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_ASUNTO, asuntoLote); } catch {}
  }, [asuntoLote]);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_CUERPO, cuerpoLote); } catch {}
  }, [cuerpoLote]);

  // Lookups
  const transByNombre = useMemo(() => {
    const m = new Map();
    transportistas.forEach(t => m.set(String(t.nombre).toUpperCase().trim(), t));
    return m;
  }, [transportistas]);
  const paramsByCeco = useMemo(() => {
    const m = new Map();
    parametros.forEach(p => m.set(String(p.ceco).toUpperCase().trim(), p));
    return m;
  }, [parametros]);

  // Procesar un PDF: extraer texto + parsear + cruzar con Supabase
  // El asunto/cuerpo NO se aplican acá, se aplican al momento de enviar (con el editor del lote)
  const procesarPDF = async (file, idx) => {
    try {
      const texto = await pf_extraerTextoPDF(file);
      const parsed = pf_parsearPDF(texto);
      const trans = parsed.transportista
        ? transByNombre.get(parsed.transportista.toUpperCase().trim())
        : null;
      const param = parsed.ceco
        ? paramsByCeco.get(parsed.ceco.toUpperCase().trim())
        : null;

      // CC: combinar el CC del transportista (si tiene) + el correo del supervisor del CECO (si tiene)
      // Si ambos coinciden, no duplicar
      const ccs = [];
      if (trans?.correo_cc) ccs.push(trans.correo_cc.trim());
      if (param?.correo_supervisor) {
        const sup = param.correo_supervisor.trim();
        // Evitar duplicados (case-insensitive)
        const yaEsta = ccs.some(c => c.toLowerCase() === sup.toLowerCase());
        if (!yaEsta) ccs.push(sup);
      }
      const ccCombinado = ccs.join("; ");

      return {
        idx,
        file,
        nombre: file.name,
        size: file.size,
        parsed,
        trans,
        param,
        editTo: trans?.correo_to || "",
        editCc: ccCombinado,
        editBcc: trans?.correo_bcc || "",
        // editAsunto/editCuerpo NO se guardan aquí — se generan dinámicamente desde el editor del lote
        // Solo se llenan si el usuario edita manualmente esta fila puntual (override por fila)
        overrideAsunto: null,
        overrideCuerpo: null,
        estadoEnvio: null,
        motivoEnvio: "",
        tsEnvio: null,
        errorParseo: "",
      };
    } catch (e) {
      return {
        idx,
        file,
        nombre: file.name,
        size: file.size,
        parsed: { transportista: "", rfc: "", operacion: "", supervisorPDF: "", periodo: "", ceco: "" },
        trans: null,
        param: null,
        editTo: "", editCc: "", editBcc: "",
        overrideAsunto: null, overrideCuerpo: null,
        estadoEnvio: null, motivoEnvio: "", tsEnvio: null,
        errorParseo: e.message || String(e),
      };
    }
  };

  // Drop / selección de PDFs
  const onPdfsDrop = async (fileList) => {
    setError("");
    const archivos = Array.from(fileList || []).filter(f => /\.pdf$/i.test(f.name) && f.size > 0);
    if (archivos.length === 0) {
      setError("No se detectaron archivos PDF válidos.");
      return;
    }
    setPdfsEnProceso(archivos.length);
    const idxInicio = filas.length;
    const nuevos = [];
    for (let i = 0; i < archivos.length; i++) {
      const fila = await procesarPDF(archivos[i], idxInicio + i);
      nuevos.push(fila);
      setPdfsEnProceso(archivos.length - i - 1);
    }
    setPdfsEnProceso(0);
    setFilas(prev => {
      const map = new Map();
      [...prev, ...nuevos].forEach(f => map.set(f.nombre, f));
      return Array.from(map.values()).map((f, i) => ({ ...f, idx: i }));
    });
    setLogFinal(null);
  };

  // Función para armar las variables y aplicar plantillas de UNA fila
  const armarVariables = (f) => ({
    TRANSPORTISTA: f.parsed.transportista,
    CECO: f.parsed.ceco,
    PERIODO: f.parsed.periodo,
    RFC: f.parsed.rfc,
    OPERACION: f.parsed.operacion,
    SUPERVISOR: f.param?.supervisor || f.parsed.supervisorPDF || "",
  });

  // Validación y estado de cada fila (incluye reemplazo de variables en preview)
  const filasConEstado = useMemo(() => {
    return filas.map(f => {
      const valTo = pf_limpiarLista(f.editTo);
      const valCc = pf_limpiarLista(f.editCc);
      const valBcc = pf_limpiarLista(f.editBcc);
      const errores = [];
      if (f.errorParseo) errores.push("Error de parseo: " + f.errorParseo);
      if (!f.parsed.transportista) errores.push("PDF sin EMPRESA TRANSPORTE");
      if (!f.parsed.ceco) errores.push("PDF sin CECO detectable");
      if (f.parsed.transportista && !f.trans) errores.push("Transportista no registrado");
      if (f.parsed.ceco && !f.param) errores.push("CECO no registrado");
      if (!valTo.limpia) errores.push("Sin correo TO");
      else if (!valTo.valida) errores.push("TO inválido");
      if (f.editCc && !valCc.valida) errores.push("CC inválido");
      if (f.editBcc && !valBcc.valida) errores.push("BCC inválido");

      // Preview del asunto/cuerpo aplicando variables
      const vars = armarVariables(f);
      const asuntoFinal = pf_aplicarPlantilla(f.overrideAsunto !== null ? f.overrideAsunto : asuntoLote, vars);
      const cuerpoFinal = pf_aplicarPlantilla(f.overrideCuerpo !== null ? f.overrideCuerpo : cuerpoLote, vars);

      return { ...f, errores, listo: errores.length === 0, asuntoFinal, cuerpoFinal };
    });
  }, [filas, asuntoLote, cuerpoLote]);

  const totalListos = filasConEstado.filter(f => f.listo).length;
  const totalConErrores = filasConEstado.length - totalListos;

  // Edición inline (override de fila puntual)
  const guardarEdicion = (idx, campos) => {
    setFilas(prev => prev.map(f => f.idx === idx ? { ...f, ...campos } : f));
    setEditFila(null);
  };
  const eliminarFila = (idx) => {
    setFilas(prev => prev.filter(f => f.idx !== idx).map((f, i) => ({ ...f, idx: i })));
  };
  const limpiarTodo = () => {
    if (!confirm("¿Limpiar todos los PDFs y resultados?\n\n(El asunto y cuerpo se mantienen)")) return;
    setFilas([]); setError(""); setLogFinal(null); setProgreso({ actual: 0, total: 0 });
  };
  const restaurarPlantillaDefault = () => {
    if (!confirm("¿Restaurar el asunto y cuerpo al valor por defecto?\n\nVas a perder cualquier cambio que hayas hecho.")) return;
    setAsuntoLote(ASUNTO_DEFAULT);
    setCuerpoLote(CUERPO_DEFAULT);
  };

  const onAgregarYRefrescar = async () => {
    setModalAgregar(null);
    await onActualizarMaestros();
    if (filas.length > 0) {
      const reprocesadas = [];
      for (const f of filas) {
        const nueva = await procesarPDF(f.file, f.idx);
        reprocesadas.push({
          ...nueva,
          editTo: f.editTo && f.editTo !== "" ? f.editTo : nueva.editTo,
          editCc: f.editCc && f.editCc !== "" ? f.editCc : nueva.editCc,
          editBcc: f.editBcc && f.editBcc !== "" ? f.editBcc : nueva.editBcc,
          overrideAsunto: f.overrideAsunto,
          overrideCuerpo: f.overrideCuerpo,
          estadoEnvio: f.estadoEnvio,
          motivoEnvio: f.motivoEnvio,
          tsEnvio: f.tsEnvio,
        });
      }
      setFilas(reprocesadas);
    }
  };

  // ─── Envío masivo ────────────────────────────────────────────────────────────
  const enviarMasivo = async () => {
    const enviables = filasConEstado.filter(f => f.listo);
    if (enviables.length === 0) {
      alert("No hay filas listas para enviar. Revisá los errores en la tabla.");
      return;
    }
    if (!asuntoLote.trim()) {
      alert("El asunto del correo está vacío. Escribí un asunto antes de enviar.");
      return;
    }
    if (!cuerpoLote.trim()) {
      alert("El cuerpo del correo está vacío. Escribí un cuerpo antes de enviar.");
      return;
    }
    if (!confirm(
      `Se enviarán ${enviables.length} correo(s) desde la cuenta configurada en n8n.\n\n` +
      `${totalConErrores > 0 ? `Hay ${totalConErrores} fila(s) con errores que NO se enviarán.\n\n` : ""}` +
      `¿Confirmás el envío?`
    )) return;

    setEnviando(true);
    setLogFinal(null);
    setProgreso({ actual: 0, total: enviables.length });

    let okCount = 0, errCount = 0;
    const inicio = Date.now();
    const logsParaSupabase = [];

    for (let i = 0; i < enviables.length; i++) {
      const f = enviables[i];
      setProgreso({ actual: i + 1, total: enviables.length });
      setFilas(prev => prev.map(x => x.idx === f.idx
        ? { ...x, estadoEnvio: "enviando", motivoEnvio: "", tsEnvio: null }
        : x));

      let resultado = { ok: false, motivo: "", messageId: "" };
      try {
        const pdfBase64 = await pf_fileToBase64(f.file);
        const payload = {
          idEnvio: `${Date.now()}-${f.idx}`,
          transportista: f.parsed.transportista,
          ceco: f.parsed.ceco,
          rfc: f.parsed.rfc,
          operacion: f.parsed.operacion,
          periodo: f.parsed.periodo,
          correoTo: pf_limpiarLista(f.editTo).limpia,
          cc: pf_limpiarLista(f.editCc).limpia,
          bcc: pf_limpiarLista(f.editBcc).limpia,
          asunto: f.asuntoFinal || `Prefactura ${f.parsed.ceco} — ${f.parsed.periodo}`,
          cuerpo: f.cuerpoFinal || "",
          nombrePdf: f.nombre,
          pdfBase64,
        };
        const resp = await fetch(PREFACTURAS_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        let data = {};
        try { data = await resp.json(); } catch { /* no-json */ }
        if (resp.ok && data.ok !== false) {
          resultado = { ok: true, motivo: data.messageId || "Enviado", messageId: data.messageId || "" };
          okCount++;
        } else {
          resultado = { ok: false, motivo: data.error || `HTTP ${resp.status}`, messageId: "" };
          errCount++;
        }
      } catch (e) {
        resultado = { ok: false, motivo: "Error red: " + e.message, messageId: "" };
        errCount++;
      }

      const tsAhora = new Date().toISOString();
      setFilas(prev => prev.map(x => x.idx === f.idx
        ? { ...x, estadoEnvio: resultado.ok ? "ok" : "fallido", motivoEnvio: resultado.motivo, tsEnvio: tsAhora }
        : x));

      logsParaSupabase.push({
        fecha_envio: tsAhora,
        transportista: f.parsed.transportista,
        ceco: f.parsed.ceco,
        periodo: f.parsed.periodo,
        correo_to: pf_limpiarLista(f.editTo).limpia,
        nombre_pdf: f.nombre,
        estado: resultado.ok ? "enviado" : "fallido",
        motivo: resultado.motivo,
        message_id: resultado.messageId,
        usuario: usuario?.email || "—",
        pais: "MX",
      });

      if (i < enviables.length - 1) {
        await new Promise(r => setTimeout(r, PAUSA_ENTRE_ENVIOS_MS));
      }
    }

    try {
      if (logsParaSupabase.length > 0) {
        await sb.from("prefacturas_envios_log").insert(logsParaSupabase);
      }
    } catch (e) {
      console.error("Error guardando log:", e);
    }

    const segs = Math.round((Date.now() - inicio) / 1000);
    setLogFinal({ ok: okCount, err: errCount, omitidos: totalConErrores, segs, fecha: new Date() });
    setEnviando(false);
    setProgreso({ actual: 0, total: 0 });
  };

  const descargarLog = async () => {
    const detalle = [
      ["#", "Archivo PDF", "Transportista", "RFC", "CECO", "Operación", "Período",
       "Correo TO", "CC", "BCC", "Asunto",
       "Estado envío", "Motivo / MessageID", "Timestamp"],
      ...filasConEstado.map((f, i) => [
        i + 1, f.nombre,
        f.parsed.transportista, f.parsed.rfc, f.parsed.ceco, f.parsed.operacion, f.parsed.periodo,
        f.editTo, f.editCc, f.editBcc, f.asuntoFinal,
        f.estadoEnvio === "ok" ? "ENVIADO" :
          f.estadoEnvio === "fallido" ? "FALLIDO" :
          f.errores.length > 0 ? "OMITIDO: " + f.errores.join(", ") : "PENDIENTE",
        f.motivoEnvio || "",
        f.tsEnvio ? new Date(f.tsEnvio).toLocaleString("es-MX") : "",
      ]),
    ];
    const resumen = [
      ["Reporte de envío de prefacturas MX"],
      ["Fecha", new Date().toLocaleString("es-MX")],
      ["Usuario", usuario?.nombre || usuario?.email || "—"],
      ["PDFs cargados", filas.length],
      ["Enviados OK", filasConEstado.filter(f => f.estadoEnvio === "ok").length],
      ["Fallidos", filasConEstado.filter(f => f.estadoEnvio === "fallido").length],
      ["Pendientes/Omitidos", filasConEstado.filter(f => !f.estadoEnvio).length],
      [""],
      ["Asunto utilizado"],
      [asuntoLote],
      [""],
      ["Cuerpo utilizado"],
      [cuerpoLote],
    ];
    await descargarExcelMultihoja(
      [{ nombre: "Resumen", datos: resumen }, { nombre: "Detalle", datos: detalle }],
      "log_prefacturas_envio_mx"
    );
  };

  return (
    <div className="pg" style={{ maxWidth: 1400 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="sec-title">Prefacturas · Envío Masivo</div>
        <div className="sec-sub">
          Arrastrá los PDFs generados por la macro. Ajustá el asunto y cuerpo del lote.
          El Brain lee cada PDF, cruza con la base de datos, y envía masivamente.
        </div>
      </div>

      {error && (
        <div style={{
          background: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b",
          padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13,
        }}>⚠ {error}</div>
      )}

      {/* ═══ ZONA PRINCIPAL: DRAG-AND-DROP DE PDFs ═══════════════════════════ */}
      <div
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setArrastrando(true); }}
        onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setArrastrando(false); }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation();
          setArrastrando(false);
          onPdfsDrop(e.dataTransfer.files);
        }}
        onClick={() => pdfInputRef.current?.click()}
        style={{
          border: `3px dashed ${arrastrando ? "#F47B20" : "#1a3a6b"}`,
          borderRadius: 16,
          padding: "40px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: arrastrando ? "#fff7ed" : "#f8fafc",
          transition: "all 0.2s",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 10 }}>📄</div>
        <div style={{ fontSize: 17, color: "#1a3a6b", fontWeight: 700, marginBottom: 6 }}>
          {pdfsEnProceso > 0
            ? `Procesando PDFs... (${pdfsEnProceso} pendientes)`
            : arrastrando
              ? "Soltá los PDFs aquí"
              : "Arrastrá los PDFs de prefacturas"}
        </div>
        <div style={{ fontSize: 13, color: "#64748b" }}>
          {pdfsEnProceso > 0
            ? "El Brain está leyendo cada PDF para extraer los datos."
            : "o hacé clic para seleccionarlos · sin límite de cantidad"}
        </div>
        {filas.length > 0 && pdfsEnProceso === 0 && (
          <div style={{
            marginTop: 16, padding: "8px 14px", background: "#fff",
            border: "1px solid #1a3a6b", borderRadius: 10,
            display: "inline-flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ fontSize: 13, color: "#1a3a6b", fontWeight: 700 }}>
              ✓ {filas.length} PDF{filas.length === 1 ? "" : "s"} cargado{filas.length === 1 ? "" : "s"}
            </span>
            <button onClick={e => { e.stopPropagation(); limpiarTodo(); }}
              style={{
                background: "#fee2e2", border: "none", borderRadius: 6,
                padding: "4px 10px", fontSize: 11, color: "#991b1b",
                cursor: "pointer", fontWeight: 600, fontFamily: "Geist, sans-serif",
              }}>Quitar todos</button>
          </div>
        )}
        <input
          ref={pdfInputRef} type="file" accept=".pdf" multiple
          style={{ display: "none" }}
          onChange={e => { onPdfsDrop(e.target.files); e.target.value = ""; }}
        />
      </div>

      {/* ═══ ★ NUEVO: EDITOR DE ASUNTO Y CUERPO DEL LOTE ═════════════════════ */}
      <div className="form-card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <div className="form-title" style={{ margin: 0 }}>
            ✉️ Asunto y cuerpo del correo
          </div>
          <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>
            Se aplica a TODOS los envíos del lote
          </span>
          <button onClick={restaurarPlantillaDefault}
            style={{
              background: "transparent", border: "1px solid #e4e7ec", borderRadius: 6,
              padding: "4px 10px", fontSize: 11, color: "#64748b", cursor: "pointer",
              fontWeight: 600, fontFamily: "Geist, sans-serif",
            }}>↺ Restaurar default</button>
        </div>

        {/* Asunto */}
        <div className="field-row">
          <div className="field-label">Asunto</div>
          <input
            value={asuntoLote}
            onChange={e => setAsuntoLote(e.target.value)}
            placeholder="Prefactura {CECO} — período {PERIODO}"
            style={{ fontSize: 13 }}
          />
        </div>

        {/* Cuerpo */}
        <div className="field-row">
          <div className="field-label">Cuerpo del correo</div>
          <textarea
            value={cuerpoLote}
            onChange={e => setCuerpoLote(e.target.value)}
            placeholder="Estimado(a) {TRANSPORTISTA}, ..."
            style={{ height: 220, fontSize: 12, fontFamily: "monospace", lineHeight: 1.6, resize: "vertical" }}
          />
        </div>

        {/* Variables disponibles */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Variables disponibles:</span>
          {VARIABLES_PLANTILLA.map(v => (
            <code key={v} style={{
              background: "#eef2ff", color: "#1a3a6b", padding: "2px 8px",
              borderRadius: 4, fontSize: 11, fontFamily: "monospace",
            }}>{"{" + v + "}"}</code>
          ))}
        </div>

        <div style={{
          marginTop: 12, padding: "10px 12px", background: "#eef2ff", borderRadius: 8,
          fontSize: 11, color: "#1a3a6b",
        }}>
          💡 Las variables se reemplazan automáticamente con los datos extraídos de cada PDF.
          Tus cambios se guardan automáticamente en este navegador para la próxima vez.
        </div>
      </div>

      {/* ═══ INDICADORES ════════════════════════════════════════════════════ */}
      {filas.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10, marginBottom: 14,
        }}>
          <IndicadorPF label="PDFs procesados" valor={filas.length} color="#1a3a6b" />
          <IndicadorPF label="Listas para enviar" valor={totalListos} color="#16a34a" />
          <IndicadorPF label="Con errores" valor={totalConErrores} color="#dc2626" />
        </div>
      )}

      {/* ═══ TABLA ═════════════════════════════════════════════════════════ */}
      {filas.length > 0 && (
        <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{
            padding: "12px 16px", borderBottom: "1px solid #e4e7ec",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            flexWrap: "wrap", gap: 8,
          }}>
            <div className="form-title" style={{ margin: 0 }}>Revisión y envío</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(logFinal || filasConEstado.some(f => f.estadoEnvio)) && (
                <BotonDescargarExcel onClick={descargarLog} label="Descargar log Excel" />
              )}
              <button
                onClick={enviarMasivo}
                disabled={enviando || totalListos === 0}
                className="btn-orange"
                style={{ padding: "9px 18px", fontSize: 13 }}>
                {enviando
                  ? `Enviando ${progreso.actual}/${progreso.total}...`
                  : `📨 Enviar ${totalListos} correo${totalListos === 1 ? "" : "s"}`
                }
              </button>
            </div>
          </div>

          {enviando && (
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #e4e7ec", background: "#fffbeb" }}>
              <div style={{ fontSize: 12, color: "#92400e", marginBottom: 6, fontWeight: 600 }}>
                Enviando {progreso.actual} de {progreso.total}...
              </div>
              <div style={{ height: 8, background: "#fef3c7", borderRadius: 4, overflow: "hidden" }}>
                <div style={{
                  width: `${(progreso.actual / progreso.total) * 100}%`,
                  height: "100%", background: "#F47B20", transition: "width 0.3s",
                }} />
              </div>
            </div>
          )}

          {logFinal && !enviando && (
            <div style={{
              padding: "10px 16px", borderBottom: "1px solid #e4e7ec",
              background: logFinal.err === 0 ? "#f0fdf4" : "#fffbeb",
            }}>
              <div style={{
                fontSize: 13, fontWeight: 600,
                color: logFinal.err === 0 ? "#166534" : "#92400e",
              }}>
                {logFinal.err === 0 ? "✓" : "⚠"} Envío finalizado en {logFinal.segs}s ·{" "}
                {logFinal.ok} enviado{logFinal.ok === 1 ? "" : "s"} ·{" "}
                {logFinal.err} fallido{logFinal.err === 1 ? "" : "s"}
                {logFinal.omitidos > 0 && ` · ${logFinal.omitidos} omitido${logFinal.omitidos === 1 ? "" : "s"}`}
              </div>
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                  <th style={pf_th()}>Estado</th>
                  <th style={pf_th()}>Transportista (PDF)</th>
                  <th style={pf_th()}>CECO</th>
                  <th style={pf_th()}>Período</th>
                  <th style={pf_th()}>Correo TO</th>
                  <th style={pf_th()}>CC</th>
                  <th style={pf_th()}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {filasConEstado.map((f) => (
                  <FilaPrefactura
                    key={f.idx}
                    fila={f}
                    enEdicion={editFila === f.idx}
                    onEdit={() => setEditFila(f.idx)}
                    onGuardar={(campos) => guardarEdicion(f.idx, campos)}
                    onCancelar={() => setEditFila(null)}
                    onEliminar={() => eliminarFila(f.idx)}
                    onAgregarTransportista={() => setModalAgregar({
                      tipo: "trans",
                      prefill: { nombre: f.parsed.transportista, rfc: f.parsed.rfc },
                    })}
                    onAgregarCECO={() => setModalAgregar({
                      tipo: "ceco",
                      prefill: { ceco: f.parsed.ceco, supervisor: f.parsed.supervisorPDF },
                    })}
                    enviando={enviando}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal embebido para agregar transportista o CECO desde el envío */}
      {modalAgregar?.tipo === "trans" && (
        <ModalEdicionTransportista
          inicial={{
            nombre: modalAgregar.prefill.nombre || "",
            rfc: modalAgregar.prefill.rfc || "",
            estado: "Activo",
            correo_to: "", correo_cc: "", correo_bcc: "", notas: "",
          }}
          esNuevo={true}
          onCancelar={() => setModalAgregar(null)}
          onGuardarOK={onAgregarYRefrescar}
        />
      )}
      {modalAgregar?.tipo === "ceco" && (
        <ModalEdicionParametro
          inicial={{
            ceco: modalAgregar.prefill.ceco || "",
            supervisor: modalAgregar.prefill.supervisor || "",
            correo_supervisor: "",
            cuenta_envio: "prefacturas@bigticket.cl",
          }}
          esNuevo={true}
          onCancelar={() => setModalAgregar(null)}
          onGuardarOK={onAgregarYRefrescar}
        />
      )}
    </div>
  );
}

function pf_th(align = "left") {
  return {
    padding: "8px 10px", textAlign: align, fontSize: 10,
    color: "#64748b", fontWeight: 600, textTransform: "uppercase",
    letterSpacing: 0.3, whiteSpace: "nowrap",
  };
}

function pf_td(align = "left") {
  return {
    padding: "8px 10px", textAlign: align, fontSize: 12,
    color: "#1f2937", borderBottom: "1px solid #f1f5f9", verticalAlign: "top",
  };
}

function IndicadorPF({ label, valor, color }) {
  return (
    <div style={{
      background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 10,
      padding: "12px 14px",
    }}>
      <div style={{
        fontSize: 10, color: "#94a3b8", textTransform: "uppercase",
        letterSpacing: 0.5, marginBottom: 4, fontWeight: 600,
      }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{valor}</div>
    </div>
  );
}

function FilaPrefactura({ fila, enEdicion, onEdit, onGuardar, onCancelar, onEliminar,
                         onAgregarTransportista, onAgregarCECO, enviando }) {
  const [to, setTo] = useState(fila.editTo);
  const [cc, setCc] = useState(fila.editCc);
  const [bcc, setBcc] = useState(fila.editBcc);
  // El asunto/cuerpo del lote ya están aplicados en fila.asuntoFinal/fila.cuerpoFinal
  // Si la fila tiene override (porque el usuario ya editó manualmente), respetamos eso
  const [asunto, setAsunto] = useState(fila.asuntoFinal);
  const [cuerpo, setCuerpo] = useState(fila.cuerpoFinal);

  useEffect(() => {
    if (enEdicion) {
      setTo(fila.editTo); setCc(fila.editCc); setBcc(fila.editBcc);
      setAsunto(fila.asuntoFinal); setCuerpo(fila.cuerpoFinal);
    }
  }, [enEdicion, fila.editTo, fila.editCc, fila.editBcc, fila.asuntoFinal, fila.cuerpoFinal]);

  let bgFila = "transparent";
  if (fila.estadoEnvio === "ok") bgFila = "#f0fdf4";
  else if (fila.estadoEnvio === "fallido") bgFila = "#fef2f2";
  else if (fila.estadoEnvio === "enviando") bgFila = "#fffbeb";
  else if (!fila.listo) bgFila = "#fef2f2";

  if (enEdicion) {
    return (
      <tr style={{ background: "#eff6ff" }}>
        <td colSpan={7} style={{ padding: 14, borderBottom: "2px solid #1a3a6b" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>
            ✏️ Editando: {fila.parsed.transportista || fila.nombre} · {fila.parsed.ceco || "—"} · {fila.parsed.periodo || "—"}
          </div>
          <div className="two-col" style={{ marginBottom: 10 }}>
            <div>
              <div className="field-label">Correo TO *</div>
              <input value={to} onChange={e => setTo(e.target.value)}
                placeholder="correo@dominio.com (separá varios con ;)" />
            </div>
            <div>
              <div className="field-label">CC</div>
              <input value={cc} onChange={e => setCc(e.target.value)} placeholder="opcional" />
            </div>
          </div>
          <div className="field-row">
            <div className="field-label">BCC</div>
            <input value={bcc} onChange={e => setBcc(e.target.value)} placeholder="opcional" />
          </div>
          <div className="field-row">
            <div className="field-label">Asunto (override solo para esta fila)</div>
            <input value={asunto} onChange={e => setAsunto(e.target.value)} />
          </div>
          <div className="field-row">
            <div className="field-label">Cuerpo (override solo para esta fila · variables ya reemplazadas)</div>
            <textarea value={cuerpo} onChange={e => setCuerpo(e.target.value)} style={{ height: 140 }} />
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
            💡 Estos cambios solo aplican a este envío puntual. Para cambiar el asunto/cuerpo
            de todo el lote, editalo arriba en "Asunto y cuerpo del correo".
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onCancelar}
              style={{
                background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
                padding: "7px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
                fontFamily: "Geist, sans-serif", fontWeight: 600,
              }}>Cancelar</button>
            <button onClick={() => onGuardar({
              editTo: to, editCc: cc, editBcc: bcc,
              overrideAsunto: asunto, overrideCuerpo: cuerpo,
            })} className="btn-blue" style={{ padding: "7px 14px", fontSize: 12 }}>
              Guardar cambios
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const tieneTransNoRegistrado = fila.parsed.transportista && !fila.trans;
  const tieneCECONoRegistrado = fila.parsed.ceco && !fila.param;

  return (
    <tr style={{ background: bgFila }}>
      <td style={pf_td()}><EstadoBadge fila={fila} /></td>
      <td style={pf_td()}>
        <div style={{ fontWeight: 600 }}>
          {fila.parsed.transportista || <em style={{ color: "#dc2626" }}>(no detectado)</em>}
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8" }}>{fila.parsed.rfc || "sin RFC"}</div>
        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>📄 {fila.nombre.length > 35 ? fila.nombre.slice(0, 32) + "..." : fila.nombre}</div>
        {tieneTransNoRegistrado && (
          <button onClick={onAgregarTransportista}
            style={{
              marginTop: 4, background: "#fef2f2", border: "1px solid #fca5a5",
              borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "#991b1b",
              cursor: "pointer", fontWeight: 600, fontFamily: "Geist, sans-serif",
            }}>+ Agregar a Supabase</button>
        )}
      </td>
      <td style={pf_td()}>
        {fila.parsed.ceco ? (
          <>
            <span style={{
              background: fila.param ? "#eef2ff" : "#fef2f2",
              color: fila.param ? "#1a3a6b" : "#991b1b",
              padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
            }}>{fila.parsed.ceco}</span>
            {tieneCECONoRegistrado && (
              <button onClick={onAgregarCECO}
                style={{
                  display: "block", marginTop: 4,
                  background: "#fef2f2", border: "1px solid #fca5a5",
                  borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "#991b1b",
                  cursor: "pointer", fontWeight: 600, fontFamily: "Geist, sans-serif",
                }}>+ Agregar CECO</button>
            )}
          </>
        ) : <em style={{ color: "#dc2626", fontSize: 11 }}>(no detectado)</em>}
      </td>
      <td style={pf_td()}>
        <span style={{ fontSize: 11, color: "#475569" }}>{fila.parsed.periodo || "—"}</span>
      </td>
      <td style={pf_td()}>
        <div style={{ wordBreak: "break-all", maxWidth: 240 }}>
          {fila.editTo || <em style={{ color: "#dc2626" }}>vacío</em>}
        </div>
        {fila.trans && (
          <div style={{ fontSize: 9, color: "#16a34a", marginTop: 2 }}>✓ desde Supabase</div>
        )}
      </td>
      <td style={pf_td()}>
        <div style={{ wordBreak: "break-all", maxWidth: 200, fontSize: 11, color: "#64748b" }}>
          {fila.editCc || "—"}
        </div>
      </td>
      <td style={pf_td()}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button onClick={onEdit}
            disabled={enviando || fila.estadoEnvio === "ok"}
            style={{
              background: "transparent", border: "1px solid #e4e7ec", borderRadius: 6,
              padding: "3px 8px", fontSize: 11, color: "#1a3a6b", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
              opacity: (enviando || fila.estadoEnvio === "ok") ? 0.4 : 1,
            }}>Editar</button>
          <button onClick={onEliminar} disabled={enviando}
            style={{
              background: "transparent", border: "1px solid #fca5a5", borderRadius: 6,
              padding: "3px 8px", fontSize: 11, color: "#991b1b", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
              opacity: enviando ? 0.4 : 1,
            }}>Quitar</button>
        </div>
      </td>
    </tr>
  );
}

function EstadoBadge({ fila }) {
  if (fila.estadoEnvio === "ok") {
    return (
      <div title={fila.motivoEnvio + (fila.tsEnvio ? " · " + new Date(fila.tsEnvio).toLocaleTimeString("es-MX") : "")}>
        <span style={{
          background: "#dcfce7", color: "#166534", padding: "3px 8px",
          borderRadius: 20, fontSize: 10, fontWeight: 700,
        }}>✓ ENVIADO</span>
      </div>
    );
  }
  if (fila.estadoEnvio === "fallido") {
    return (
      <div title={fila.motivoEnvio}>
        <span style={{
          background: "#fee2e2", color: "#991b1b", padding: "3px 8px",
          borderRadius: 20, fontSize: 10, fontWeight: 700,
        }}>✗ FALLIDO</span>
        <div style={{ fontSize: 9, color: "#991b1b", marginTop: 2, maxWidth: 160 }}>
          {fila.motivoEnvio?.slice(0, 60)}{fila.motivoEnvio?.length > 60 ? "..." : ""}
        </div>
      </div>
    );
  }
  if (fila.estadoEnvio === "enviando") {
    return (
      <span style={{
        background: "#fef3c7", color: "#92400e", padding: "3px 8px",
        borderRadius: 20, fontSize: 10, fontWeight: 700,
      }}>⏳ ENVIANDO</span>
    );
  }
  if (!fila.listo) {
    return (
      <div title={fila.errores.join(" · ")}>
        <span style={{
          background: "#fee2e2", color: "#991b1b", padding: "3px 8px",
          borderRadius: 20, fontSize: 10, fontWeight: 700,
        }}>⚠ {fila.errores[0]}</span>
        {fila.errores.length > 1 && (
          <div style={{ fontSize: 9, color: "#991b1b", marginTop: 2 }}>
            +{fila.errores.length - 1} error{fila.errores.length === 2 ? "" : "es"} más
          </div>
        )}
      </div>
    );
  }
  return (
    <span style={{
      background: "#dbeafe", color: "#1e40af", padding: "3px 8px",
      borderRadius: 20, fontSize: 10, fontWeight: 700,
    }}>LISTO</span>
  );
}

function PrefTransportistas({ data, onChange }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [editando, setEditando] = useState(null);
  const [mostrarImportador, setMostrarImportador] = useState(false);

  const filtrados = useMemo(() => {
    let r = [...data];
    if (filtroEstado !== "todos") r = r.filter(t => (t.estado || "").toLowerCase() === filtroEstado);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      r = r.filter(t =>
        (t.nombre || "").toLowerCase().includes(q) ||
        (t.rfc || "").toLowerCase().includes(q) ||
        (t.correo_to || "").toLowerCase().includes(q)
      );
    }
    return r;
  }, [data, busqueda, filtroEstado]);

  const handleEliminar = async (id, nombre) => {
    if (!confirm(`¿Eliminar al transportista "${nombre}"?\n\nEsta acción no se puede deshacer.`)) return;
    try {
      const { error } = await sb.from("prefacturas_transportistas_mx").delete().eq("id", id);
      if (error) throw error;
      await onChange();
    } catch (e) {
      alert("Error eliminando: " + e.message);
    }
  };

  const filaEdicion = editando === "nuevo"
    ? { nombre: "", rfc: "", estado: "Activo", correo_to: "", correo_cc: "", correo_bcc: "", notas: "" }
    : (editando ? data.find(t => t.id === editando) : null);

  return (
    <div className="pg" style={{ maxWidth: 1300 }}>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="sec-title">Transportistas MX</div>
          <div className="sec-sub">Editá nombres, RFC y correos. Esta es la fuente de verdad para el envío.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BotonDescargarExcel
            onClick={async () => {
              const cabeceras = ["Nombre", "RFC", "Estado", "Correo TO", "CC", "BCC", "Contacto"];
              const filas = filtrados.map(t => [
                t.nombre || "",
                t.rfc || "",
                t.estado || "",
                t.correo_to || "",
                t.correo_cc || "",
                t.correo_bcc || "",
                t.notas || "",
              ]);
              await descargarExcelMultihoja(
                [{ nombre: "Transportistas MX", datos: [cabeceras, ...filas] }],
                "transportistas_mx"
              );
            }}
            label="Descargar Excel"
          />
          <button onClick={() => setMostrarImportador(true)}
            style={{
              background: "#fff", border: "1px solid #1a3a6b", borderRadius: 8,
              padding: "9px 16px", fontSize: 13, color: "#1a3a6b", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
            }}>
            📤 Importar Excel
          </button>
          <button className="btn-orange" onClick={() => setEditando("nuevo")} style={{ padding: "9px 16px", fontSize: 13 }}>
            + Nuevo transportista
          </button>
        </div>
      </div>

      <div className="form-card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder="Buscar por nombre, RFC o correo..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)}
            style={{ flex: "1 1 280px", maxWidth: 400 }}
          />
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ width: 160 }}>
            <option value="todos">Todos los estados</option>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </select>
          <div style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>
            {filtrados.length} de {data.length} transportistas
          </div>
        </div>
      </div>

      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <th style={pf_th()}>Nombre</th>
                <th style={pf_th()}>RFC</th>
                <th style={pf_th()}>Estado</th>
                <th style={pf_th()}>Correo TO</th>
                <th style={pf_th()}>CC</th>
                <th style={pf_th()}>BCC</th>
                <th style={pf_th()}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>
                  Sin resultados. Probá quitar filtros o agregar un nuevo transportista.
                </td></tr>
              ) : filtrados.map(t => (
                <tr key={t.id}>
                  <td style={pf_td()}>
                    <div style={{ fontWeight: 600 }}>{t.nombre}</div>
                    {t.notas && <div style={{ fontSize: 10, color: "#94a3b8" }}>{t.notas}</div>}
                  </td>
                  <td style={pf_td()}>
                    <code style={{ fontSize: 11, color: "#64748b" }}>{t.rfc || "—"}</code>
                  </td>
                  <td style={pf_td()}>
                    <span style={{
                      background: (t.estado || "").toLowerCase() === "activo" ? "#dcfce7" : "#fee2e2",
                      color: (t.estado || "").toLowerCase() === "activo" ? "#166534" : "#991b1b",
                      padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                    }}>{t.estado || "—"}</span>
                  </td>
                  <td style={pf_td()}>
                    <div style={{ wordBreak: "break-all", maxWidth: 220, fontSize: 11 }}>
                      {t.correo_to || <em style={{ color: "#dc2626" }}>vacío</em>}
                    </div>
                  </td>
                  <td style={pf_td()}>
                    <div style={{ wordBreak: "break-all", maxWidth: 200, fontSize: 11, color: "#64748b" }}>
                      {t.correo_cc || "—"}
                    </div>
                  </td>
                  <td style={pf_td()}>
                    <div style={{ wordBreak: "break-all", maxWidth: 200, fontSize: 11, color: "#64748b" }}>
                      {t.correo_bcc || "—"}
                    </div>
                  </td>
                  <td style={pf_td()}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditando(t.id)}
                        style={{
                          background: "transparent", border: "1px solid #e4e7ec", borderRadius: 6,
                          padding: "3px 8px", fontSize: 11, color: "#1a3a6b", cursor: "pointer",
                          fontWeight: 600, fontFamily: "Geist, sans-serif",
                        }}>Editar</button>
                      <button onClick={() => handleEliminar(t.id, t.nombre)}
                        style={{
                          background: "transparent", border: "1px solid #fca5a5", borderRadius: 6,
                          padding: "3px 8px", fontSize: 11, color: "#991b1b", cursor: "pointer",
                          fontWeight: 600, fontFamily: "Geist, sans-serif",
                        }}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filaEdicion && (
        <ModalEdicionTransportista
          inicial={filaEdicion}
          esNuevo={editando === "nuevo"}
          editandoId={editando !== "nuevo" ? editando : null}
          onCancelar={() => setEditando(null)}
          onGuardarOK={async () => { setEditando(null); await onChange(); }}
        />
      )}

      {mostrarImportador && (
        <ModalImportadorTransportistas
          config={CONFIG_IMPORTADOR_MX}
          dataExistente={data}
          onCancelar={() => setMostrarImportador(false)}
          onImportadoOK={async () => { await onChange(); }}
        />
      )}
    </div>
  );
}

function ModalEdicionTransportista({ inicial, esNuevo, editandoId, onCancelar, onGuardarOK }) {
  const [form, setForm] = useState(inicial);
  const [guardando, setGuardando] = useState(false);

  const handleGuardar = async () => {
    if (!form.nombre.trim()) { alert("El nombre es obligatorio."); return; }
    setGuardando(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        rfc: (form.rfc || "").trim() || null,
        estado: form.estado || "Activo",
        correo_to: (form.correo_to || "").trim() || null,
        correo_cc: (form.correo_cc || "").trim() || null,
        correo_bcc: (form.correo_bcc || "").trim() || null,
        notas: (form.notas || "").trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (esNuevo) {
        const { error } = await sb.from("prefacturas_transportistas_mx").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await sb.from("prefacturas_transportistas_mx").update(payload).eq("id", editandoId);
        if (error) throw error;
      }
      await onGuardarOK();
    } catch (e) {
      alert("Error guardando: " + e.message);
    }
    setGuardando(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20,
    }} onClick={onCancelar}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, padding: 24, maxWidth: 600, width: "100%",
        maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b", marginBottom: 16 }}>
          {esNuevo ? "Nuevo transportista" : "Editar transportista"}
        </div>
        <div className="field-row">
          <div className="field-label">Nombre *</div>
          <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
            placeholder="Ej: LUIS FELIPE HIDALGO SANTIAGO" />
        </div>
        <div className="two-col">
          <div className="field-row">
            <div className="field-label">RFC</div>
            <input value={form.rfc || ""} onChange={e => setForm({ ...form, rfc: e.target.value })}
              placeholder="HISL871105C2A" />
          </div>
          <div className="field-row">
            <div className="field-label">Estado</div>
            <select value={form.estado || "Activo"} onChange={e => setForm({ ...form, estado: e.target.value })}>
              <option value="Activo">Activo</option>
              <option value="Inactivo">Inactivo</option>
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field-label">Correo TO *</div>
          <input value={form.correo_to || ""} onChange={e => setForm({ ...form, correo_to: e.target.value })}
            placeholder="correo@dominio.com" />
        </div>
        <div className="field-row">
          <div className="field-label">Correo CC</div>
          <input value={form.correo_cc || ""} onChange={e => setForm({ ...form, correo_cc: e.target.value })}
            placeholder="opcional · separá varios con ;" />
        </div>
        <div className="field-row">
          <div className="field-label">Correo BCC</div>
          <input value={form.correo_bcc || ""} onChange={e => setForm({ ...form, correo_bcc: e.target.value })}
            placeholder="opcional" />
        </div>
        <div className="field-row">
          <div className="field-label">Notas internas</div>
          <textarea value={form.notas || ""} onChange={e => setForm({ ...form, notas: e.target.value })}
            placeholder="(opcional)" style={{ height: 60 }} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onCancelar} disabled={guardando}
            style={{
              background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
              padding: "8px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
            }}>Cancelar</button>
          <button onClick={handleGuardar} disabled={guardando} className="btn-blue"
            style={{ padding: "8px 14px", fontSize: 12 }}>
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PrefParametros({ data, onChange }) {
  const [editando, setEditando] = useState(null);

  const handleEliminar = async (id, ceco) => {
    if (!confirm(`¿Eliminar el CECO "${ceco}"?`)) return;
    try {
      const { error } = await sb.from("prefacturas_parametros_mx").delete().eq("id", id);
      if (error) throw error;
      await onChange();
    } catch (e) {
      alert("Error eliminando: " + e.message);
    }
  };

  const filaEdicion = editando === "nuevo"
    ? { ceco: "", supervisor: "", correo_supervisor: "", cuenta_envio: "prefacturas@bigticket.cl" }
    : (editando ? data.find(p => p.id === editando) : null);

  return (
    <div className="pg" style={{ maxWidth: 1300 }}>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="sec-title">Parámetros por CECO</div>
          <div className="sec-sub">
            Datos por centro de operación. El supervisor y su correo se usan automáticamente
            en cada envío del CECO correspondiente.
          </div>
        </div>
        <button className="btn-orange" onClick={() => setEditando("nuevo")} style={{ padding: "9px 16px", fontSize: 13 }}>
          + Nuevo CECO
        </button>
      </div>

      <div className="form-card" style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 6 }}>
          💡 Sobre el asunto y cuerpo del correo
        </div>
        <div style={{ fontSize: 12, color: "#1e40af" }}>
          El asunto y cuerpo del correo NO se configuran aquí. Se editan directamente en la
          sub-tab <strong>"Envío masivo"</strong> arriba de la tabla de envío, así podés ajustar
          las fechas y detalles de cada lote sin tener que modificar la configuración permanente.
        </div>
      </div>

      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <th style={pf_th()}>CECO</th>
                <th style={pf_th()}>Supervisor</th>
                <th style={pf_th()}>Correo supervisor (CC automático)</th>
                <th style={pf_th()}>Cuenta envío</th>
                <th style={pf_th()}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>
                  No hay CECOs configurados. Agregá uno con el botón de arriba.
                </td></tr>
              ) : data.map(p => (
                <tr key={p.id}>
                  <td style={pf_td()}>
                    <span style={{
                      background: "#eef2ff", color: "#1a3a6b", padding: "3px 10px",
                      borderRadius: 4, fontSize: 12, fontWeight: 700,
                    }}>{p.ceco}</span>
                  </td>
                  <td style={pf_td()}>{p.supervisor || <em style={{ color: "#94a3b8" }}>—</em>}</td>
                  <td style={pf_td()}>
                    <span style={{ fontSize: 11, color: "#64748b", wordBreak: "break-all" }}>
                      {p.correo_supervisor || "—"}
                    </span>
                  </td>
                  <td style={pf_td()}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{p.cuenta_envio}</span>
                  </td>
                  <td style={pf_td()}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditando(p.id)}
                        style={{
                          background: "transparent", border: "1px solid #e4e7ec", borderRadius: 6,
                          padding: "3px 8px", fontSize: 11, color: "#1a3a6b", cursor: "pointer",
                          fontWeight: 600, fontFamily: "Geist, sans-serif",
                        }}>Editar</button>
                      <button onClick={() => handleEliminar(p.id, p.ceco)}
                        style={{
                          background: "transparent", border: "1px solid #fca5a5", borderRadius: 6,
                          padding: "3px 8px", fontSize: 11, color: "#991b1b", cursor: "pointer",
                          fontWeight: 600, fontFamily: "Geist, sans-serif",
                        }}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filaEdicion && (
        <ModalEdicionParametro
          inicial={filaEdicion}
          esNuevo={editando === "nuevo"}
          editandoId={editando !== "nuevo" ? editando : null}
          onCancelar={() => setEditando(null)}
          onGuardarOK={async () => { setEditando(null); await onChange(); }}
        />
      )}
    </div>
  );
}

function ModalEdicionParametro({ inicial, esNuevo, editandoId, onCancelar, onGuardarOK }) {
  const [form, setForm] = useState(inicial);
  const [guardando, setGuardando] = useState(false);

  const handleGuardar = async () => {
    if (!form.ceco.trim()) { alert("El CECO es obligatorio."); return; }
    setGuardando(true);
    try {
      const payload = {
        ceco: form.ceco.trim().toUpperCase(),
        supervisor: (form.supervisor || "").trim() || null,
        correo_supervisor: (form.correo_supervisor || "").trim() || null,
        cuenta_envio: (form.cuenta_envio || "").trim() || "prefacturas@bigticket.cl",
        updated_at: new Date().toISOString(),
      };
      if (esNuevo) {
        const { error } = await sb.from("prefacturas_parametros_mx").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await sb.from("prefacturas_parametros_mx").update(payload).eq("id", editandoId);
        if (error) throw error;
      }
      await onGuardarOK();
    } catch (e) {
      alert("Error guardando: " + e.message);
    }
    setGuardando(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20,
    }} onClick={onCancelar}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, padding: 24, maxWidth: 600, width: "100%",
        maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b", marginBottom: 16 }}>
          {esNuevo ? "Nuevo CECO" : "Editar parámetros del CECO"}
        </div>
        <div className="two-col">
          <div className="field-row">
            <div className="field-label">CECO *</div>
            <input value={form.ceco} onChange={e => setForm({ ...form, ceco: e.target.value.toUpperCase() })}
              placeholder="SMX7" disabled={!esNuevo} />
            {!esNuevo && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>El CECO no se puede modificar después de creado.</div>}
          </div>
          <div className="field-row">
            <div className="field-label">Cuenta envío</div>
            <input value={form.cuenta_envio || ""} onChange={e => setForm({ ...form, cuenta_envio: e.target.value })}
              placeholder="prefacturas@bigticket.cl" />
          </div>
        </div>
        <div className="field-row">
          <div className="field-label">Supervisor</div>
          <input value={form.supervisor || ""} onChange={e => setForm({ ...form, supervisor: e.target.value })}
            placeholder="ROBERTO LOPEZ" />
        </div>
        <div className="field-row">
          <div className="field-label">Correo supervisor (irá en CC del envío)</div>
          <input value={form.correo_supervisor || ""} onChange={e => setForm({ ...form, correo_supervisor: e.target.value })}
            placeholder="supervisor@bigticket.mx" />
        </div>
        <div style={{
          marginTop: 8, padding: "10px 12px", background: "#eff6ff", borderRadius: 8,
          fontSize: 11, color: "#1a3a6b",
        }}>
          💡 El asunto y cuerpo del correo se editan en la sub-tab "Envío masivo" antes de cada lote.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onCancelar} disabled={guardando}
            style={{
              background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
              padding: "8px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
            }}>Cancelar</button>
          <button onClick={handleGuardar} disabled={guardando} className="btn-blue"
            style={{ padding: "8px 14px", fontSize: 12 }}>
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PrefHistorial({ pais = "MX" }) {
  const [logs, setLogs] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [limite, setLimite] = useState(100);

  const cargar = async () => {
    setCargando(true);
    try {
      const { data } = await sb.from("prefacturas_envios_log")
        .select("*")
        .eq("pais", pais)
        .order("fecha_envio", { ascending: false }).limit(limite);
      setLogs(data || []);
    } catch (e) { console.error(e); }
    setCargando(false);
  };

  useEffect(() => { cargar(); }, [limite, pais]);

  const filtrados = useMemo(() => {
    let r = [...logs];
    if (filtroEstado !== "todos") r = r.filter(l => (l.estado || "") === filtroEstado);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      r = r.filter(l =>
        (l.transportista || "").toLowerCase().includes(q) ||
        (l.ceco || "").toLowerCase().includes(q) ||
        (l.correo_to || "").toLowerCase().includes(q)
      );
    }
    return r;
  }, [logs, filtroEstado, busqueda]);

  const stats = useMemo(() => ({
    total: logs.length,
    ok: logs.filter(l => l.estado === "enviado").length,
    err: logs.filter(l => l.estado === "fallido").length,
  }), [logs]);

  return (
    <div className="pg" style={{ maxWidth: 1300 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="sec-title">Historial de envíos</div>
        <div className="sec-sub">Registro de todos los correos enviados desde el Brain.</div>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 10, marginBottom: 14,
      }}>
        <IndicadorPF label="Total registros" valor={stats.total} color="#1a3a6b" />
        <IndicadorPF label="Enviados OK" valor={stats.ok} color="#16a34a" />
        <IndicadorPF label="Fallidos" valor={stats.err} color="#dc2626" />
      </div>

      <div className="form-card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder="Buscar transportista, CECO o correo..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)}
            style={{ flex: "1 1 280px", maxWidth: 400 }}
          />
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ width: 160 }}>
            <option value="todos">Todos los estados</option>
            <option value="enviado">Solo enviados</option>
            <option value="fallido">Solo fallidos</option>
          </select>
          <select value={limite} onChange={e => setLimite(Number(e.target.value))} style={{ width: 130 }}>
            <option value={100}>Últimos 100</option>
            <option value={500}>Últimos 500</option>
            <option value={2000}>Últimos 2000</option>
          </select>
          <button onClick={cargar} style={{
            background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
            padding: "8px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
            fontFamily: "Geist, sans-serif", fontWeight: 600,
          }}>🔄 Refrescar</button>
        </div>
      </div>

      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        {cargando ? (
          <div className="loading">Cargando historial...</div>
        ) : filtrados.length === 0 ? (
          <div className="empty">Sin envíos registrados.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                  <th style={pf_th()}>Fecha</th>
                  <th style={pf_th()}>Estado</th>
                  <th style={pf_th()}>Transportista</th>
                  <th style={pf_th()}>CECO</th>
                  <th style={pf_th()}>Período</th>
                  <th style={pf_th()}>Correo</th>
                  <th style={pf_th()}>Motivo / MessageID</th>
                  <th style={pf_th()}>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(l => (
                  <tr key={l.id}>
                    <td style={pf_td()}>
                      <span style={{ fontSize: 11, color: "#475569" }}>
                        {new Date(l.fecha_envio).toLocaleString("es-MX")}
                      </span>
                    </td>
                    <td style={pf_td()}>
                      <span style={{
                        background: l.estado === "enviado" ? "#dcfce7" : "#fee2e2",
                        color: l.estado === "enviado" ? "#166534" : "#991b1b",
                        padding: "3px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                      }}>
                        {l.estado === "enviado" ? "✓ ENVIADO" : "✗ FALLIDO"}
                      </span>
                    </td>
                    <td style={pf_td()}>{l.transportista || "—"}</td>
                    <td style={pf_td()}>
                      <span style={{
                        background: "#eef2ff", color: "#1a3a6b", padding: "2px 8px",
                        borderRadius: 4, fontSize: 11, fontWeight: 600,
                      }}>{l.ceco || "—"}</span>
                    </td>
                    <td style={pf_td()}><span style={{ fontSize: 11 }}>{l.periodo || "—"}</span></td>
                    <td style={pf_td()}>
                      <div style={{ wordBreak: "break-all", maxWidth: 200, fontSize: 11 }}>
                        {l.correo_to || "—"}
                      </div>
                    </td>
                    <td style={pf_td()}>
                      <div style={{ wordBreak: "break-all", maxWidth: 260, fontSize: 10, color: "#64748b" }}>
                        {l.motivo || l.message_id || "—"}
                      </div>
                    </td>
                    <td style={pf_td()}>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{l.usuario || "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ModuloPrefacturasEnvio({ usuario }) {
  const [pais, setPais] = useState(() => {
    try { return localStorage.getItem("pref_pais_seleccionado") || "MX"; }
    catch { return "MX"; }
  });

  useEffect(() => {
    try { localStorage.setItem("pref_pais_seleccionado", pais); } catch {}
  }, [pais]);

  return (
    <div style={{ padding: 0 }}>
      {/* Selector de país */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px",
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
          País:
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setPais("MX")}
            style={{
              padding: "8px 18px", borderRadius: 8,
              border: `1px solid ${pais === "MX" ? "#1a3a6b" : "#e4e7ec"}`,
              background: pais === "MX" ? "#1a3a6b" : "#fff",
              color: pais === "MX" ? "#fff" : "#475569",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "Geist, sans-serif",
            }}>
            🇲🇽 México
          </button>
          <button onClick={() => setPais("CL")}
            style={{
              padding: "8px 18px", borderRadius: 8,
              border: `1px solid ${pais === "CL" ? "#1a3a6b" : "#e4e7ec"}`,
              background: pais === "CL" ? "#1a3a6b" : "#fff",
              color: pais === "CL" ? "#fff" : "#475569",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "Geist, sans-serif",
            }}>
            🇨🇱 Chile
          </button>
        </div>
      </div>

      {pais === "MX" && <ModuloPrefacturasMX usuario={usuario} />}
      {pais === "CL" && <ModuloPrefacturasCL usuario={usuario} />}
    </div>
  );
}

const PREFACTURAS_CL_WEBHOOK = "https://bigticket2026.app.n8n.cloud/webhook/prefacturas-enviar-cl";

const VARIABLES_PLANTILLA_CL = [
  "TRANSPORTISTA", "RUT", "OPERACION", "CLIENTE", "CENTRO_COSTO",
  "PERIODO", "MES_FACTURA", "SUPERVISOR", "VALOR_UF", "REGION",
];

const LS_KEY_ASUNTO_CL = "pref_cl_ultimo_asunto";

const LS_KEY_CUERPO_CL = "pref_cl_ultimo_cuerpo";

const ASUNTO_DEFAULT_CL = "PREFACTURA {OPERACION}//{MES_FACTURA}//{TRANSPORTISTA}";

const CUERPO_DEFAULT_CL = `Estimado/a,

Junto con saludar y esperando se encuentre bien, adjunto prefactura detallada en asunto correspondiente al período de {MES_FACTURA}.

SE SOLICITA UTILIZAR COMO GLOSA: "PRODUCCION {MES_FACTURA}"; en caso de no referirse la glosa citada, la factura será rechazada.

Favor adjuntar pdf de factura y copiar a prefacturas@bigticket.cl

Sí por algún motivo hay alguna diferencia; favor hacérnosla saber completando el siguiente formulario https://app.pipefy.com/public/form/Yp603otD detallando los viajes u observaciones presentadas en el documento adjunto para que estas puedan ser validadas por su supervisor y reliquidadas en siguiente facturación.

Si sus diferencias no son reportadas en el formulario mencionado anteriormente; estas no serán procesadas. Respecto al envío de facturas, esta debe ser por el mismo canal de siempre.
Emitir Factura y envío con fecha máximo: XX-XX-2026 a las 12:00 Hrs.
Fecha Pago: XX-XX-2026

De no recibir su factura en el plazo estipulado, el pago se reprogramará con fecha XX de XXXXX 2026 o hasta el viernes más próximo posterior a la recepción de su factura y documentos de certificación pendientes [si es que aplica].

RECORDAR: Para evitar retenciones y postergaciones de pago, favor tener presente que la fecha CORTE DE RECEPCION DE DOCUMENTOS DE CERTIFICACION ES EL DIA XX-XX-2026; Debe contar con toda la certificación mensual enviada EN FORMATO PDF y validada en plataforma certronic. Recuerde que una vez cargada la documentación, el equipo de certronic cuenta con 48 horas para su validación por lo que se sugiere no esperar hasta la fecha limite para evitar retenciones innecesarias.

Agradeciendo desde ya su comprensión y colaboración,
Saludos.
Departamento Pago Transportes.
Alonso de Córdova No. 5870, Oficina 724, Las Condes.`;

const REGEX_OPERACION_CL = /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+?)\s*-\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+)/;

function pf_parsearPDF_CL(texto) {
  const t = texto.replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ");

  // EMPRESA TRANSPORTE
  const reTransp = /EMPRESA\s+TRANSPORTE\s*:?\s*([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑa-z0-9áéíóúñ\s\.\&\-]+?)(?=\s*(?:RUT\b|RESUMEN\b|OPERACI[ÓO]N\b|SUPERVISOR\b|PERIODO\b|MES\s+FACTURA\b|VALOR\s+UF\b|PATENTE\b|CORREO\b|\$|\n|$))/i;
  const mTransp = t.match(reTransp);
  const transportista = mTransp ? mTransp[1].trim().replace(/\s+/g, " ") : "";

  // RUT EMPRESA TRANSPORTE
  const reRut = /RUT\s+EMPRESA\s+TRANSPORTE\s*:?\s*([0-9]{1,10}-[0-9Kk])/i;
  const mRut = t.match(reRut);
  const rut = mRut ? mRut[1].trim().toUpperCase() : "";

  // OPERACIÓN: capturar el primer match con formato "CLIENTE - CECO"
  // Buscamos después del label "OPERACIÓN:" para evitar falsos positivos
  let operacion = "";
  let cliente = "";
  let centroCosto = "";
  const reOpLabel = /OPERACI[ÓO]N\s*:?\s*([^\n]+?)(?=\s*(?:SUPERVISOR\b|PERIODO\b|MES\s+FACTURA\b|VALOR\s+UF\b|RESUMEN\b|CORREO\b|\$|\n|$))/i;
  const mOpLabel = t.match(reOpLabel);
  if (mOpLabel) {
    const linea = mOpLabel[1].trim();
    const mOp = linea.match(REGEX_OPERACION_CL);
    if (mOp) {
      cliente = mOp[1].trim().replace(/\s+/g, " ");
      centroCosto = mOp[2].trim().replace(/\s+/g, " ");
      operacion = `${cliente} - ${centroCosto}`;
    } else {
      // Si no matchea el patrón "CLIENTE - CECO", usar la línea completa
      operacion = linea.replace(/\s+/g, " ");
    }
  }

  // SUPERVISOR (del PDF, solo informativo — el real lo tomamos de Supabase)
  const reSup = /SUPERVISOR\s*:?\s*([^\n]+?)(?=\s*(?:CORREO\b|PERIODO\b|MES\s+FACTURA\b|VALOR\s+UF\b|RESUMEN\b|\$|\n|$))/i;
  const mSup = t.match(reSup);
  const supervisorPDF = mSup ? mSup[1].trim().replace(/\s+/g, " ") : "";

  // PERIODO PREFACTURADO
  const rePer = /PERIODO\s+PREFACTURADO\s*:?\s*([^\n]+?)(?=\s*(?:MES\s+FACTURA\b|VALOR\s+UF\b|RESUMEN\b|TOTAL\b|\$|\n|$))/i;
  const mPer = t.match(rePer);
  const periodo = mPer ? mPer[1].trim().replace(/\s+/g, " ").toUpperCase() : "";

  // MES FACTURA
  const reMes = /MES\s+FACTURA\s*:?\s*([A-ZÁÉÍÓÚ]+(?:\s+\d{4})?)/i;
  const mMes = t.match(reMes);
  const mesFactura = mMes ? mMes[1].trim().toUpperCase() : "";

  // VALOR UF
  const reUf = /VALOR\s+UF\s*:?\s*\$?\s*([0-9\.\,]+)/i;
  const mUf = t.match(reUf);
  const valorUf = mUf ? mUf[1].trim() : "";

  return {
    transportista, rut, operacion, cliente, centroCosto,
    supervisorPDF, periodo, mesFactura, valorUf,
  };
}

function ModuloPrefacturasCL({ usuario }) {
  const [subtab, setSubtab] = useState("envio");
  const [transportistas, setTransportistas] = useState([]);
  const [parametros, setParametros] = useState([]);
  const [cargando, setCargando] = useState(true);

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const [{ data: t }, { data: p }] = await Promise.all([
        sb.from("prefacturas_transportistas_cl").select("*").order("nombre"),
        sb.from("prefacturas_parametros_cl").select("*").order("operacion"),
      ]);
      setTransportistas(t || []);
      setParametros(p || []);
    } catch (e) {
      console.error("Error cargando datos prefacturas CL:", e);
    }
    setCargando(false);
  };

  useEffect(() => { cargarDatos(); }, []);

  const subtabs = [
    { id: "envio",          label: "Envío masivo",        icon: "📨" },
    { id: "transportistas", label: "Transportistas",      icon: "🚚" },
    { id: "parametros",     label: "Operaciones / CECOs", icon: "⚙️" },
    { id: "historial",      label: "Historial",           icon: "📋" },
  ];

  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {subtabs.map(t => (
            <button key={t.id} onClick={() => setSubtab(t.id)}
              style={{
                padding: "8px 16px", borderRadius: 8,
                border: `1px solid ${subtab === t.id ? "#1a3a6b" : "#e4e7ec"}`,
                background: subtab === t.id ? "#1a3a6b" : "#fff",
                color: subtab === t.id ? "#fff" : "#475569",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "Geist, sans-serif",
              }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {cargando ? (
        <div className="loading">Cargando configuración de prefacturas Chile...</div>
      ) : (
        <>
          {subtab === "envio"          && <PrefCLEnvioMasivo transportistas={transportistas} parametros={parametros} usuario={usuario} onActualizarMaestros={cargarDatos} />}
          {subtab === "transportistas" && <PrefCLTransportistas data={transportistas} onChange={cargarDatos} />}
          {subtab === "parametros"     && <PrefCLParametros data={parametros} onChange={cargarDatos} />}
          {subtab === "historial"      && <PrefHistorial pais="CL" />}
        </>
      )}
    </div>
  );
}

function PrefCLEnvioMasivo({ transportistas, parametros, usuario, onActualizarMaestros }) {
  const [pdfsEnProceso, setPdfsEnProceso] = useState(0);
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 });
  const [editFila, setEditFila] = useState(null);
  const [logFinal, setLogFinal] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [modalAgregar, setModalAgregar] = useState(null);
  const pdfInputRef = useRef(null);

  const [asuntoLote, setAsuntoLote] = useState(() => {
    try { return localStorage.getItem(LS_KEY_ASUNTO_CL) || ASUNTO_DEFAULT_CL; }
    catch { return ASUNTO_DEFAULT_CL; }
  });
  const [cuerpoLote, setCuerpoLote] = useState(() => {
    try { return localStorage.getItem(LS_KEY_CUERPO_CL) || CUERPO_DEFAULT_CL; }
    catch { return CUERPO_DEFAULT_CL; }
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY_ASUNTO_CL, asuntoLote); } catch {}
  }, [asuntoLote]);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_CUERPO_CL, cuerpoLote); } catch {}
  }, [cuerpoLote]);

  // Lookups
  const transByNombre = useMemo(() => {
    const m = new Map();
    transportistas.forEach(t => m.set(String(t.nombre).toUpperCase().trim(), t));
    return m;
  }, [transportistas]);
  const paramsByOp = useMemo(() => {
    const m = new Map();
    parametros.forEach(p => m.set(String(p.operacion).toUpperCase().trim(), p));
    return m;
  }, [parametros]);

  const procesarPDF = async (file, idx) => {
    try {
      const texto = await pf_extraerTextoPDF(file);
      const parsed = pf_parsearPDF_CL(texto);
      const trans = parsed.transportista
        ? transByNombre.get(parsed.transportista.toUpperCase().trim())
        : null;
      const param = parsed.operacion
        ? paramsByOp.get(parsed.operacion.toUpperCase().trim())
        : null;

      // CC Chile: correo del supervisor + líderes de la operación (concatenados)
      const ccs = [];
      if (param?.correo_supervisor) ccs.push(param.correo_supervisor.trim());
      if (param?.lideres) ccs.push(param.lideres.trim());
      const ccCombinado = ccs.join("; ");

      return {
        idx,
        file,
        nombre: file.name,
        size: file.size,
        parsed,
        trans,
        param,
        editTo: trans?.correo || "",
        editCc: ccCombinado,
        editBcc: "",
        overrideAsunto: null,
        overrideCuerpo: null,
        estadoEnvio: null,
        motivoEnvio: "",
        tsEnvio: null,
        errorParseo: "",
      };
    } catch (e) {
      return {
        idx,
        file,
        nombre: file.name,
        size: file.size,
        parsed: { transportista: "", rut: "", operacion: "", cliente: "", centroCosto: "",
                  supervisorPDF: "", periodo: "", mesFactura: "", valorUf: "" },
        trans: null,
        param: null,
        editTo: "", editCc: "", editBcc: "",
        overrideAsunto: null, overrideCuerpo: null,
        estadoEnvio: null, motivoEnvio: "", tsEnvio: null,
        errorParseo: e.message || String(e),
      };
    }
  };

  const onPdfsDrop = async (fileList) => {
    setError("");
    const archivos = Array.from(fileList || []).filter(f => /\.pdf$/i.test(f.name) && f.size > 0);
    if (archivos.length === 0) {
      setError("No se detectaron archivos PDF válidos.");
      return;
    }
    setPdfsEnProceso(archivos.length);
    const idxInicio = filas.length;
    const nuevos = [];
    for (let i = 0; i < archivos.length; i++) {
      const fila = await procesarPDF(archivos[i], idxInicio + i);
      nuevos.push(fila);
      setPdfsEnProceso(archivos.length - i - 1);
    }
    setPdfsEnProceso(0);
    setFilas(prev => {
      const map = new Map();
      [...prev, ...nuevos].forEach(f => map.set(f.nombre, f));
      return Array.from(map.values()).map((f, i) => ({ ...f, idx: i }));
    });
    setLogFinal(null);
  };

  const armarVariables = (f) => ({
    TRANSPORTISTA: f.parsed.transportista,
    RUT: f.parsed.rut,
    OPERACION: f.parsed.operacion,
    CLIENTE: f.param?.cliente || f.parsed.cliente,
    CENTRO_COSTO: f.param?.centro_costo || f.parsed.centroCosto,
    PERIODO: f.parsed.periodo,
    MES_FACTURA: f.parsed.mesFactura,
    SUPERVISOR: f.param?.supervisor || f.parsed.supervisorPDF || "",
    VALOR_UF: f.parsed.valorUf,
    REGION: f.param?.region || "",
  });

  const filasConEstado = useMemo(() => {
    return filas.map(f => {
      const valTo = pf_limpiarLista(f.editTo);
      const valCc = pf_limpiarLista(f.editCc);
      const valBcc = pf_limpiarLista(f.editBcc);
      const errores = [];
      if (f.errorParseo) errores.push("Error de parseo: " + f.errorParseo);
      if (!f.parsed.transportista) errores.push("PDF sin EMPRESA TRANSPORTE");
      if (!f.parsed.operacion) errores.push("PDF sin OPERACIÓN detectable");
      if (f.parsed.transportista && !f.trans) errores.push("Transportista no registrado");
      if (f.parsed.operacion && !f.param) errores.push("Operación no registrada");
      if (f.trans && String(f.trans.estado || "").toLowerCase() === "bloqueado") errores.push("Transportista BLOQUEADO (NO ENVIAR)");
      if (!valTo.limpia) errores.push("Sin correo TO");
      else if (!valTo.valida) errores.push("TO inválido");
      if (f.editCc && !valCc.valida) errores.push("CC inválido");
      if (f.editBcc && !valBcc.valida) errores.push("BCC inválido");

      const vars = armarVariables(f);
      const asuntoFinal = pf_aplicarPlantilla(f.overrideAsunto !== null ? f.overrideAsunto : asuntoLote, vars);
      const cuerpoFinal = pf_aplicarPlantilla(f.overrideCuerpo !== null ? f.overrideCuerpo : cuerpoLote, vars);

      return { ...f, errores, listo: errores.length === 0, asuntoFinal, cuerpoFinal };
    });
  }, [filas, asuntoLote, cuerpoLote]);

  const totalListos = filasConEstado.filter(f => f.listo).length;
  const totalConErrores = filasConEstado.length - totalListos;

  const guardarEdicion = (idx, campos) => {
    setFilas(prev => prev.map(f => f.idx === idx ? { ...f, ...campos } : f));
    setEditFila(null);
  };
  const eliminarFila = (idx) => {
    setFilas(prev => prev.filter(f => f.idx !== idx).map((f, i) => ({ ...f, idx: i })));
  };
  const limpiarTodo = () => {
    if (!confirm("¿Limpiar todos los PDFs y resultados?\n\n(El asunto y cuerpo se mantienen)")) return;
    setFilas([]); setError(""); setLogFinal(null); setProgreso({ actual: 0, total: 0 });
  };
  const restaurarPlantillaDefault = () => {
    if (!confirm("¿Restaurar el asunto y cuerpo al valor por defecto?\n\nVas a perder cualquier cambio que hayas hecho.")) return;
    setAsuntoLote(ASUNTO_DEFAULT_CL);
    setCuerpoLote(CUERPO_DEFAULT_CL);
  };

  const onAgregarYRefrescar = async () => {
    setModalAgregar(null);
    await onActualizarMaestros();
    if (filas.length > 0) {
      const reprocesadas = [];
      for (const f of filas) {
        const nueva = await procesarPDF(f.file, f.idx);
        reprocesadas.push({
          ...nueva,
          editTo: f.editTo && f.editTo !== "" ? f.editTo : nueva.editTo,
          editCc: f.editCc && f.editCc !== "" ? f.editCc : nueva.editCc,
          editBcc: f.editBcc && f.editBcc !== "" ? f.editBcc : nueva.editBcc,
          overrideAsunto: f.overrideAsunto,
          overrideCuerpo: f.overrideCuerpo,
          estadoEnvio: f.estadoEnvio,
          motivoEnvio: f.motivoEnvio,
          tsEnvio: f.tsEnvio,
        });
      }
      setFilas(reprocesadas);
    }
  };

  const enviarMasivo = async () => {
    const enviables = filasConEstado.filter(f => f.listo);
    if (enviables.length === 0) {
      alert("No hay filas listas para enviar. Revisá los errores en la tabla.");
      return;
    }
    if (!asuntoLote.trim()) { alert("El asunto está vacío."); return; }
    if (!cuerpoLote.trim()) { alert("El cuerpo está vacío."); return; }
    if (!confirm(
      `Se enviarán ${enviables.length} correo(s) Chile desde la cuenta configurada en n8n.\n\n` +
      `${totalConErrores > 0 ? `Hay ${totalConErrores} fila(s) con errores que NO se enviarán.\n\n` : ""}` +
      `¿Confirmás el envío?`
    )) return;

    setEnviando(true);
    setLogFinal(null);
    setProgreso({ actual: 0, total: enviables.length });

    let okCount = 0, errCount = 0;
    const inicio = Date.now();
    const logsParaSupabase = [];

    for (let i = 0; i < enviables.length; i++) {
      const f = enviables[i];
      setProgreso({ actual: i + 1, total: enviables.length });
      setFilas(prev => prev.map(x => x.idx === f.idx
        ? { ...x, estadoEnvio: "enviando", motivoEnvio: "", tsEnvio: null }
        : x));

      let resultado = { ok: false, motivo: "", messageId: "" };
      try {
        const pdfBase64 = await pf_fileToBase64(f.file);
        const payload = {
          idEnvio: `${Date.now()}-${f.idx}`,
          transportista: f.parsed.transportista,
          rut: f.parsed.rut,
          operacion: f.parsed.operacion,
          cliente: f.parsed.cliente,
          centroCosto: f.parsed.centroCosto,
          periodo: f.parsed.periodo,
          mesFactura: f.parsed.mesFactura,
          valorUf: f.parsed.valorUf,
          correoTo: pf_limpiarLista(f.editTo).limpia,
          cc: pf_limpiarLista(f.editCc).limpia,
          bcc: pf_limpiarLista(f.editBcc).limpia,
          asunto: f.asuntoFinal || `PREFACTURA ${f.parsed.operacion} — ${f.parsed.mesFactura}`,
          cuerpo: f.cuerpoFinal || "",
          nombrePdf: f.nombre,
          pdfBase64,
        };
        const resp = await fetch(PREFACTURAS_CL_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        let data = {};
        try { data = await resp.json(); } catch { /* no-json */ }
        if (resp.ok && data.ok !== false) {
          resultado = { ok: true, motivo: data.messageId || "Enviado", messageId: data.messageId || "" };
          okCount++;
        } else {
          resultado = { ok: false, motivo: data.error || `HTTP ${resp.status}`, messageId: "" };
          errCount++;
        }
      } catch (e) {
        resultado = { ok: false, motivo: "Error red: " + e.message, messageId: "" };
        errCount++;
      }

      const tsAhora = new Date().toISOString();
      setFilas(prev => prev.map(x => x.idx === f.idx
        ? { ...x, estadoEnvio: resultado.ok ? "ok" : "fallido", motivoEnvio: resultado.motivo, tsEnvio: tsAhora }
        : x));

      logsParaSupabase.push({
        fecha_envio: tsAhora,
        transportista: f.parsed.transportista,
        ceco: f.parsed.operacion,  // En Chile, "operacion" es el equivalente al CECO
        periodo: f.parsed.periodo,
        correo_to: pf_limpiarLista(f.editTo).limpia,
        nombre_pdf: f.nombre,
        estado: resultado.ok ? "enviado" : "fallido",
        motivo: resultado.motivo,
        message_id: resultado.messageId,
        usuario: usuario?.email || "—",
        pais: "CL",
      });

      if (i < enviables.length - 1) {
        await new Promise(r => setTimeout(r, PAUSA_ENTRE_ENVIOS_MS));
      }
    }

    try {
      if (logsParaSupabase.length > 0) {
        await sb.from("prefacturas_envios_log").insert(logsParaSupabase);
      }
    } catch (e) {
      console.error("Error guardando log:", e);
    }

    const segs = Math.round((Date.now() - inicio) / 1000);
    setLogFinal({ ok: okCount, err: errCount, omitidos: totalConErrores, segs, fecha: new Date() });
    setEnviando(false);
    setProgreso({ actual: 0, total: 0 });
  };

  const descargarLog = async () => {
    const detalle = [
      ["#", "Archivo PDF", "Transportista", "RUT", "Operación", "Período", "Mes Factura",
       "Correo TO", "CC", "BCC", "Asunto",
       "Estado envío", "Motivo / MessageID", "Timestamp"],
      ...filasConEstado.map((f, i) => [
        i + 1, f.nombre,
        f.parsed.transportista, f.parsed.rut, f.parsed.operacion, f.parsed.periodo, f.parsed.mesFactura,
        f.editTo, f.editCc, f.editBcc, f.asuntoFinal,
        f.estadoEnvio === "ok" ? "ENVIADO" :
          f.estadoEnvio === "fallido" ? "FALLIDO" :
          f.errores.length > 0 ? "OMITIDO: " + f.errores.join(", ") : "PENDIENTE",
        f.motivoEnvio || "",
        f.tsEnvio ? new Date(f.tsEnvio).toLocaleString("es-CL") : "",
      ]),
    ];
    const resumen = [
      ["Reporte de envío de prefacturas Chile"],
      ["Fecha", new Date().toLocaleString("es-CL")],
      ["Usuario", usuario?.nombre || usuario?.email || "—"],
      ["PDFs cargados", filas.length],
      ["Enviados OK", filasConEstado.filter(f => f.estadoEnvio === "ok").length],
      ["Fallidos", filasConEstado.filter(f => f.estadoEnvio === "fallido").length],
      ["Pendientes/Omitidos", filasConEstado.filter(f => !f.estadoEnvio).length],
      [""],
      ["Asunto utilizado"],
      [asuntoLote],
      [""],
      ["Cuerpo utilizado"],
      [cuerpoLote],
    ];
    await descargarExcelMultihoja(
      [{ nombre: "Resumen", datos: resumen }, { nombre: "Detalle", datos: detalle }],
      "log_prefacturas_envio_cl"
    );
  };

  return (
    <div className="pg" style={{ maxWidth: 1400 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="sec-title">Prefacturas Chile · Envío Masivo</div>
        <div className="sec-sub">
          Arrastrá los PDFs generados por la macro Chile. Ajustá el asunto y cuerpo del lote.
          El Brain lee cada PDF, cruza con la base Chile, y envía masivamente.
        </div>
      </div>

      {error && (
        <div style={{
          background: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b",
          padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13,
        }}>⚠ {error}</div>
      )}

      {/* Drag-and-drop */}
      <div
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setArrastrando(true); }}
        onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setArrastrando(false); }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation();
          setArrastrando(false);
          onPdfsDrop(e.dataTransfer.files);
        }}
        onClick={() => pdfInputRef.current?.click()}
        style={{
          border: `3px dashed ${arrastrando ? "#F47B20" : "#1a3a6b"}`,
          borderRadius: 16,
          padding: "40px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: arrastrando ? "#fff7ed" : "#f8fafc",
          transition: "all 0.2s",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 10 }}>📄</div>
        <div style={{ fontSize: 17, color: "#1a3a6b", fontWeight: 700, marginBottom: 6 }}>
          {pdfsEnProceso > 0
            ? `Procesando PDFs... (${pdfsEnProceso} pendientes)`
            : arrastrando
              ? "Soltá los PDFs aquí"
              : "Arrastrá los PDFs de prefacturas Chile"}
        </div>
        <div style={{ fontSize: 13, color: "#64748b" }}>
          {pdfsEnProceso > 0
            ? "El Brain está leyendo cada PDF para extraer los datos."
            : "o hacé clic para seleccionarlos · sin límite de cantidad"}
        </div>
        {filas.length > 0 && pdfsEnProceso === 0 && (
          <div style={{
            marginTop: 16, padding: "8px 14px", background: "#fff",
            border: "1px solid #1a3a6b", borderRadius: 10,
            display: "inline-flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ fontSize: 13, color: "#1a3a6b", fontWeight: 700 }}>
              ✓ {filas.length} PDF{filas.length === 1 ? "" : "s"} cargado{filas.length === 1 ? "" : "s"}
            </span>
            <button onClick={e => { e.stopPropagation(); limpiarTodo(); }}
              style={{
                background: "#fee2e2", border: "none", borderRadius: 6,
                padding: "4px 10px", fontSize: 11, color: "#991b1b",
                cursor: "pointer", fontWeight: 600, fontFamily: "Geist, sans-serif",
              }}>Quitar todos</button>
          </div>
        )}
        <input
          ref={pdfInputRef} type="file" accept=".pdf" multiple
          style={{ display: "none" }}
          onChange={e => { onPdfsDrop(e.target.files); e.target.value = ""; }}
        />
      </div>

      {/* Editor de asunto y cuerpo del lote */}
      <div className="form-card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <div className="form-title" style={{ margin: 0 }}>
            ✉️ Asunto y cuerpo del correo
          </div>
          <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>
            Se aplica a TODOS los envíos del lote
          </span>
          <button onClick={restaurarPlantillaDefault}
            style={{
              background: "transparent", border: "1px solid #e4e7ec", borderRadius: 6,
              padding: "4px 10px", fontSize: 11, color: "#64748b", cursor: "pointer",
              fontWeight: 600, fontFamily: "Geist, sans-serif",
            }}>↺ Restaurar default</button>
        </div>

        <div className="field-row">
          <div className="field-label">Asunto</div>
          <input
            value={asuntoLote}
            onChange={e => setAsuntoLote(e.target.value)}
            placeholder="PREFACTURA {OPERACION}//{MES_FACTURA}//{TRANSPORTISTA}"
            style={{ fontSize: 13 }}
          />
        </div>

        <div className="field-row">
          <div className="field-label">Cuerpo del correo</div>
          <textarea
            value={cuerpoLote}
            onChange={e => setCuerpoLote(e.target.value)}
            placeholder="Estimado/a, ..."
            style={{ height: 320, fontSize: 12, fontFamily: "monospace", lineHeight: 1.6, resize: "vertical" }}
          />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Variables disponibles:</span>
          {VARIABLES_PLANTILLA_CL.map(v => (
            <code key={v} style={{
              background: "#eef2ff", color: "#1a3a6b", padding: "2px 8px",
              borderRadius: 4, fontSize: 11, fontFamily: "monospace",
            }}>{"{" + v + "}"}</code>
          ))}
        </div>

        <div style={{
          marginTop: 12, padding: "10px 12px", background: "#eef2ff", borderRadius: 8,
          fontSize: 11, color: "#1a3a6b",
        }}>
          💡 Las variables se reemplazan automáticamente con los datos extraídos de cada PDF.
          Tus cambios se guardan automáticamente en este navegador para la próxima vez.
        </div>
      </div>

      {filas.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10, marginBottom: 14,
        }}>
          <IndicadorPF label="PDFs procesados" valor={filas.length} color="#1a3a6b" />
          <IndicadorPF label="Listas para enviar" valor={totalListos} color="#16a34a" />
          <IndicadorPF label="Con errores" valor={totalConErrores} color="#dc2626" />
        </div>
      )}

      {filas.length > 0 && (
        <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{
            padding: "12px 16px", borderBottom: "1px solid #e4e7ec",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            flexWrap: "wrap", gap: 8,
          }}>
            <div className="form-title" style={{ margin: 0 }}>Revisión y envío</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(logFinal || filasConEstado.some(f => f.estadoEnvio)) && (
                <BotonDescargarExcel onClick={descargarLog} label="Descargar log Excel" />
              )}
              <button
                onClick={enviarMasivo}
                disabled={enviando || totalListos === 0}
                className="btn-orange"
                style={{ padding: "9px 18px", fontSize: 13 }}>
                {enviando
                  ? `Enviando ${progreso.actual}/${progreso.total}...`
                  : `📨 Enviar ${totalListos} correo${totalListos === 1 ? "" : "s"}`
                }
              </button>
            </div>
          </div>

          {enviando && (
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #e4e7ec", background: "#fffbeb" }}>
              <div style={{ fontSize: 12, color: "#92400e", marginBottom: 6, fontWeight: 600 }}>
                Enviando {progreso.actual} de {progreso.total}...
              </div>
              <div style={{ height: 8, background: "#fef3c7", borderRadius: 4, overflow: "hidden" }}>
                <div style={{
                  width: `${(progreso.actual / progreso.total) * 100}%`,
                  height: "100%", background: "#F47B20", transition: "width 0.3s",
                }} />
              </div>
            </div>
          )}

          {logFinal && !enviando && (
            <div style={{
              padding: "10px 16px", borderBottom: "1px solid #e4e7ec",
              background: logFinal.err === 0 ? "#f0fdf4" : "#fffbeb",
            }}>
              <div style={{
                fontSize: 13, fontWeight: 600,
                color: logFinal.err === 0 ? "#166534" : "#92400e",
              }}>
                {logFinal.err === 0 ? "✓" : "⚠"} Envío finalizado en {logFinal.segs}s ·{" "}
                {logFinal.ok} enviado{logFinal.ok === 1 ? "" : "s"} ·{" "}
                {logFinal.err} fallido{logFinal.err === 1 ? "" : "s"}
                {logFinal.omitidos > 0 && ` · ${logFinal.omitidos} omitido${logFinal.omitidos === 1 ? "" : "s"}`}
              </div>
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                  <th style={pf_th()}>Estado</th>
                  <th style={pf_th()}>Transportista</th>
                  <th style={pf_th()}>Operación</th>
                  <th style={pf_th()}>Período / Mes</th>
                  <th style={pf_th()}>Correo TO</th>
                  <th style={pf_th()}>CC</th>
                  <th style={pf_th()}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {filasConEstado.map((f) => (
                  <FilaPrefacturaCL
                    key={f.idx}
                    fila={f}
                    enEdicion={editFila === f.idx}
                    onEdit={() => setEditFila(f.idx)}
                    onGuardar={(campos) => guardarEdicion(f.idx, campos)}
                    onCancelar={() => setEditFila(null)}
                    onEliminar={() => eliminarFila(f.idx)}
                    onAgregarTransportista={() => setModalAgregar({
                      tipo: "trans",
                      prefill: { nombre: f.parsed.transportista, rut: f.parsed.rut },
                    })}
                    onAgregarOperacion={() => setModalAgregar({
                      tipo: "op",
                      prefill: { operacion: f.parsed.operacion, cliente: f.parsed.cliente,
                                 centro_costo: f.parsed.centroCosto, supervisor: f.parsed.supervisorPDF },
                    })}
                    enviando={enviando}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalAgregar?.tipo === "trans" && (
        <ModalEdicionTransportistaCL
          inicial={{
            nombre: modalAgregar.prefill.nombre || "",
            rut: modalAgregar.prefill.rut || "",
            estado: "Activo",
            correo: "", contacto: "", telefono: "", notas: "",
          }}
          esNuevo={true}
          onCancelar={() => setModalAgregar(null)}
          onGuardarOK={onAgregarYRefrescar}
        />
      )}
      {modalAgregar?.tipo === "op" && (
        <ModalEdicionParametroCL
          inicial={{
            operacion: modalAgregar.prefill.operacion || "",
            cliente: modalAgregar.prefill.cliente || "",
            centro_costo: modalAgregar.prefill.centro_costo || "",
            supervisor: modalAgregar.prefill.supervisor || "",
            correo_supervisor: "",
            lideres: "",
            region: "",
            cuenta_envio: "prefacturas@bigticket.cl",
          }}
          esNuevo={true}
          onCancelar={() => setModalAgregar(null)}
          onGuardarOK={onAgregarYRefrescar}
        />
      )}
    </div>
  );
}

function FilaPrefacturaCL({ fila, enEdicion, onEdit, onGuardar, onCancelar, onEliminar,
                            onAgregarTransportista, onAgregarOperacion, enviando }) {
  const [to, setTo] = useState(fila.editTo);
  const [cc, setCc] = useState(fila.editCc);
  const [bcc, setBcc] = useState(fila.editBcc);
  const [asunto, setAsunto] = useState(fila.asuntoFinal);
  const [cuerpo, setCuerpo] = useState(fila.cuerpoFinal);

  useEffect(() => {
    if (enEdicion) {
      setTo(fila.editTo); setCc(fila.editCc); setBcc(fila.editBcc);
      setAsunto(fila.asuntoFinal); setCuerpo(fila.cuerpoFinal);
    }
  }, [enEdicion, fila.editTo, fila.editCc, fila.editBcc, fila.asuntoFinal, fila.cuerpoFinal]);

  let bgFila = "transparent";
  if (fila.estadoEnvio === "ok") bgFila = "#f0fdf4";
  else if (fila.estadoEnvio === "fallido") bgFila = "#fef2f2";
  else if (fila.estadoEnvio === "enviando") bgFila = "#fffbeb";
  else if (!fila.listo) bgFila = "#fef2f2";

  if (enEdicion) {
    return (
      <tr style={{ background: "#eff6ff" }}>
        <td colSpan={7} style={{ padding: 14, borderBottom: "2px solid #1a3a6b" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>
            ✏️ Editando: {fila.parsed.transportista || fila.nombre} · {fila.parsed.operacion || "—"} · {fila.parsed.mesFactura || "—"}
          </div>
          <div className="two-col" style={{ marginBottom: 10 }}>
            <div>
              <div className="field-label">Correo TO *</div>
              <input value={to} onChange={e => setTo(e.target.value)}
                placeholder="correo@dominio.com (separá varios con ;)" />
            </div>
            <div>
              <div className="field-label">CC (supervisor + líderes)</div>
              <input value={cc} onChange={e => setCc(e.target.value)} placeholder="opcional" />
            </div>
          </div>
          <div className="field-row">
            <div className="field-label">BCC</div>
            <input value={bcc} onChange={e => setBcc(e.target.value)} placeholder="opcional" />
          </div>
          <div className="field-row">
            <div className="field-label">Asunto (override solo para esta fila)</div>
            <input value={asunto} onChange={e => setAsunto(e.target.value)} />
          </div>
          <div className="field-row">
            <div className="field-label">Cuerpo (override solo para esta fila · variables ya reemplazadas)</div>
            <textarea value={cuerpo} onChange={e => setCuerpo(e.target.value)} style={{ height: 200 }} />
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
            💡 Estos cambios solo aplican a este envío puntual.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onCancelar}
              style={{
                background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
                padding: "7px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
                fontFamily: "Geist, sans-serif", fontWeight: 600,
              }}>Cancelar</button>
            <button onClick={() => onGuardar({
              editTo: to, editCc: cc, editBcc: bcc,
              overrideAsunto: asunto, overrideCuerpo: cuerpo,
            })} className="btn-blue" style={{ padding: "7px 14px", fontSize: 12 }}>
              Guardar cambios
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const transNoReg = fila.parsed.transportista && !fila.trans;
  const opNoReg = fila.parsed.operacion && !fila.param;
  const transBloqueado = fila.trans && String(fila.trans.estado || "").toLowerCase() === "bloqueado";

  return (
    <tr style={{ background: bgFila }}>
      <td style={pf_td()}><EstadoBadgeCL fila={fila} /></td>
      <td style={pf_td()}>
        <div style={{ fontWeight: 600 }}>
          {fila.parsed.transportista || <em style={{ color: "#dc2626" }}>(no detectado)</em>}
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8" }}>{fila.parsed.rut || "sin RUT"}</div>
        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>📄 {fila.nombre.length > 35 ? fila.nombre.slice(0, 32) + "..." : fila.nombre}</div>
        {transNoReg && (
          <button onClick={onAgregarTransportista}
            style={{
              marginTop: 4, background: "#fef2f2", border: "1px solid #fca5a5",
              borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "#991b1b",
              cursor: "pointer", fontWeight: 600, fontFamily: "Geist, sans-serif",
            }}>+ Agregar a Supabase</button>
        )}
        {transBloqueado && (
          <div style={{ marginTop: 4, fontSize: 10, color: "#991b1b", fontWeight: 700 }}>
            ⛔ BLOQUEADO en Supabase
          </div>
        )}
      </td>
      <td style={pf_td()}>
        {fila.parsed.operacion ? (
          <>
            <span style={{
              background: fila.param ? "#eef2ff" : "#fef2f2",
              color: fila.param ? "#1a3a6b" : "#991b1b",
              padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
            }}>{fila.parsed.operacion}</span>
            {opNoReg && (
              <button onClick={onAgregarOperacion}
                style={{
                  display: "block", marginTop: 4,
                  background: "#fef2f2", border: "1px solid #fca5a5",
                  borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "#991b1b",
                  cursor: "pointer", fontWeight: 600, fontFamily: "Geist, sans-serif",
                }}>+ Agregar Operación</button>
            )}
          </>
        ) : <em style={{ color: "#dc2626", fontSize: 11 }}>(no detectado)</em>}
      </td>
      <td style={pf_td()}>
        <span style={{ fontSize: 11, color: "#475569" }}>{fila.parsed.periodo || "—"}</span>
        <div style={{ fontSize: 10, color: "#94a3b8" }}>{fila.parsed.mesFactura || ""}</div>
      </td>
      <td style={pf_td()}>
        <div style={{ wordBreak: "break-all", maxWidth: 220 }}>
          {fila.editTo || <em style={{ color: "#dc2626" }}>vacío</em>}
        </div>
        {fila.trans && (
          <div style={{ fontSize: 9, color: "#16a34a", marginTop: 2 }}>✓ desde Supabase</div>
        )}
      </td>
      <td style={pf_td()}>
        <div style={{ wordBreak: "break-all", maxWidth: 200, fontSize: 11, color: "#64748b" }}>
          {fila.editCc || "—"}
        </div>
      </td>
      <td style={pf_td()}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button onClick={onEdit}
            disabled={enviando || fila.estadoEnvio === "ok"}
            style={{
              background: "transparent", border: "1px solid #e4e7ec", borderRadius: 6,
              padding: "3px 8px", fontSize: 11, color: "#1a3a6b", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
              opacity: (enviando || fila.estadoEnvio === "ok") ? 0.4 : 1,
            }}>Editar</button>
          <button onClick={onEliminar} disabled={enviando}
            style={{
              background: "transparent", border: "1px solid #fca5a5", borderRadius: 6,
              padding: "3px 8px", fontSize: 11, color: "#991b1b", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
              opacity: enviando ? 0.4 : 1,
            }}>Quitar</button>
        </div>
      </td>
    </tr>
  );
}

function EstadoBadgeCL({ fila }) {
  if (fila.estadoEnvio === "ok") {
    return (
      <span style={{
        background: "#dcfce7", color: "#166534", padding: "3px 8px",
        borderRadius: 20, fontSize: 10, fontWeight: 700,
      }}>✓ ENVIADO</span>
    );
  }
  if (fila.estadoEnvio === "fallido") {
    return (
      <div title={fila.motivoEnvio}>
        <span style={{
          background: "#fee2e2", color: "#991b1b", padding: "3px 8px",
          borderRadius: 20, fontSize: 10, fontWeight: 700,
        }}>✗ FALLIDO</span>
        <div style={{ fontSize: 9, color: "#991b1b", marginTop: 2, maxWidth: 160 }}>
          {fila.motivoEnvio?.slice(0, 60)}{fila.motivoEnvio?.length > 60 ? "..." : ""}
        </div>
      </div>
    );
  }
  if (fila.estadoEnvio === "enviando") {
    return (
      <span style={{
        background: "#fef3c7", color: "#92400e", padding: "3px 8px",
        borderRadius: 20, fontSize: 10, fontWeight: 700,
      }}>⏳ ENVIANDO</span>
    );
  }
  if (!fila.listo) {
    return (
      <div title={fila.errores.join(" · ")}>
        <span style={{
          background: "#fee2e2", color: "#991b1b", padding: "3px 8px",
          borderRadius: 20, fontSize: 10, fontWeight: 700,
        }}>⚠ {fila.errores[0]}</span>
        {fila.errores.length > 1 && (
          <div style={{ fontSize: 9, color: "#991b1b", marginTop: 2 }}>
            +{fila.errores.length - 1} error{fila.errores.length === 2 ? "" : "es"} más
          </div>
        )}
      </div>
    );
  }
  return (
    <span style={{
      background: "#dbeafe", color: "#1e40af", padding: "3px 8px",
      borderRadius: 20, fontSize: 10, fontWeight: 700,
    }}>LISTO</span>
  );
}

function PrefCLTransportistas({ data, onChange }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [editando, setEditando] = useState(null);
  const [mostrarImportador, setMostrarImportador] = useState(false);

  const filtrados = useMemo(() => {
    let r = [...data];
    if (filtroEstado !== "todos") r = r.filter(t => (t.estado || "").toLowerCase() === filtroEstado);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      r = r.filter(t =>
        (t.nombre || "").toLowerCase().includes(q) ||
        (t.rut || "").toLowerCase().includes(q) ||
        (t.correo || "").toLowerCase().includes(q) ||
        (t.contacto || "").toLowerCase().includes(q)
      );
    }
    return r;
  }, [data, busqueda, filtroEstado]);

  const handleEliminar = async (id, nombre) => {
    if (!confirm(`¿Eliminar al transportista "${nombre}"?\n\nEsta acción no se puede deshacer.`)) return;
    try {
      const { error } = await sb.from("prefacturas_transportistas_cl").delete().eq("id", id);
      if (error) throw error;
      await onChange();
    } catch (e) {
      alert("Error eliminando: " + e.message);
    }
  };

  const filaEdicion = editando === "nuevo"
    ? { nombre: "", rut: "", estado: "Activo", correo: "", contacto: "", telefono: "", notas: "" }
    : (editando ? data.find(t => t.id === editando) : null);

  return (
    <div className="pg" style={{ maxWidth: 1300 }}>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="sec-title">Transportistas Chile</div>
          <div className="sec-sub">Nombre, RUT, correo, contacto, teléfono y estado. Estado "Bloqueado" impide envío.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BotonDescargarExcel
            onClick={async () => {
              const cabeceras = ["Nombre", "RUT", "Estado", "Correo", "Contacto", "Teléfono", "Notas"];
              const filas = filtrados.map(t => [
                t.nombre || "",
                t.rut || "",
                t.estado || "",
                t.correo || "",
                t.contacto || "",
                t.telefono || "",
                t.notas || "",
              ]);
              await descargarExcelMultihoja(
                [{ nombre: "Transportistas CL", datos: [cabeceras, ...filas] }],
                "transportistas_cl"
              );
            }}
            label="Descargar Excel"
          />
          <button onClick={() => setMostrarImportador(true)}
            style={{
              background: "#fff", border: "1px solid #1a3a6b", borderRadius: 8,
              padding: "9px 16px", fontSize: 13, color: "#1a3a6b", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
            }}>
            📤 Importar Excel
          </button>
          <button className="btn-orange" onClick={() => setEditando("nuevo")} style={{ padding: "9px 16px", fontSize: 13 }}>
            + Nuevo transportista
          </button>
        </div>
      </div>

      <div className="form-card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder="Buscar por nombre, RUT, correo o contacto..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)}
            style={{ flex: "1 1 280px", maxWidth: 400 }}
          />
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ width: 160 }}>
            <option value="todos">Todos los estados</option>
            <option value="activo">Activo</option>
            <option value="bloqueado">Bloqueado</option>
          </select>
          <div style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>
            {filtrados.length} de {data.length} transportistas
          </div>
        </div>
      </div>

      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <th style={pf_th()}>Nombre</th>
                <th style={pf_th()}>RUT</th>
                <th style={pf_th()}>Estado</th>
                <th style={pf_th()}>Correo</th>
                <th style={pf_th()}>Contacto</th>
                <th style={pf_th()}>Teléfono</th>
                <th style={pf_th()}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>
                  Sin resultados.
                </td></tr>
              ) : filtrados.map(t => (
                <tr key={t.id}>
                  <td style={pf_td()}>
                    <div style={{ fontWeight: 600 }}>{t.nombre}</div>
                    {t.notas && <div style={{ fontSize: 10, color: "#94a3b8" }}>{t.notas}</div>}
                  </td>
                  <td style={pf_td()}>
                    <code style={{ fontSize: 11, color: "#64748b" }}>{t.rut || "—"}</code>
                  </td>
                  <td style={pf_td()}>
                    <span style={{
                      background: (t.estado || "").toLowerCase() === "activo" ? "#dcfce7" : "#fee2e2",
                      color: (t.estado || "").toLowerCase() === "activo" ? "#166534" : "#991b1b",
                      padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                    }}>{t.estado || "—"}</span>
                  </td>
                  <td style={pf_td()}>
                    <div style={{ wordBreak: "break-all", maxWidth: 220, fontSize: 11 }}>
                      {t.correo || <em style={{ color: "#dc2626" }}>vacío</em>}
                    </div>
                  </td>
                  <td style={pf_td()}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{t.contacto || "—"}</span>
                  </td>
                  <td style={pf_td()}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{t.telefono || "—"}</span>
                  </td>
                  <td style={pf_td()}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditando(t.id)}
                        style={{
                          background: "transparent", border: "1px solid #e4e7ec", borderRadius: 6,
                          padding: "3px 8px", fontSize: 11, color: "#1a3a6b", cursor: "pointer",
                          fontWeight: 600, fontFamily: "Geist, sans-serif",
                        }}>Editar</button>
                      <button onClick={() => handleEliminar(t.id, t.nombre)}
                        style={{
                          background: "transparent", border: "1px solid #fca5a5", borderRadius: 6,
                          padding: "3px 8px", fontSize: 11, color: "#991b1b", cursor: "pointer",
                          fontWeight: 600, fontFamily: "Geist, sans-serif",
                        }}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filaEdicion && (
        <ModalEdicionTransportistaCL
          inicial={filaEdicion}
          esNuevo={editando === "nuevo"}
          editandoId={editando !== "nuevo" ? editando : null}
          onCancelar={() => setEditando(null)}
          onGuardarOK={async () => { setEditando(null); await onChange(); }}
        />
      )}

      {mostrarImportador && (
        <ModalImportadorTransportistas
          config={CONFIG_IMPORTADOR_CL}
          dataExistente={data}
          onCancelar={() => setMostrarImportador(false)}
          onImportadoOK={async () => { await onChange(); }}
        />
      )}
    </div>
  );
}

function ModalEdicionTransportistaCL({ inicial, esNuevo, editandoId, onCancelar, onGuardarOK }) {
  const [form, setForm] = useState(inicial);
  const [guardando, setGuardando] = useState(false);

  const handleGuardar = async () => {
    if (!form.nombre.trim()) { alert("El nombre es obligatorio."); return; }
    setGuardando(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        rut: (form.rut || "").trim() || null,
        estado: form.estado || "Activo",
        correo: (form.correo || "").trim() || null,
        contacto: (form.contacto || "").trim() || null,
        telefono: (form.telefono || "").trim() || null,
        notas: (form.notas || "").trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (esNuevo) {
        const { error } = await sb.from("prefacturas_transportistas_cl").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await sb.from("prefacturas_transportistas_cl").update(payload).eq("id", editandoId);
        if (error) throw error;
      }
      await onGuardarOK();
    } catch (e) {
      alert("Error guardando: " + e.message);
    }
    setGuardando(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20,
    }} onClick={onCancelar}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, padding: 24, maxWidth: 600, width: "100%",
        maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b", marginBottom: 16 }}>
          {esNuevo ? "Nuevo transportista Chile" : "Editar transportista"}
        </div>
        <div className="field-row">
          <div className="field-label">Nombre *</div>
          <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
            placeholder="Ej: ISISLINE SPA" />
        </div>
        <div className="two-col">
          <div className="field-row">
            <div className="field-label">RUT</div>
            <input value={form.rut || ""} onChange={e => setForm({ ...form, rut: e.target.value })}
              placeholder="77395507-7" />
          </div>
          <div className="field-row">
            <div className="field-label">Estado</div>
            <select value={form.estado || "Activo"} onChange={e => setForm({ ...form, estado: e.target.value })}>
              <option value="Activo">Activo</option>
              <option value="Bloqueado">Bloqueado (NO ENVIAR)</option>
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field-label">Correo *</div>
          <input value={form.correo || ""} onChange={e => setForm({ ...form, correo: e.target.value })}
            placeholder="correo@dominio.com" />
        </div>
        <div className="two-col">
          <div className="field-row">
            <div className="field-label">Contacto</div>
            <input value={form.contacto || ""} onChange={e => setForm({ ...form, contacto: e.target.value })}
              placeholder="Nombre persona contacto" />
          </div>
          <div className="field-row">
            <div className="field-label">Teléfono</div>
            <input value={form.telefono || ""} onChange={e => setForm({ ...form, telefono: e.target.value })}
              placeholder="940383148" />
          </div>
        </div>
        <div className="field-row">
          <div className="field-label">Notas internas</div>
          <textarea value={form.notas || ""} onChange={e => setForm({ ...form, notas: e.target.value })}
            placeholder="(opcional)" style={{ height: 60 }} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onCancelar} disabled={guardando}
            style={{
              background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
              padding: "8px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
            }}>Cancelar</button>
          <button onClick={handleGuardar} disabled={guardando} className="btn-blue"
            style={{ padding: "8px 14px", fontSize: 12 }}>
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PrefCLParametros({ data, onChange }) {
  const [editando, setEditando] = useState(null);
  const [busqueda, setBusqueda] = useState("");

  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return data;
    const q = busqueda.toLowerCase();
    return data.filter(p =>
      (p.operacion || "").toLowerCase().includes(q) ||
      (p.cliente || "").toLowerCase().includes(q) ||
      (p.centro_costo || "").toLowerCase().includes(q) ||
      (p.supervisor || "").toLowerCase().includes(q)
    );
  }, [data, busqueda]);

  const handleEliminar = async (id, op) => {
    if (!confirm(`¿Eliminar la operación "${op}"?`)) return;
    try {
      const { error } = await sb.from("prefacturas_parametros_cl").delete().eq("id", id);
      if (error) throw error;
      await onChange();
    } catch (e) {
      alert("Error eliminando: " + e.message);
    }
  };

  const filaEdicion = editando === "nuevo"
    ? { operacion: "", cliente: "", centro_costo: "", supervisor: "", correo_supervisor: "", lideres: "", region: "", cuenta_envio: "prefacturas@bigticket.cl" }
    : (editando ? data.find(p => p.id === editando) : null);

  return (
    <div className="pg" style={{ maxWidth: 1300 }}>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="sec-title">Operaciones / CECOs Chile</div>
          <div className="sec-sub">Cliente + Centro de Costo, supervisor, líderes y región. Supervisor y líderes van todos en CC.</div>
        </div>
        <button className="btn-orange" onClick={() => setEditando("nuevo")} style={{ padding: "9px 16px", fontSize: 13 }}>
          + Nueva operación
        </button>
      </div>

      <div className="form-card" style={{ padding: "12px 16px" }}>
        <input placeholder="Buscar por operación, cliente, CECO o supervisor..."
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          style={{ width: "100%", maxWidth: 500 }} />
      </div>

      <div className="form-card" style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}>
        <div style={{ fontSize: 12, color: "#1e40af" }}>
          💡 El asunto y cuerpo del correo se editan en la sub-tab <strong>"Envío masivo"</strong> antes de cada lote.
          Aquí solo se guarda la info estática por operación.
        </div>
      </div>

      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <th style={pf_th()}>Operación</th>
                <th style={pf_th()}>Cliente</th>
                <th style={pf_th()}>CECO</th>
                <th style={pf_th()}>Supervisor</th>
                <th style={pf_th()}>Correo supervisor</th>
                <th style={pf_th()}>Líderes</th>
                <th style={pf_th()}>Región</th>
                <th style={pf_th()}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>
                  Sin resultados.
                </td></tr>
              ) : filtrados.map(p => (
                <tr key={p.id}>
                  <td style={pf_td()}>
                    <span style={{
                      background: "#eef2ff", color: "#1a3a6b", padding: "3px 10px",
                      borderRadius: 4, fontSize: 11, fontWeight: 700,
                    }}>{p.operacion}</span>
                  </td>
                  <td style={pf_td()}><span style={{ fontSize: 11 }}>{p.cliente || "—"}</span></td>
                  <td style={pf_td()}><span style={{ fontSize: 11 }}>{p.centro_costo || "—"}</span></td>
                  <td style={pf_td()}>{p.supervisor || <em style={{ color: "#94a3b8" }}>—</em>}</td>
                  <td style={pf_td()}>
                    <span style={{ fontSize: 11, color: "#64748b", wordBreak: "break-all" }}>
                      {p.correo_supervisor || "—"}
                    </span>
                  </td>
                  <td style={pf_td()}>
                    <span style={{ fontSize: 10, color: "#64748b", wordBreak: "break-all", maxWidth: 220, display: "block" }}>
                      {p.lideres || "—"}
                    </span>
                  </td>
                  <td style={pf_td()}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{p.region || "—"}</span>
                  </td>
                  <td style={pf_td()}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditando(p.id)}
                        style={{
                          background: "transparent", border: "1px solid #e4e7ec", borderRadius: 6,
                          padding: "3px 8px", fontSize: 11, color: "#1a3a6b", cursor: "pointer",
                          fontWeight: 600, fontFamily: "Geist, sans-serif",
                        }}>Editar</button>
                      <button onClick={() => handleEliminar(p.id, p.operacion)}
                        style={{
                          background: "transparent", border: "1px solid #fca5a5", borderRadius: 6,
                          padding: "3px 8px", fontSize: 11, color: "#991b1b", cursor: "pointer",
                          fontWeight: 600, fontFamily: "Geist, sans-serif",
                        }}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filaEdicion && (
        <ModalEdicionParametroCL
          inicial={filaEdicion}
          esNuevo={editando === "nuevo"}
          editandoId={editando !== "nuevo" ? editando : null}
          onCancelar={() => setEditando(null)}
          onGuardarOK={async () => { setEditando(null); await onChange(); }}
        />
      )}
    </div>
  );
}

function ModalEdicionParametroCL({ inicial, esNuevo, editandoId, onCancelar, onGuardarOK }) {
  const [form, setForm] = useState(inicial);
  const [guardando, setGuardando] = useState(false);

  const handleGuardar = async () => {
    if (!form.operacion.trim()) { alert("La operación es obligatoria."); return; }
    setGuardando(true);
    try {
      const payload = {
        operacion: form.operacion.trim().toUpperCase(),
        cliente: (form.cliente || "").trim() || null,
        centro_costo: (form.centro_costo || "").trim() || null,
        supervisor: (form.supervisor || "").trim() || null,
        correo_supervisor: (form.correo_supervisor || "").trim() || null,
        lideres: (form.lideres || "").trim() || null,
        region: (form.region || "").trim() || null,
        cuenta_envio: (form.cuenta_envio || "").trim() || "prefacturas@bigticket.cl",
        updated_at: new Date().toISOString(),
      };
      if (esNuevo) {
        const { error } = await sb.from("prefacturas_parametros_cl").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await sb.from("prefacturas_parametros_cl").update(payload).eq("id", editandoId);
        if (error) throw error;
      }
      await onGuardarOK();
    } catch (e) {
      alert("Error guardando: " + e.message);
    }
    setGuardando(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20,
    }} onClick={onCancelar}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, padding: 24, maxWidth: 700, width: "100%",
        maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b", marginBottom: 16 }}>
          {esNuevo ? "Nueva operación Chile" : "Editar operación"}
        </div>
        <div className="field-row">
          <div className="field-label">Operación *  <span style={{ color: "#94a3b8", fontWeight: 400 }}>(formato: CLIENTE - CECO)</span></div>
          <input value={form.operacion} onChange={e => setForm({ ...form, operacion: e.target.value.toUpperCase() })}
            placeholder="MERCADO LIBRE - RM" disabled={!esNuevo} />
        </div>
        <div className="two-col">
          <div className="field-row">
            <div className="field-label">Cliente</div>
            <input value={form.cliente || ""} onChange={e => setForm({ ...form, cliente: e.target.value })}
              placeholder="MERCADO LIBRE" />
          </div>
          <div className="field-row">
            <div className="field-label">Centro de Costo</div>
            <input value={form.centro_costo || ""} onChange={e => setForm({ ...form, centro_costo: e.target.value })}
              placeholder="RM" />
          </div>
        </div>
        <div className="two-col">
          <div className="field-row">
            <div className="field-label">Supervisor</div>
            <input value={form.supervisor || ""} onChange={e => setForm({ ...form, supervisor: e.target.value })}
              placeholder="MANUEL NEIRA | CONSTANZA SOTO" />
          </div>
          <div className="field-row">
            <div className="field-label">Región</div>
            <input value={form.region || ""} onChange={e => setForm({ ...form, region: e.target.value })}
              placeholder="RM, V, VI, VIII, IV, XV..." />
          </div>
        </div>
        <div className="field-row">
          <div className="field-label">Correo supervisor (irá en CC)</div>
          <input value={form.correo_supervisor || ""} onChange={e => setForm({ ...form, correo_supervisor: e.target.value })}
            placeholder="manuel.neira@bigticket.cl; constanza.soto@bigticket.cl" />
        </div>
        <div className="field-row">
          <div className="field-label">Líderes (también irán en CC · separá con ;)</div>
          <textarea value={form.lideres || ""} onChange={e => setForm({ ...form, lideres: e.target.value })}
            placeholder="randy.becerra@bigticket.cl; leonardo.castro@bigticket.cl"
            style={{ height: 60 }} />
        </div>
        <div className="field-row">
          <div className="field-label">Cuenta envío</div>
          <input value={form.cuenta_envio || ""} onChange={e => setForm({ ...form, cuenta_envio: e.target.value })}
            placeholder="prefacturas@bigticket.cl" />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onCancelar} disabled={guardando}
            style={{
              background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
              padding: "8px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
            }}>Cancelar</button>
          <button onClick={handleGuardar} disabled={guardando} className="btn-blue"
            style={{ padding: "8px 14px", fontSize: 12 }}>
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

async function pf_cargarXLSX_imp() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return window.XLSX;
}

function ModalImportadorTransportistas({ config, dataExistente, onCancelar, onImportadoOK }) {
  // config: {
  //   pais: "MX" | "CL",
  //   tabla: "prefacturas_transportistas_mx" | "prefacturas_transportistas_cl",
  //   columnas: [{key, label, oblig, validador?}],
  //   identificadorUnico: "rfc" | "rut",   // campo que define duplicado (además del nombre)
  //   ejemploFila: { nombre: "...", rfc: "...", ... }
  // }
  const [arrastrando, setArrastrando] = useState(false);
  const [analizando, setAnalizando] = useState(false);
  const [filas, setFilas] = useState([]);  // [{ data, estado: "nuevo"|"duplicado"|"error", errores: [], duplicadoConId? }]
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [errorGeneral, setErrorGeneral] = useState("");
  const fileInputRef = useRef(null);

  // ─── Descargar plantilla vacía ─────────────────────────────────────────────
  const descargarPlantilla = async () => {
    try {
      const XLSX = await pf_cargarXLSX_imp();
      const cabeceras = config.columnas.map(c => c.label);
      const ejemplo = config.columnas.map(c => config.ejemploFila[c.key] || "");
      const datos = [cabeceras, ejemplo];

      const ws = XLSX.utils.aoa_to_sheet(datos);
      // Anchos sugeridos
      ws["!cols"] = config.columnas.map(c => ({ wch: Math.max(c.label.length + 4, 18) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Transportistas");
      XLSX.writeFile(wb, `plantilla_transportistas_${config.pais.toLowerCase()}.xlsx`);
    } catch (e) {
      alert("Error generando plantilla: " + e.message);
    }
  };

  // ─── Procesar Excel cargado ────────────────────────────────────────────────
  const procesarExcel = async (file) => {
    setErrorGeneral("");
    setResultado(null);
    setAnalizando(true);
    try {
      const XLSX = await pf_cargarXLSX_imp();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const filas2D = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      if (filas2D.length < 2) {
        setErrorGeneral("El Excel está vacío o solo tiene la cabecera.");
        setFilas([]);
        setAnalizando(false);
        return;
      }

      // Primera fila = headers
      const headers = filas2D[0].map(h => String(h || "").trim().toLowerCase());

      // Mapear cada columna del Excel a una key del esquema
      // Acepta tanto el label como la key como nombre de columna
      const headerToKey = {};
      config.columnas.forEach(c => {
        const labelLower = c.label.toLowerCase();
        const keyLower = c.key.toLowerCase();
        const idx = headers.findIndex(h => h === labelLower || h === keyLower);
        if (idx >= 0) headerToKey[idx] = c.key;
      });

      // Verificar que al menos los campos obligatorios estén presentes
      const obligs = config.columnas.filter(c => c.oblig);
      const obligsFaltantes = obligs.filter(c => !Object.values(headerToKey).includes(c.key));
      if (obligsFaltantes.length > 0) {
        setErrorGeneral(`Faltan columnas obligatorias: ${obligsFaltantes.map(c => c.label).join(", ")}`);
        setFilas([]);
        setAnalizando(false);
        return;
      }

      // Lookup para detectar duplicados (case-insensitive)
      const lookupNombre = new Map();
      const lookupId = new Map();
      dataExistente.forEach(t => {
        if (t.nombre) lookupNombre.set(String(t.nombre).toUpperCase().trim(), t);
        const idVal = t[config.identificadorUnico];
        if (idVal) lookupId.set(String(idVal).toUpperCase().trim(), t);
      });

      // Para detectar duplicados dentro del mismo Excel
      const yaVistosNombre = new Set();
      const yaVistosId = new Set();

      const filasProcesadas = [];
      for (let i = 1; i < filas2D.length; i++) {
        const raw = filas2D[i];
        // Saltar filas totalmente vacías
        if (!raw || raw.every(c => c == null || String(c).trim() === "")) continue;

        // Armar el objeto data según el esquema
        const data = {};
        Object.entries(headerToKey).forEach(([excelIdx, key]) => {
          const val = raw[Number(excelIdx)];
          data[key] = val == null ? "" : String(val).trim();
        });

        // Validar obligatorios
        const errores = [];
        obligs.forEach(c => {
          if (!data[c.key] || data[c.key].trim() === "") {
            errores.push(`Falta ${c.label}`);
          }
        });

        // Validadores custom por columna
        config.columnas.forEach(c => {
          if (c.validador && data[c.key]) {
            const err = c.validador(data[c.key]);
            if (err) errores.push(err);
          }
        });

        // Detectar duplicado: por nombre o por identificador único (RFC/RUT)
        let estado = "nuevo";
        let duplicadoConId = null;
        let motivoDup = "";
        const nombreUp = (data.nombre || "").toUpperCase().trim();
        const idUp = (data[config.identificadorUnico] || "").toUpperCase().trim();

        if (yaVistosNombre.has(nombreUp)) {
          errores.push("Duplicado dentro del Excel (mismo nombre)");
        }
        if (idUp && yaVistosId.has(idUp)) {
          errores.push(`Duplicado dentro del Excel (mismo ${config.identificadorUnico.toUpperCase()})`);
        }

        if (errores.length === 0) {
          if (nombreUp && lookupNombre.has(nombreUp)) {
            estado = "duplicado";
            duplicadoConId = lookupNombre.get(nombreUp).id;
            motivoDup = "Mismo nombre ya existe en Supabase";
          } else if (idUp && lookupId.has(idUp)) {
            estado = "duplicado";
            duplicadoConId = lookupId.get(idUp).id;
            motivoDup = `Mismo ${config.identificadorUnico.toUpperCase()} ya existe en Supabase`;
          }
        } else {
          estado = "error";
        }

        if (nombreUp) yaVistosNombre.add(nombreUp);
        if (idUp) yaVistosId.add(idUp);

        filasProcesadas.push({
          filaExcel: i + 1,
          data,
          estado,
          errores,
          motivoDup,
          duplicadoConId,
        });
      }

      setFilas(filasProcesadas);
    } catch (e) {
      setErrorGeneral("Error procesando Excel: " + e.message);
      setFilas([]);
    }
    setAnalizando(false);
  };

  const onFileDrop = (fileList) => {
    const archivos = Array.from(fileList || []).filter(f => /\.(xlsx|xls)$/i.test(f.name) && f.size > 0);
    if (archivos.length === 0) {
      setErrorGeneral("Subí un archivo Excel (.xlsx).");
      return;
    }
    procesarExcel(archivos[0]);
  };

  // ─── Importar (insertar las filas "nuevas" en Supabase) ────────────────────
  const importar = async () => {
    const aInsertar = filas.filter(f => f.estado === "nuevo");
    if (aInsertar.length === 0) {
      alert("No hay registros nuevos para importar.");
      return;
    }
    const omitidos = filas.length - aInsertar.length;
    if (!confirm(
      `Se insertarán ${aInsertar.length} transportista(s) nuevos.\n` +
      `${omitidos > 0 ? `(Se omiten ${omitidos} duplicados/errores)\n` : ""}\n` +
      `¿Confirmás la importación?`
    )) return;

    setImportando(true);
    let okCount = 0, errCount = 0;
    const erroresDetallados = [];
    const BATCH_SIZE = 50;  // Supabase rate limit

    for (let i = 0; i < aInsertar.length; i += BATCH_SIZE) {
      const lote = aInsertar.slice(i, i + BATCH_SIZE);
      const payloads = lote.map(f => {
        const p = { ...f.data };
        // Limpiar strings vacíos a null para columnas opcionales
        config.columnas.forEach(c => {
          if (!c.oblig && p[c.key] === "") p[c.key] = null;
        });
        // Estado default
        if (!p.estado) p.estado = "Activo";
        p.updated_at = new Date().toISOString();
        return p;
      });
      try {
        const { error } = await sb.from(config.tabla).insert(payloads);
        if (error) {
          errCount += lote.length;
          erroresDetallados.push(`Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
        } else {
          okCount += lote.length;
        }
      } catch (e) {
        errCount += lote.length;
        erroresDetallados.push(`Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${e.message}`);
      }
    }

    setResultado({ ok: okCount, err: errCount, omitidos, erroresDetallados });
    setImportando(false);

    if (okCount > 0) {
      // Refrescar la lista de transportistas en el padre
      await onImportadoOK();
    }
  };

  // ─── Contadores y stats ────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: filas.length,
    nuevos: filas.filter(f => f.estado === "nuevo").length,
    duplicados: filas.filter(f => f.estado === "duplicado").length,
    conError: filas.filter(f => f.estado === "error").length,
  }), [filas]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20,
    }} onClick={!importando ? onCancelar : undefined}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, padding: 24, maxWidth: 1100, width: "100%",
        maxHeight: "92vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>
              Importador masivo · Transportistas {config.pais}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
              Subí un Excel con la nómina de transportistas. Validamos antes de insertar.
            </div>
          </div>
          <button onClick={descargarPlantilla}
            style={{
              background: "#fff", border: "1px solid #1a3a6b", borderRadius: 8,
              padding: "8px 14px", fontSize: 12, color: "#1a3a6b", cursor: "pointer",
              fontFamily: "Geist, sans-serif", fontWeight: 600,
            }}>
            📋 Descargar plantilla
          </button>
        </div>

        {errorGeneral && (
          <div style={{
            background: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b",
            padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13,
          }}>⚠ {errorGeneral}</div>
        )}

        {filas.length === 0 && !resultado && (
          <>
            {/* Drag-and-drop */}
            <div
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setArrastrando(true); }}
              onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setArrastrando(false); }}
              onDrop={e => {
                e.preventDefault(); e.stopPropagation();
                setArrastrando(false);
                onFileDrop(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `3px dashed ${arrastrando ? "#F47B20" : "#1a3a6b"}`,
                borderRadius: 12, padding: "40px 24px", textAlign: "center",
                cursor: "pointer", background: arrastrando ? "#fff7ed" : "#f8fafc",
                marginBottom: 16, transition: "all 0.2s",
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 10 }}>📤</div>
              <div style={{ fontSize: 15, color: "#1a3a6b", fontWeight: 700, marginBottom: 4 }}>
                {analizando
                  ? "Analizando Excel..."
                  : arrastrando
                    ? "Soltá el Excel aquí"
                    : "Arrastrá el Excel de transportistas"}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                o hacé clic para seleccionar · solo .xlsx
              </div>
              <input
                ref={fileInputRef} type="file" accept=".xlsx,.xls"
                style={{ display: "none" }}
                onChange={e => { onFileDrop(e.target.files); e.target.value = ""; }}
              />
            </div>

            {/* Instrucciones */}
            <div style={{
              background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8,
              padding: 14, fontSize: 12, color: "#1a3a6b", lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>💡 Formato esperado del Excel:</div>
              <div>El archivo debe tener una hoja con las siguientes columnas (en la primera fila):</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {config.columnas.map(c => (
                  <code key={c.key} style={{
                    background: "#fff", border: "1px solid #bfdbfe", borderRadius: 4,
                    padding: "2px 8px", fontSize: 11, fontFamily: "monospace",
                  }}>
                    {c.label}{c.oblig ? " *" : ""}
                  </code>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 11 }}>
                * = obligatorio · Descargá la plantilla arriba para tener el formato exacto.
              </div>
            </div>
          </>
        )}

        {filas.length > 0 && !resultado && (
          <>
            {/* Indicadores */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10, marginBottom: 16,
            }}>
              <IndicadorImp label="Total" valor={stats.total} color="#1a3a6b" />
              <IndicadorImp label="Nuevos" valor={stats.nuevos} color="#16a34a" />
              <IndicadorImp label="Duplicados" valor={stats.duplicados} color="#f59e0b" />
              <IndicadorImp label="Con errores" valor={stats.conError} color="#dc2626" />
            </div>

            {/* Tabla preview */}
            <div style={{
              border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden",
              maxHeight: "45vh", overflowY: "auto", marginBottom: 16,
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 1 }}>
                  <tr>
                    <th style={pf_th()}>Fila</th>
                    <th style={pf_th()}>Estado</th>
                    {config.columnas.map(c => (
                      <th key={c.key} style={pf_th()}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map(f => {
                    let bg = "transparent";
                    if (f.estado === "nuevo")      bg = "#f0fdf4";
                    if (f.estado === "duplicado")  bg = "#fffbeb";
                    if (f.estado === "error")      bg = "#fef2f2";
                    return (
                      <tr key={f.filaExcel} style={{ background: bg, borderTop: "1px solid #f1f5f9" }}>
                        <td style={pf_td()}><span style={{ fontSize: 10, color: "#94a3b8" }}>#{f.filaExcel}</span></td>
                        <td style={pf_td()}>
                          {f.estado === "nuevo" && (
                            <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
                              ✓ NUEVO
                            </span>
                          )}
                          {f.estado === "duplicado" && (
                            <div title={f.motivoDup}>
                              <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
                                ⊘ DUPLICADO
                              </span>
                              <div style={{ fontSize: 9, color: "#92400e", marginTop: 2 }}>{f.motivoDup}</div>
                            </div>
                          )}
                          {f.estado === "error" && (
                            <div title={f.errores.join(" · ")}>
                              <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
                                ✗ ERROR
                              </span>
                              <div style={{ fontSize: 9, color: "#991b1b", marginTop: 2, maxWidth: 200 }}>
                                {f.errores[0]}
                                {f.errores.length > 1 && ` (+${f.errores.length - 1})`}
                              </div>
                            </div>
                          )}
                        </td>
                        {config.columnas.map(c => (
                          <td key={c.key} style={{ ...pf_td(), maxWidth: 180, wordBreak: "break-all", fontSize: 11 }}>
                            {f.data[c.key] || <em style={{ color: "#cbd5e1" }}>—</em>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{
              fontSize: 11, color: "#64748b", marginBottom: 14, padding: "10px 12px",
              background: "#f8fafc", borderRadius: 8,
            }}>
              💡 Al confirmar se insertan solo los registros marcados como <strong style={{ color: "#16a34a" }}>NUEVO</strong>.
              Los <strong style={{ color: "#f59e0b" }}>DUPLICADOS</strong> se saltan (no se modifica nada existente).
              Los <strong style={{ color: "#dc2626" }}>ERRORES</strong> se omiten — corregilos en el Excel y volvé a importar.
            </div>
          </>
        )}

        {resultado && (
          <div style={{
            background: resultado.err === 0 ? "#f0fdf4" : "#fffbeb",
            border: `1px solid ${resultado.err === 0 ? "#86efac" : "#fde68a"}`,
            borderRadius: 10, padding: 16, marginBottom: 14,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: resultado.err === 0 ? "#166534" : "#92400e", marginBottom: 8 }}>
              {resultado.err === 0 ? "✓ Importación completada" : "⚠ Importación con errores"}
            </div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.8 }}>
              <div><strong style={{ color: "#16a34a" }}>{resultado.ok}</strong> registro(s) insertados correctamente</div>
              {resultado.err > 0 && (
                <div><strong style={{ color: "#dc2626" }}>{resultado.err}</strong> registro(s) fallaron al insertar</div>
              )}
              {resultado.omitidos > 0 && (
                <div><strong style={{ color: "#f59e0b" }}>{resultado.omitidos}</strong> registro(s) omitidos (duplicados o con errores)</div>
              )}
            </div>
            {resultado.erroresDetallados.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 12, cursor: "pointer", color: "#991b1b", fontWeight: 600 }}>
                  Ver errores detallados ({resultado.erroresDetallados.length})
                </summary>
                <div style={{ fontSize: 11, color: "#991b1b", marginTop: 8, lineHeight: 1.6 }}>
                  {resultado.erroresDetallados.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Botones */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {resultado ? (
            <button onClick={onCancelar} className="btn-blue"
              style={{ padding: "9px 18px", fontSize: 13 }}>
              Cerrar
            </button>
          ) : filas.length === 0 ? (
            <button onClick={onCancelar}
              style={{
                background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
                padding: "9px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
                fontFamily: "Geist, sans-serif", fontWeight: 600,
              }}>Cancelar</button>
          ) : (
            <>
              <button onClick={() => { setFilas([]); setErrorGeneral(""); setResultado(null); }}
                disabled={importando}
                style={{
                  background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
                  padding: "9px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
                  fontFamily: "Geist, sans-serif", fontWeight: 600,
                  opacity: importando ? 0.4 : 1,
                }}>← Subir otro Excel</button>
              <button onClick={onCancelar} disabled={importando}
                style={{
                  background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
                  padding: "9px 14px", fontSize: 12, color: "#475569", cursor: "pointer",
                  fontFamily: "Geist, sans-serif", fontWeight: 600,
                  opacity: importando ? 0.4 : 1,
                }}>Cancelar</button>
              <button onClick={importar}
                disabled={importando || stats.nuevos === 0}
                className="btn-orange"
                style={{ padding: "9px 18px", fontSize: 13 }}>
                {importando
                  ? "Importando..."
                  : `📥 Confirmar e importar ${stats.nuevos} nuevo${stats.nuevos === 1 ? "" : "s"}`
                }
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function IndicadorImp({ label, valor, color }) {
  return (
    <div style={{
      background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8,
      padding: "10px 12px",
    }}>
      <div style={{
        fontSize: 10, color: "#94a3b8", textTransform: "uppercase",
        letterSpacing: 0.5, marginBottom: 4, fontWeight: 600,
      }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{valor}</div>
    </div>
  );
}

const CONFIG_IMPORTADOR_MX = {
  pais: "MX",
  tabla: "prefacturas_transportistas_mx",
  identificadorUnico: "rfc",
  columnas: [
    { key: "nombre",     label: "Nombre",     oblig: true },
    { key: "rfc",        label: "RFC",        oblig: false },
    { key: "estado",     label: "Estado",     oblig: false },  // Activo / Inactivo
    { key: "correo_to",  label: "Correo TO",  oblig: false,
      validador: v => v && !/^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/.test(v.trim()) ? "Correo TO inválido" : null },
    { key: "correo_cc",  label: "Correo CC",  oblig: false },
    { key: "correo_bcc", label: "Correo BCC", oblig: false },
    { key: "notas",      label: "Notas",      oblig: false },
  ],
  ejemploFila: {
    nombre: "EJEMPLO TRANSPORTISTA MX",
    rfc: "EJM850101AAA",
    estado: "Activo",
    correo_to: "ejemplo@dominio.com",
    correo_cc: "supervisor@bigticket.mx",
    correo_bcc: "",
    notas: "(opcional)",
  },
};

const CONFIG_IMPORTADOR_CL = {
  pais: "CL",
  tabla: "prefacturas_transportistas_cl",
  identificadorUnico: "rut",
  columnas: [
    { key: "nombre",    label: "Nombre",    oblig: true },
    { key: "rut",       label: "RUT",       oblig: false,
      validador: v => v && !/^[0-9]{1,10}-[0-9Kk]$/.test(v.trim()) ? "RUT inválido (formato: 12345678-9)" : null },
    { key: "estado",    label: "Estado",    oblig: false },  // Activo / Bloqueado
    { key: "correo",    label: "Correo",    oblig: false,
      validador: v => v && !/^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/.test(v.trim()) ? "Correo inválido" : null },
    { key: "contacto",  label: "Contacto",  oblig: false },
    { key: "telefono",  label: "Teléfono",  oblig: false },
    { key: "notas",     label: "Notas",     oblig: false },
  ],
  ejemploFila: {
    nombre: "EJEMPLO TRANSPORTES SPA",
    rut: "77123456-7",
    estado: "Activo",
    correo: "ejemplo@dominio.cl",
    contacto: "Juan Pérez",
    telefono: "+56 9 1234 5678",
    notas: "(opcional)",
  },
};

export default ModuloPagosMadre;
