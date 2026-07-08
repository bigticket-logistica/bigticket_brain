import { useCallback, useEffect, useMemo, useState } from "react";
import { descargarExcelMeli, descargarExcelMultihoja, fechaHoyOperativa, fechaOperativaOffset, pct, sb } from "./shared";

const NOMBRES_MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", 
                     "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function diasDelMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

function rangoMesGlobal(mesGlobal) {
  const yyyy = mesGlobal.anio;
  const mm = String(mesGlobal.mes).padStart(2, '0');
  const desde = `${yyyy}-${mm}-01`;
  
  const hoy = new Date();
  const esMesActual = mesGlobal.anio === hoy.getFullYear() && mesGlobal.mes === (hoy.getMonth() + 1);
  
  let hasta;
  if (esMesActual) {
    // Mes en curso: hasta ayer
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    hasta = ayer.toISOString().slice(0, 10);
  } else {
    // Mes pasado: mes completo
    const ultDia = diasDelMes(mesGlobal.anio, mesGlobal.mes);
    hasta = `${yyyy}-${mm}-${String(ultDia).padStart(2, '0')}`;
  }
  return { desde, hasta };
}

function IndicadoresOperacionalesMX({ usuario }) {
  const [vista, setVista] = useState("compromiso");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [scs, setSCs] = useState([]);
  const [scores, setScores] = useState([]);
  const [modal, setModal] = useState(null);
  
  // ─── SELECTOR GLOBAL DE MES ─────────────────────────────────────────────
  const [mesesDisponibles, setMesesDisponibles] = useState([]);
  const [mesGlobal, setMesGlobal] = useState(() => {
    const hoy = new Date();
    return { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 };
  });

  // Estado para vista detalle in-place (driver o vehículo)
  const [detalle, setDetalle] = useState(null); // { tipo: 'driver'|'vehiculo', registro: {...} }

  // Cargar meses disponibles UNA sola vez al montar
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await sb.rpc("get_meses_con_datos_meli");
        if (error) throw error;
        setMesesDisponibles(data || []);
        // Si no hay datos del mes actual, ir al mes más reciente
        const hoy = new Date();
        const anioActual = hoy.getFullYear(), mesActual = hoy.getMonth() + 1;
        const tieneActual = (data || []).some(m => m.anio === anioActual && m.mes === mesActual);
        if (!tieneActual && data && data.length > 0) {
          setMesGlobal({ anio: data[0].anio, mes: data[0].mes });
        }
      } catch (e) {
        console.error("Error cargando meses:", e);
      }
    })();
  }, []);

  // Recargar TODOS los datos cuando cambia el mes
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { desde, hasta } = rangoMesGlobal(mesGlobal);
        
        const [r1, r2, r3, r4, r5] = await Promise.all([
          sb.from("vw_meli_dashboard_resumen").select("*").maybeSingle(),
          sb.rpc("get_inventario_drivers_mes", { fecha_desde: desde, fecha_hasta: hasta }),
          sb.rpc("get_inventario_vehiculos_mes", { fecha_desde: desde, fecha_hasta: hasta }),
          sb.rpc("get_ciclo_aceptacion_sc", { fecha_desde: desde, fecha_hasta: hasta }),
          sb.rpc("get_score_compromiso", { fecha_desde: desde, fecha_hasta: hasta }),
        ]);
        if (!alive) return;
        if (r1.error || r2.error || r3.error || r4.error || r5.error) {
          throw new Error(r1.error?.message || r2.error?.message || r3.error?.message || r4.error?.message || r5.error?.message);
        }
        setResumen(r1.data);
        setDrivers((r2.data || []).sort((a, b) => (b.viajes_total || 0) - (a.viajes_total || 0)));
        setVehiculos((r3.data || []).sort((a, b) => (b.viajes_total || 0) - (a.viajes_total || 0)));
        setSCs((r4.data || []).sort((a, b) => (b.ofrecidas || 0) - (a.ofrecidas || 0)));
        setScores((r5.data || []).sort((a, b) => (b.score_total || 0) - (a.score_total || 0)));
      } catch (e) {
        if (alive) setError(e.message || "Error cargando datos");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [mesGlobal.anio, mesGlobal.mes]);

  // Tabs: Compromiso MELI, KPI de Operación, Diferencias Maestros, Inventario, Control Helper
  // Nota: pestaña "validacion_bt" oculta del menú (render condicional abajo queda intacto).
  // El Padrón MELI (altas/bajas/cambios) se movió a Administración → "Padrón MELI".
  const tabs = [
    { id: "compromiso", label: "Torre de Control Compromiso", desc: "Compromiso MELI · SDD vs SPOT" },
    { id: "torre_rostering_hoy", label: "Torre de Control Rostering Hoy", desc: "Operativo en vivo · cronómetros + alertas SDD" },
    { id: "kpi_operacion", label: "KPI de Operación", desc: "NS Informe MELI vs Snapshots" },
    { id: "inventario", label: "Inventario", desc: "Drivers, vehículos, fantasmas" },
    { id: "control_helper", label: "Control Helper", desc: "Helpers no autorizados / certificados / fantasmas" },
  ];

  if (loading) {
    return (
      <div className="pg">
        <div className="sec-title">Indicadores Operacionales MX</div>
        <div className="sec-sub">Pool Mercado Libre · Bigticket México</div>
        <div className="form-card" style={{ textAlign: "center", padding: 40, color: "#666" }}>
          Cargando indicadores…
        </div>
      </div>
    );
  }

  // Tabs que NO dependen del loader pesado del wrapper
  const tabsIndependientes = ["torre_rostering_hoy", "compromiso", "control_helper"];
  if (error && !tabsIndependientes.includes(vista)) {
    return (
      <div className="pg">
        <div className="sec-title">Indicadores Operacionales MX</div>
        <div className="sec-sub">Pool Mercado Libre · Bigticket México</div>
        <div className="form-card" style={{ background: "#fef2f2", border: "1px solid #fecaca", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#991b1b", marginBottom: 6 }}>
            No se pudo cargar la información del módulo
          </div>
          <div style={{ fontSize: 12, color: "#7f1d1d", lineHeight: 1.6 }}>
            {error}
            <br /><br />
            <strong>Causa probable:</strong> timeout en alguna RPC pesada. Probá las tabs:
            {" "}<button onClick={() => setVista("torre_rostering_hoy")}
                 style={{background:"none",border:"none",color:"#1a3a6b",fontWeight:600,cursor:"pointer",padding:0,textDecoration:"underline"}}>Torre de Control Rostering Hoy</button>,
            {" "}<button onClick={() => setVista("compromiso")}
                 style={{background:"none",border:"none",color:"#1a3a6b",fontWeight:600,cursor:"pointer",padding:0,textDecoration:"underline"}}>Torre de Control Compromiso</button> o
            {" "}<button onClick={() => setVista("control_helper")}
                 style={{background:"none",border:"none",color:"#1a3a6b",fontWeight:600,cursor:"pointer",padding:0,textDecoration:"underline"}}>Control Helper</button>
            {" "}que no requieren los datos pesados.
          </div>
        </div>
      </div>
    );
  }

  // Vista detalle ocupa toda la pantalla del módulo
  if (detalle) {
    return (
      <PoolMeliDetalleRegistro 
        tipo={detalle.tipo} 
        registro={detalle.registro} 
        onVolver={() => setDetalle(null)} 
      />
    );
  }

  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>
          Indicadores Operacionales MX
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
          Pool Mercado Libre · cruce de 6 fuentes operativas
        </div>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e4e7ec", marginLeft: -8, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setVista(t.id)}
                style={{
                  background: "transparent", border: "none", padding: "10px 16px",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", color: vista === t.id ? "#1a3a6b" : "#64748b",
                  borderBottom: vista === t.id ? "2px solid #1a3a6b" : "2px solid transparent",
                  marginBottom: -2,
                }}>
                <div>{t.label}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginTop: 2 }}>{t.desc}</div>
              </button>
            ))}
          </div>
          {/* Dropdown global de mes (solo aplica en Inventario) */}
          {vista === "inventario" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Período:
            </span>
            <select 
              value={`${mesGlobal.anio}-${mesGlobal.mes}`}
              onChange={(e) => {
                const [a, m] = e.target.value.split('-').map(Number);
                setMesGlobal({ anio: a, mes: m });
              }}
              style={{
                padding: "6px 12px", fontSize: 13, fontWeight: 600, borderRadius: 6,
                border: "1px solid #cbd5e1", background: "#fff", color: "#1a3a6b",
                cursor: "pointer", fontFamily: "'Geist', sans-serif", outline: "none",
              }}>
              {mesesDisponibles.map(m => (
                <option key={`${m.anio}-${m.mes}`} value={`${m.anio}-${m.mes}`}>
                  {NOMBRES_MES[m.mes - 1]} {m.anio} ({m.dias_con_datos} días)
                </option>
              ))}
            </select>
          </div>
          )}
        </div>
      </div>

      {vista === "compromiso" && <PoolMeliCompromiso />}
      {vista === "kpi_operacion" && <PoolMeliKPIOperacion />}
      {vista === "diferencias" && <PoolMeliDiferenciasMaestros />}
      {vista === "inventario" && <PoolMeliInventario drivers={drivers} vehiculos={vehiculos} resumen={resumen} setModal={setModal} setDetalle={setDetalle} mesGlobal={mesGlobal} />}
      {vista === "control_helper" && <PoolMeliControlHelper />}
      {vista === "torre_rostering_hoy" && <TorreRosteringHoy />}
      {vista === "validacion_bt" && <PoolMeliValidacionBT usuario={usuario} />}

      {modal && <MeliModal modal={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function TorreRosteringHoy() {
  const [resumen, setResumen] = useState(null);
  const [filas, setFilas] = useState([]);
  const [duplicados, setDuplicados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0); // para refrescar cronómetros
  const [scExpandido, setScExpandido] = useState(new Set()); // SCs colapsadas/expandidas
  const [ultimaActualizacion, setUltimaActualizacion] = useState(null); // último fetch exitoso
  const [toastVisible, setToastVisible] = useState(false); // toast ✅ al refrescar

  // Cargar todos los datos
  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [resResumen, resFilas, resDups] = await Promise.all([
        sb.rpc("get_torre_rostering_hoy_resumen"),
        sb.from("vw_torre_rostering_hoy").select("*").order("sc").order("travel_id"),
        sb.from("vw_torre_rostering_duplicados").select("*"),
      ]);
      if (resResumen.error) throw resResumen.error;
      if (resFilas.error) throw resFilas.error;
      if (resDups.error) throw resDups.error;
      setResumen(resResumen.data || null);
      setFilas(resFilas.data || []);
      setDuplicados(resDups.data || []);
      const scsConDatos = new Set((resFilas.data || []).map(f => f.sc).filter(Boolean));
      setScExpandido(scsConDatos);
      // ✅ Feedback visual de refresco exitoso
      setUltimaActualizacion(new Date());
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 2500);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Tick cada 60s para actualizar cronómetros y refrescar datos cada 5 min
  useEffect(() => {
    const timerTick = setInterval(() => setTick(t => t + 1), 60_000);
    const timerRefresh = setInterval(() => cargar(), 5 * 60_000);
    return () => { clearInterval(timerTick); clearInterval(timerRefresh); };
  }, [cargar]);

  // Helper: minutos restantes hasta lockDate (recalcula en cada tick)
  const minutosHasta = (lockdateStr) => {
    if (!lockdateStr) return null;
    const target = new Date(lockdateStr).getTime();
    const ahora = Date.now();
    return Math.round((target - ahora) / 60000);
  };

  // Helper: formatear cronómetro
  const formatCrono = (min) => {
    if (min === null || min === undefined) return "—";
    const abs = Math.abs(min);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    const sign = min < 0 ? "-" : "";
    if (h === 0) return `${sign}${m}m`;
    return `${sign}${h}h ${m}m`;
  };

  // Helper: color del cronómetro
  const colorCrono = (min) => {
    if (min === null || min === undefined) return "#94a3b8";
    if (min < 0) return "#b91c1c";       // rojo vencido
    if (min < 60) return "#dc2626";       // rojo intenso (< 1h)
    if (min < 240) return "#d97706";      // naranja (1-4h)
    return "#047857";                     // verde (> 4h)
  };

  const toggleSc = (sc) => {
    setScExpandido(prev => {
      const next = new Set(prev);
      if (next.has(sc)) next.delete(sc); else next.add(sc);
      return next;
    });
  };

  if (loading && !resumen) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        Cargando Torre Control Rostering…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: 16, borderRadius: 8 }}>
          <div style={{ fontWeight: 600, color: "#991b1b", marginBottom: 6 }}>Error cargando Torre</div>
          <div style={{ fontSize: 12, color: "#7f1d1d" }}>{error}</div>
          <div style={{ fontSize: 11, color: "#7f1d1d", marginTop: 8 }}>
            Verificá que las vistas <code>vw_torre_rostering_hoy</code> y <code>vw_torre_rostering_duplicados</code> existan en Supabase.
          </div>
        </div>
      </div>
    );
  }

  const totales = resumen?.totales || {};
  const meta = resumen?.meta || {};
  const porSc = resumen?.por_sc || [];

  // SDD en alerta principal · hard (vencidas) + incompletas (rescatables)
  const sddAlertas = filas.filter(f =>
    f.estado === "A_NO_SHOW_HARD_SDD" || f.estado === "C_INCOMPLETO_SDD"
  );
  // NO_SHOW HARD totales (SDD + Variable) · alerta separada
  const noShowHardAlertas = filas.filter(f =>
    f.estado === "A_NO_SHOW_HARD_SDD" || f.estado === "B_NO_SHOW_HARD_VARIABLE"
  );

  // Filas por SC (excluyendo cancel/otro)
  const filasOperativas = filas.filter(f =>
    f.estado && !["Z_CANCEL_MELI", "Z_OTRO"].includes(f.estado)
  );
  const scsConDatos = [...new Set(filasOperativas.map(f => f.sc).filter(Boolean))];

  // Ordenar SCs por urgencia: NO_SHOW_HARD_SDD > NO_SHOW_HARD_VAR > INCOMPLETO_SDD > INCOMPLETO_VAR
  const urgenciaSc = (sc) => {
    const s = porSc.find(x => x.sc === sc) || {};
    return (s.no_show_hard_sdd || 0) * 100000
         + (s.no_show_hard_variable || 0) * 10000
         + (s.incompleto_sdd || 0) * 1000
         + (s.incompleto_variable || 0) * 100
         + (s.rostereado_sin_p3 || 0);
  };
  const scsOrdenadas = scsConDatos.sort((a, b) => urgenciaSc(b) - urgenciaSc(a));

  return (
    <div style={{ padding: 20, fontFamily: "'Geist', sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>Torre Control Rostering HOY</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Fecha operativa: <strong>{meta.fecha || "—"}</strong>
            {" · "}Última captura: <strong>{meta.captura_hora || "—"}</strong>
            {" · "}Total travels: <strong>{totales.total_travels || 0}</strong>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {ultimaActualizacion && (
            <div style={{ fontSize: 11, color: "#64748b" }}>
              Datos al{" "}
              <strong>
                {ultimaActualizacion.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </strong>
            </div>
          )}
          <button onClick={cargar} disabled={loading}
            style={{
              padding: "6px 14px", borderRadius: 6,
              border: loading ? "1px solid #cbd5e1" : "1px solid #1a3a6b",
              background: loading ? "#f1f5f9" : (toastVisible ? "#d1fae5" : "#fff"),
              color: loading ? "#94a3b8" : (toastVisible ? "#047857" : "#1a3a6b"),
              fontWeight: 600, fontSize: 12,
              cursor: loading ? "wait" : "pointer",
              transition: "all 0.3s ease",
              display: "flex", alignItems: "center", gap: 6
            }}>
            {loading ? (
              <>
                <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⠹</span>
                Cargando…
              </>
            ) : toastVisible ? (
              <>✅ Actualizado</>
            ) : (
              <>🔄 Refrescar</>
            )}
          </button>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>

      {/* KPIs en franja · v3 · 6 boxes operativos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 16 }}>
        <KpiBox label="🆘 NO SHOW HARD SDD"
                value={totales.no_show_hard_sdd || 0}
                color="#7f1d1d" bg="#fecaca"
                detalle="multa SDD segura" />
        <KpiBox label="🚨 NO SHOW HARD"
                value={totales.no_show_hard_variable || 0}
                color="#b91c1c" bg="#fee2e2"
                detalle="multa variable" />
        <KpiBox label="🆘 Incompleto SDD"
                value={totales.incompleto_sdd || 0}
                color="#dc2626" bg="#fee2e2"
                detalle="rescatable" />
        <KpiBox label="🟠 Incompleto"
                value={totales.incompleto_variable || 0}
                color="#c2410c" bg="#ffedd5"
                detalle="rescatable" />
        <KpiBox label="🟢 Operando"
                value={totales.operando || 0}
                color="#047857" bg="#d1fae5"
                detalle={`SDD: ${totales.sdd_operando || 0}`} />
        <KpiBox label="⚠️ Duplicados"
                value={resumen?.duplicados?.total_duplicados || 0}
                color="#0891b2" bg="#cffafe"
                detalle={`con SDD: ${resumen?.duplicados?.dup_con_sdd || 0}`} />
      </div>

      {/* Sección crítica SDD */}
      {sddAlertas.length > 0 && (
        <div style={{
          background: "#fef2f2", border: "2px solid #b91c1c", borderRadius: 8,
          padding: 14, marginBottom: 16
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#7f1d1d", marginBottom: 10 }}>
            🆘 ALERTA CRÍTICA · {sddAlertas.length} ruta{sddAlertas.length !== 1 ? "s" : ""} SDD sin rostering
          </div>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #fecaca", color: "#991b1b" }}>
                <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>SC</th>
                <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>Vehículo</th>
                <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>Travel ID</th>
                <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>Estado Pilar 1</th>
                <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>Hora carga</th>
                <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>⏰ Hasta lockDate</th>
              </tr>
            </thead>
            <tbody>
              {sddAlertas.map(f => {
                const min = minutosHasta(f.lockdate_str);
                return (
                  <tr key={f.travel_id} style={{ borderBottom: "1px solid #fee2e2" }}>
                    <td style={{ padding: "5px 8px", fontWeight: 700, color: "#7f1d1d" }}>{f.sc}</td>
                    <td style={{ padding: "5px 8px", color: "#7f1d1d" }}>{f.vehiculo}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "monospace", color: "#7f1d1d" }}>{f.travel_id}</td>
                    <td style={{ padding: "5px 8px", color: "#7f1d1d" }}>
                      {f.travel_status === "pending" ? "🚨 PENDING (responder)" : "ACEPTADO sin rostear"}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: "#7f1d1d" }}>{f.eta_visible || "—"}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: colorCrono(min) }}>
                      {formatCrono(min)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sección por SC */}
      {scsOrdenadas.map(sc => {
        const filasSc = filasOperativas.filter(f => f.sc === sc);
        const dupsSc = duplicados.filter(d => d.sc === sc);
        const expandido = scExpandido.has(sc);
        const statsSc = porSc.find(x => x.sc === sc) || {};

        return (
          <div key={sc} style={{
            background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8,
            marginBottom: 12, overflow: "hidden"
          }}>
            {/* Header SC */}
            <div onClick={() => toggleSc(sc)}
              style={{
                padding: "10px 14px", background: "#f8fafc", cursor: "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                borderBottom: expandido ? "1px solid #e4e7ec" : "none"
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b" }}>{sc}</span>
                <span style={{ fontSize: 11, color: "#64748b" }}>{filasSc.length} rutas</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {statsSc.no_show_hard_sdd > 0 && (
                  <Badge color="#7f1d1d" bg="#fecaca" label={`HardSDD ${statsSc.no_show_hard_sdd}`} />
                )}
                {statsSc.no_show_hard_variable > 0 && (
                  <Badge color="#b91c1c" bg="#fee2e2" label={`Hard ${statsSc.no_show_hard_variable}`} />
                )}
                {statsSc.incompleto_sdd > 0 && (
                  <Badge color="#dc2626" bg="#fee2e2" label={`IncSDD ${statsSc.incompleto_sdd}`} />
                )}
                {statsSc.incompleto_variable > 0 && (
                  <Badge color="#c2410c" bg="#ffedd5" label={`Inc ${statsSc.incompleto_variable}`} />
                )}
                {statsSc.rostereado_sin_p3 > 0 && (
                  <Badge color="#ca8a04" bg="#fef9c3" label={`Rost ${statsSc.rostereado_sin_p3}`} />
                )}
                <Badge color="#047857" bg="#d1fae5" label={`Op ${statsSc.operando || 0}`} />
                <span style={{ color: "#64748b", fontSize: 14, marginLeft: 4 }}>
                  {expandido ? "▼" : "▶"}
                </span>
              </div>
            </div>

            {/* Alertas de duplicados */}
            {expandido && dupsSc.length > 0 && (
              <div style={{ padding: "10px 14px", background: "#fffbeb", borderBottom: "1px solid #fef3c7" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e", marginBottom: 6 }}>
                  ⚠️ {dupsSc.length} duplicado{dupsSc.length !== 1 ? "s" : ""} detectado{dupsSc.length !== 1 ? "s" : ""}
                </div>
                {dupsSc.map((d, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#7c2d12", marginBottom: 3 }}>
                    {d.incluye_sdd && <span style={{ color: "#b91c1c", fontWeight: 700 }}>[SDD] </span>}
                    <strong>{d.tipo === "driver_duplicado" ? "Driver" : "Placa"}</strong>
                    {" "}<code style={{ background: "#fef3c7", padding: "1px 6px", borderRadius: 3 }}>{d.valor}</code>
                    {" "}en <strong>{d.rutas}</strong> rutas: {(d.travel_ids || []).join(", ")}
                  </div>
                ))}
              </div>
            )}

            {/* Tabla de rutas */}
            {expandido && (
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#fafbfc", borderBottom: "1px solid #e4e7ec" }}>
                    <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: "#475569" }}>Estado</th>
                    <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: "#475569" }}>Travel</th>
                    <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: "#475569" }}>Vehículo</th>
                    <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: "#475569" }}>Flota</th>
                    <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: "#475569" }}>Driver</th>
                    <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: "#475569" }}>Placa</th>
                    <th style={{ textAlign: "center", padding: "6px 10px", fontWeight: 600, color: "#475569" }}>ETA</th>
                    <th style={{ textAlign: "right", padding: "6px 10px", fontWeight: 600, color: "#475569" }}>⏰ lockDate</th>
                  </tr>
                </thead>
                <tbody>
                  {filasSc.map(f => {
                    const min = minutosHasta(f.lockdate_str);
                    const estadoInfo = ESTADOS_INFO[f.estado] || { emoji: "❓", color: "#94a3b8" };
                    return (
                      <tr key={f.travel_id} style={{ borderBottom: "0.5px solid #f1f5f9" }}>
                        <td style={{ padding: "5px 10px" }}>
                          <span style={{ fontSize: 13 }}>{estadoInfo.emoji}</span>
                        </td>
                        <td style={{ padding: "5px 10px", fontFamily: "monospace", fontSize: 10, color: "#64748b" }}>
                          {f.travel_id}
                        </td>
                        <td style={{ padding: "5px 10px", color: "#475569" }}>{f.vehiculo || "—"}</td>
                        <td style={{ padding: "5px 10px" }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600,
                            color: f.flota === "SDD" ? "#1e40af" : "#475569"
                          }}>
                            {f.flota || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "5px 10px", color: f.driver_name ? "#1a3a6b" : "#b91c1c", fontWeight: f.driver_name ? 500 : 700 }}>
                          {f.driver_name || "🔴 SIN ASIGNAR"}
                        </td>
                        <td style={{ padding: "5px 10px", fontFamily: "monospace", color: f.vehicle_plate ? "#1a3a6b" : "#b91c1c", fontWeight: f.vehicle_plate ? 500 : 700 }}>
                          {f.vehicle_plate || "🔴 SIN PLACA"}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "center", color: "#64748b" }}>
                          {f.eta_visible || "—"}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 600, color: colorCrono(min) }}>
                          {formatCrono(min)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {/* Tick invisible para forzar recálculo de cronómetros */}
      <div style={{ display: "none" }}>{tick}</div>
    </div>
  );
}

function KpiBox({ label, value, color, bg, detalle }) {
  return (
    <div style={{ background: bg, padding: "10px 12px", borderRadius: 6, border: `1px solid ${color}22` }}>
      <div style={{ fontSize: 10, fontWeight: 600, color, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      {detalle && <div style={{ fontSize: 9, color, opacity: 0.7, marginTop: 2 }}>{detalle}</div>}
    </div>
  );
}

function Badge({ color, bg, label }) {
  return (
    <span style={{
      background: bg, color, padding: "2px 8px", borderRadius: 10,
      fontSize: 10, fontWeight: 700, whiteSpace: "nowrap"
    }}>{label}</span>
  );
}

const ESTADOS_INFO = {
  "A_NO_SHOW_HARD_SDD":      { emoji: "🆘", color: "#7f1d1d", label: "NO SHOW HARD SDD" },
  "B_NO_SHOW_HARD_VARIABLE": { emoji: "🚨", color: "#b91c1c", label: "NO SHOW HARD" },
  "C_INCOMPLETO_SDD":        { emoji: "🆘", color: "#dc2626", label: "Incompleto SDD" },
  "D_INCOMPLETO_VARIABLE":   { emoji: "🟠", color: "#c2410c", label: "Incompleto" },
  "E_OPERANDO":              { emoji: "🟢", color: "#047857", label: "Operando" },
  "F_ROSTEREADO_SIN_P3":     { emoji: "🟡", color: "#ca8a04", label: "Rostereado (sin P3)" },
  "Z_CANCEL_MELI":           { emoji: "⚪", color: "#94a3b8", label: "Cancel MELI" },
  "Z_OTRO":                  { emoji: "❓", color: "#94a3b8", label: "Otro" },
};

const CH_NAVY = "#1a3a6b";

const CH_ORANGE = "#F47B20";

const CH_BG = "#f0f2f5";

const CH_CARD = "#fff";

const CH_BORDER = "#e4e7ec";

const CH_TEXT = "#1a1a1a";

const CH_MUTED = "#64748b";

const CH_LIGHT = "#94a3b8";

const CH_RED = "#dc2626";

const CH_RED_SOFT = "#fca5a5";

const CH_YELLOW = "#fef3c7";

const CH_YELLOW_TEXT = "#92400e";

const CH_GREEN = "#15803d";

function PoolMeliControlHelper() {
  const [fecha, setFecha] = useState(() => {
    // Default: ayer (D-1) · los datos se completan al final de la jornada operativa
    // con los snapshots y paquetes entregados
    const now = new Date();
    const mx = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    mx.setDate(mx.getDate() - 1);
    return mx.toISOString().split('T')[0];
  });
  const [universo, setUniverso] = useState(0);
  const [periodo, setPeriodo] = useState(7);
  const [datos, setDatos] = useState([]);
  const [serie, setSerie] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drillDown, setDrillDown] = useState(null);
  const [ddOpen, setDdOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        // Día consultado
        const { data: r1, error: e1 } = await sb
          .from('vw_control_helper_diario').select('*').eq('fecha', fecha).order('sc');
        if (e1) throw e1;
        // Día anterior (para calcular delta vs ayer)
        const dAyer = new Date(fecha);
        dAyer.setDate(dAyer.getDate() - 1);
        const fechaAyer = dAyer.toISOString().split('T')[0];
        const { data: r2, error: e2 } = await sb
          .from('vw_control_helper_diario').select('fecha,universo,id_ruta,es_chofer')
          .eq('fecha', fechaAyer);
        if (e2) throw e2;
        if (alive) {
          setDatos(r1 || []);
          // Conteos día anterior · solo helpers (es_chofer=false) y rutas únicas para total
          const ayer = { U1: 0, U2: 0, U3: 0, OK: 0, total: 0 };
          const rutasAyer = new Set();
          (r2 || []).forEach(r => {
            rutasAyer.add(r.id_ruta);
            if (r.es_chofer) return; // choferes no entran en universo
            if (r.universo) ayer[r.universo] = (ayer[r.universo] || 0) + 1;
          });
          ayer.total = rutasAyer.size;
          setSerie([{ fecha: fechaAyer, ...ayer }]);
        }
      } catch (e) {
        if (alive) setError(e.message || 'Error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [fecha]);

  const conteos = useMemo(() => {
    const c = {
      total: 0,                          // ⭐ rutas únicas
      personasTotal: datos.length,       // todas las filas (chofer + helpers)
      choferesEscaneando: 0,             // filas con es_chofer = true
      helpersOperando: 0,                // filas con es_chofer = false
      rutasMulti: 0,
      U1: 0, U2: 0, U3: 0, OK: 0,
      // Match score (solo helpers)
      scoreExcelente: 0,
      scoreBueno: 0,
      scoreMedio: 0,
      sinPadron: 0,
      // BT (solo helpers)
      btAprobado: 0,
      btRechazado: 0,
      btPendiente: 0,
      noEnBt: 0,
      sinCurpParaBt: 0,
    };
    const rutasSet = new Set();
    const rutasCount = {};
    const rutasU1Set = new Set(); // ⭐ v9: U1 cuenta rutas únicas (incluye al chofer)
    datos.forEach(r => {
      rutasSet.add(r.id_ruta);
      rutasCount[r.id_ruta] = (rutasCount[r.id_ruta] || 0) + 1;
      // ⭐ v9: U1 se cuenta a nivel ruta — el chofer también pertenece a U1
      if (r.universo === 'U1') rutasU1Set.add(r.id_ruta);
      if (r.es_chofer) {
        c.choferesEscaneando++;
        return; // chofer no se evalúa en U2/U3/OK ni en cobertura padrón/BT
      }
      // Solo helpers reales (es_chofer = false)
      c.helpersOperando++;
      if (r.universo === 'U2') c.U2++;
      else if (r.universo === 'U3') c.U3++;
      else if (r.universo === 'OK') c.OK++;
      // U1 NO se cuenta acá: ya se contó arriba a nivel ruta
      const s = r.helper_match_score_padron;
      if (s == null) c.sinPadron++;
      else if (s >= 0.9) c.scoreExcelente++;
      else if (s >= 0.7) c.scoreBueno++;
      else c.scoreMedio++;
      const eb = r.helper_estado_bt;
      if (eb === 'BT_APROBADO') c.btAprobado++;
      else if (eb === 'BT_RECHAZADO') c.btRechazado++;
      else if (eb === 'BT_PENDIENTE') c.btPendiente++;
      else if (eb === 'NO_EN_BT') c.noEnBt++;
      else if (eb === 'SIN_CURP_PARA_BUSCAR') c.sinCurpParaBt++;
    });
    c.total = rutasSet.size;
    c.U1 = rutasU1Set.size; // ⭐ v9: rutas únicas no autorizadas
    c.rutasMulti = Object.values(rutasCount).filter(n => n > 2).length;  // 2+ helpers reales
    return c;
  }, [datos]);

  // Conteo del día anterior para mostrar deltas
  const ayerCount = useMemo(() => {
    const ayer = serie[0] || { U1: 0, U2: 0, U3: 0, OK: 0, total: 0 };
    return ayer;
  }, [serie]);
  const getAyer = (uni) => ayerCount[uni] || 0;
  // Backward compat para PanelU1 si todavía usa sparkline
  const getSerieVals = (uni) => [ayerCount[uni] || 0, conteos[uni] || 0];

  const matrizU1 = useMemo(() => {
    // ⭐ v9: U1 ahora incluye filas de chofer Y helpers (toda ruta no autorizada)
    // Las filas del drilldown muestran a todos los que entregaron en la ruta U1
    const vehiculos = ['Small Van MLP', 'Small Van MLP SDD', 'Large Van MLP', 'Large Van MLP SDD'];
    const u1 = datos.filter(r => r.universo === 'U1');
    const scs = [...new Set(u1.map(r => r.sc))].sort();
    const mat = {};
    scs.forEach(sc => { mat[sc] = {}; vehiculos.forEach(v => mat[sc][v] = []); });
    u1.forEach(r => { if (mat[r.sc] && mat[r.sc][r.vehiculo]) mat[r.sc][r.vehiculo].push(r); });
    return { scs, vehiculos, mat };
  }, [datos]);

  const matrizU2 = useMemo(() => {
    // U2 ahora incluye NO_CERTIFICADO (fantasma) Y BT_RECHAZADO (crítico operando)
    const u2 = datos.filter(r => r.universo === 'U2');
    const scs = [...new Set(u2.map(r => r.sc))].sort();
    const mat = {};
    scs.forEach(sc => mat[sc] = { noCert: [], btRech: [], total: 0 });
    u2.forEach(r => {
      if (!mat[r.sc]) return;
      if (r.helper_cert_estado === 'NO_CERTIFICADO') mat[r.sc].noCert.push(r);
      else if (r.helper_cert_estado === 'BT_RECHAZADO') mat[r.sc].btRech.push(r);
      mat[r.sc].total++;
    });
    const totals = {
      noCert: datos.filter(r => r.helper_cert_estado === 'NO_CERTIFICADO').length,
      btRech: datos.filter(r => r.helper_cert_estado === 'BT_RECHAZADO').length,
      sinBt: datos.filter(r => r.helper_cert_estado === 'SIN_BT').length,
      certOk: datos.filter(r => r.helper_cert_estado === 'OK').length,
    };
    return { scs, mat, totals };
  }, [datos]);

  const matrizU3 = useMemo(() => {
    // U3 ahora tiene 4 sub-categorías reales según helper_cert_estado y match_score
    const u3 = datos.filter(r => r.universo === 'U3');
    const scs = [...new Set(u3.map(r => r.sc))].sort();
    const mat = {};
    scs.forEach(sc => mat[sc] = { sinBt: [], btPend: [], meliInact: [], matchDudoso: [], total: 0 });
    u3.forEach(r => {
      if (!mat[r.sc]) return;
      if (r.helper_cert_estado === 'SIN_BT') mat[r.sc].sinBt.push(r);
      else if (r.helper_cert_estado === 'BT_PENDIENTE') mat[r.sc].btPend.push(r);
      else if (r.helper_cert_estado === 'MELI_INACTIVE') mat[r.sc].meliInact.push(r);
      else if (r.helper_estado_padron === 'MATCH_DUDOSO') mat[r.sc].matchDudoso.push(r);
      mat[r.sc].total++;
    });
    const totals = {
      sinBt: u3.filter(r => r.helper_cert_estado === 'SIN_BT').length,
      btPend: u3.filter(r => r.helper_cert_estado === 'BT_PENDIENTE').length,
      meliInact: u3.filter(r => r.helper_cert_estado === 'MELI_INACTIVE').length,
      matchDudoso: u3.filter(r =>
        r.helper_estado_padron === 'MATCH_DUDOSO'
        && r.helper_cert_estado !== 'SIN_BT'
        && r.helper_cert_estado !== 'BT_PENDIENTE'
        && r.helper_cert_estado !== 'MELI_INACTIVE'
      ).length,
    };
    return { scs, mat, totals };
  }, [datos]);

  const UCFG = [
    { badge: "U0", name: "Resumen ejecutivo", kv: conteos.total, ks: "rutas", icon: "ti-layout-dashboard" },
    { badge: "U1", name: "No autorizadas", kv: conteos.U1, ks: "rutas", icon: "ti-ban" },
    { badge: "U2", name: "Certificación", kv: conteos.U2, ks: "helpers", icon: "ti-id-badge" },
    { badge: "U3", name: "Proceso", kv: conteos.U3, ks: "rutas", icon: "ti-route" },
  ];

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: CH_MUTED, fontSize: 13, fontFamily: "'Geist', sans-serif" }}>Cargando datos del {fecha}…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: "'Geist', sans-serif" }}>
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: 6 }}>No se pudo cargar Control Helper</div>
          <div style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.6 }}>
            {error}<br /><br />
            <strong>Causa probable:</strong> la vista <code>vw_control_helper_diario</code> aún no existe.
          </div>
        </div>
      </div>
    );
  }

  const u = UCFG[universo];
  const curSerieKey = universo === 0 ? 'total' : ['U1', 'U2', 'U3'][universo - 1];

  return (
    <div style={{ fontFamily: "'Geist', sans-serif", background: CH_BG, color: CH_TEXT }}>

      {/* TAB-BAR (U0/U1/U2/U3) */}
      <div style={{ background: CH_CARD, borderBottom: `1px solid ${CH_BORDER}`, padding: '0 24px', display: 'flex', gap: 2 }}>
        {UCFG.map((cfg, idx) => (
          <div key={idx} onClick={() => setUniverso(idx)} style={{
            padding: '10px 16px', fontSize: 12, fontWeight: 600,
            color: universo === idx ? CH_NAVY : CH_MUTED,
            borderBottom: universo === idx ? `2px solid ${CH_ORANGE}` : '2px solid transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            whiteSpace: 'nowrap', transition: 'all .12s',
          }}>
            <i className={`ti ${cfg.icon}`} style={{ fontSize: 13 }} />
            {cfg.badge} · {cfg.name}
          </div>
        ))}
      </div>

      {/* SBAR · dinámico según universo */}
      <div style={{ background: CH_CARD, borderBottom: `1px solid ${CH_BORDER}`, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 10, height: 48 }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 5, color: '#fff', background: universo === 0 ? CH_MUTED : CH_NAVY, flexShrink: 0, letterSpacing: 0.3 }}>
          {u.badge}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: CH_TEXT, flexShrink: 0 }}>{u.name}</span>
        <div style={{ width: 1, height: 18, background: CH_BORDER, flexShrink: 0 }} />
        <span style={{ fontSize: 16, fontWeight: 800, color: CH_TEXT, flexShrink: 0, letterSpacing: -0.3 }}>{u.kv}</span>
        <span style={{ fontSize: 11, color: CH_LIGHT, flexShrink: 0 }}>{u.ks} · {fecha}</span>
        <div style={{ width: 1, height: 18, background: CH_BORDER, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 80, maxWidth: 140 }}><Spark vals={getSerieVals(curSerieKey)} height={28} /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <button onClick={() => {
            const d = new Date(); d.setDate(d.getDate() - 1);
            setFecha(d.toISOString().split('T')[0]);
          }} style={{
            fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
            border: `1px solid ${CH_BORDER}`, background: '#f8fafc', color: CH_MUTED,
            cursor: 'pointer', fontFamily: "'Geist', sans-serif",
            whiteSpace: 'nowrap', lineHeight: 1, height: 28,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>D-1</button>
          <button onClick={() => {
            const now = new Date();
            const mx = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            setFecha(mx.toISOString().split('T')[0]);
          }} style={{
            fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
            border: `1px solid ${CH_BORDER}`, background: '#f8fafc', color: CH_MUTED,
            cursor: 'pointer', fontFamily: "'Geist', sans-serif",
            whiteSpace: 'nowrap', lineHeight: 1, height: 28,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>Hoy</button>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{
            fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 6,
            border: `1px solid ${CH_BORDER}`, background: CH_CARD, color: CH_NAVY,
            fontFamily: "'Geist', sans-serif", cursor: 'pointer', outline: 'none',
            colorScheme: 'light',
          }} />
        </div>
      </div>

      {/* PANELS */}
      <div style={{ padding: '16px 24px' }}>
        {universo === 0 && <PanelU0 conteos={conteos} setUniverso={setUniverso} getAyer={getAyer} ayerCount={ayerCount} />}
        {universo === 1 && <PanelU1 matriz={matrizU1} conteos={conteos} datos={datos} drillDown={drillDown} setDrillDown={setDrillDown} fecha={fecha} getSerieVals={getSerieVals} />}
        {universo === 2 && <PanelU2 matriz={matrizU2} conteos={conteos} datos={datos} drillDown={drillDown} setDrillDown={setDrillDown} fecha={fecha} getAyer={getAyer} />}
        {universo === 3 && <PanelU3 matriz={matrizU3} conteos={conteos} datos={datos} drillDown={drillDown} setDrillDown={setDrillDown} fecha={fecha} getAyer={getAyer} />}
      </div>
    </div>
  );
}

function PanelU0({ conteos, setUniverso, getAyer, ayerCount }) {
  // Sólo rutas con helper declarado (filtro fundamental de la vista)
  const cobPad = conteos.total - conteos.sinPadron;     // identificados en padrón
  const cobBt = conteos.btAprobado + conteos.btRechazado + conteos.btPendiente; // con respuesta BT
  return (
    <div>
      {/* Banner aclaratorio · desglose rutas vs personas */}
      <div style={{
        background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12,
        padding: '10px 14px', marginBottom: 14, fontSize: 11, color: '#1e40af',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <i className="ti ti-info-circle" style={{ fontSize: 14 }} />
        <span>
          <strong>{conteos.total} rutas</strong> con helper declarado por MELI ·{' '}
          <strong>{conteos.personasTotal} personas</strong> entregaron paquetes ·{' '}
          <strong>{conteos.helpersOperando} helpers</strong> reales ·{' '}
          <strong>{conteos.choferesEscaneando} choferes</strong> también escanearon
          {conteos.rutasMulti > 0 && <> · {conteos.rutasMulti} ruta{conteos.rutasMulti > 1 ? 's' : ''} con 2+ helpers</>}
        </span>
      </div>

      {/* Flowbar segmentado · solo categorías (el total ya está en el banner azul) */}
      <div style={{ height: 36, display: 'flex', borderRadius: 10, overflow: 'hidden', marginBottom: 16, fontSize: 11, fontWeight: 700, color: '#fff', border: `0.5px solid ${CH_BORDER}` }}>
        {conteos.U1 > 0 && <div style={{ flex: Math.max(conteos.U1, conteos.total * 0.08), background: CH_RED, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>U1 · {conteos.U1}</div>}
        {conteos.U2 > 0 && <div style={{ flex: Math.max(conteos.U2, conteos.total * 0.08), background: CH_ORANGE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>U2 · {conteos.U2}</div>}
        {conteos.U3 > 0 && <div style={{ flex: Math.max(conteos.U3, conteos.total * 0.08), background: '#eab308', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>U3 · {conteos.U3}</div>}
        {conteos.OK > 0 && <div style={{ flex: Math.max(conteos.OK, conteos.total * 0.08), background: CH_GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>OK · {conteos.OK}</div>}
      </div>

      {/* Cobertura de cruces */}
      {/* Leyenda de gravedad */}
      <div style={{ display: 'flex', gap: 18, marginBottom: 16, flexWrap: 'wrap', fontSize: 11 }}>
        <LegItem color={CH_RED} label="Gravedad crítica" desc="— impacto financiero directo · acción inmediata" />
        <LegItem color={CH_ORANGE} label="Gravedad media" desc="— riesgo operativo · gestionar esta semana" />
        <LegItem color="#eab308" label="Gravedad baja" desc="— proceso corregible · seguimiento conductor" labelColor="#b45309" />
      </div>

      {/* 4 cards U0 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <U0Card label="U1 · No autorizadas" val={conteos.U1} sub={`${pct(conteos.U1, conteos.total)}% del total`} action="ver universo 1" onClick={() => setUniverso(1)} delta={conteos.U1 - getAyer('U1')} accent={CH_RED} />
        <U0Card label="U2 · Certificación" val={conteos.U2} sub={`${pct(conteos.U2, conteos.total)}% del total`} action="ver universo 2" onClick={() => setUniverso(2)} delta={conteos.U2 - getAyer('U2')} accent={CH_ORANGE} />
        <U0Card label="U3 · Proceso" val={conteos.U3} sub={`${pct(conteos.U3, conteos.total)}% del total`} action="ver universo 3" onClick={() => setUniverso(3)} delta={conteos.U3 - getAyer('U3')} accent="#eab308" />
        <U0Card label="OK · Válidas" val={conteos.OK} sub={`${pct(conteos.OK, conteos.total)}% del total`} action="—" delta={conteos.OK - getAyer('OK')} accent={CH_GREEN} />
      </div>

      {/* Math note */}
      <div style={{ background: CH_CARD, borderRadius: 12, padding: '12px 16px', fontSize: 12, color: CH_MUTED, border: `0.5px solid ${CH_BORDER}` }}>
        <strong style={{ color: CH_NAVY }}>
          {conteos.U1} + {conteos.U2} + {conteos.U3} + {conteos.OK} = {conteos.U1 + conteos.U2 + conteos.U3 + conteos.OK}
        </strong>{' '}
        helpers clasificados {conteos.U1 + conteos.U2 + conteos.U3 + conteos.OK === conteos.helpersOperando ? '✓' : `de ${conteos.helpersOperando} helpers`} ·  Haz clic en cualquier card para ver el drill-down
      </div>
    </div>
  );
}

function U0Card({ label, val, sub, action, onClick, delta, accent }) {
  // Color del delta según si subió/bajó (depende del contexto)
  // Para U1/U2/U3 (rechazos): subir es malo (rojo), bajar es bueno (verde)
  // Para OK: subir es bueno (verde), bajar es malo (rojo)
  const isOK = label.includes('OK');
  const subio = delta > 0;
  const bajo = delta < 0;
  const deltaColor = delta === 0 ? '#9ca3af'
    : (isOK ? (subio ? '#10b981' : '#ef4444') : (subio ? '#ef4444' : '#10b981'));
  const deltaIcon = delta === 0 ? '—' : (subio ? '▲' : '▼');
  const deltaText = delta === 0 ? 'igual ayer' : `${Math.abs(delta)} vs ayer`;

  return (
    <div onClick={onClick} style={{
      background: CH_CARD, border: `0.5px solid ${CH_BORDER}`, borderRadius: 12, padding: 14,
      cursor: onClick ? 'pointer' : 'default', display: 'flex', flexDirection: 'column',
      transition: 'all .12s', minHeight: 130,
    }}
      onMouseEnter={e => onClick && (e.currentTarget.style.borderColor = CH_NAVY)}
      onMouseLeave={e => onClick && (e.currentTarget.style.borderColor = CH_BORDER)}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: CH_MUTED, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5, color: CH_TEXT, lineHeight: 1 }}>{val}</div>
      <div style={{ fontSize: 11, color: CH_LIGHT, marginTop: 5, marginBottom: 10 }}>{sub}</div>
      <div style={{ height: 1, background: CH_BORDER, marginBottom: 10 }} />
      {/* Delta vs ayer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: deltaColor }}>{deltaIcon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: deltaColor }}>{deltaText}</span>
      </div>
      <div style={{ height: 1, background: CH_BORDER, margin: '10px 0' }} />
      <div style={{ fontSize: 11, fontWeight: 500, color: CH_MUTED, marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className="ti ti-arrow-right" style={{ fontSize: 12 }} />{action}
      </div>
    </div>
  );
}

function LegItem({ color, label, desc, labelColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: CH_MUTED }}>
      <div style={{ width: 11, height: 11, borderRadius: 3, background: color, flexShrink: 0 }} />
      <span><strong style={{ color: labelColor || color }}>{label}</strong> {desc}</span>
    </div>
  );
}

function PanelU1({ matriz, conteos, datos, drillDown, setDrillDown, fecha, getSerieVals }) {
  const scsFor = ['SCQ1', 'SCY1', 'SQR1', 'STL1', 'SHP1', 'STX1', 'SVH1'];
  const scsForOperando = [...new Set(datos.filter(r => scsFor.includes(r.sc)).map(r => r.sc))];
  // ⭐ v9: contar RUTAS únicas — datos tiene 1 fila por persona
  const totalForaneo = new Set(
    datos.filter(r => scsFor.includes(r.sc) && r.helper_flag).map(r => r.id_ruta)
  ).size;
  const scsSinRutaLimpia = matriz.scs.filter(sc => {
    const rutasTodas = new Set(datos.filter(r => r.sc === sc && r.helper_flag).map(r => r.id_ruta));
    const rutasU1 = new Set(datos.filter(r => r.sc === sc && r.universo === 'U1').map(r => r.id_ruta));
    return rutasTodas.size > 0 && rutasTodas.size === rutasU1.size;
  });

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <KCard l="SVC fuera de tarifa" v={matriz.scs.length} s={`de ${scsForOperando.length || 7} SVC foráneos`} a="universo" sk={getSerieVals('U1')} accent={CH_RED} />
        <KCard l="Rutas no autorizadas" v={conteos.U1} s={`de ${totalForaneo || conteos.total} rutas`} a="volumen" sk={getSerieVals('U1')} accent={CH_RED} />
        <KCard l="% universo expuesto" v={`${pct(conteos.U1, totalForaneo)}%`} s="del total foráneo" a="magnitud" sk={getSerieVals('U1')} accent={CH_RED} />
        <KCard l="SVC sin ruta limpia" v={scsSinRutaLimpia.length} s={scsSinRutaLimpia.slice(0, 4).join('·') || '—'} a="alerta" sk={getSerieVals('U1')} accent={CH_RED} />
      </div>

      <SLabel text="Mapa de calor SVC × Vehículo" badge="Datos reales" badgeColor="blue" fecha={fecha} />
      <div style={{ background: CH_CARD, borderRadius: 12, border: `0.5px solid ${CH_BORDER}`, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <ThHm align="left">SVC</ThHm>
              {matriz.vehiculos.map(v => <ThHm key={v}>{v.replace('Van MLP SDD', 'Van SDD')}</ThHm>)}
              <ThHm>Total</ThHm>
            </tr>
          </thead>
          <tbody>
            {matriz.scs.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: CH_LIGHT, fontSize: 12 }}>Sin rutas U1 para esta fecha</td></tr>
            ) : <>
              {matriz.scs.map(sc => {
                // ⭐ v9: contar RUTAS únicas (no filas, que incluyen driver+helpers)
                const total = matriz.vehiculos.reduce(
                  (s, v) => s + new Set(matriz.mat[sc][v].map(r => r.id_ruta)).size, 0
                );
                return (
                  <tr key={sc}>
                    <TdSn>{sc}</TdSn>
                    {matriz.vehiculos.map(v => {
                      const rutas = matriz.mat[sc][v];
                      const n = new Set(rutas.map(r => r.id_ruta)).size; // ⭐ v9: rutas únicas
                      const sel = drillDown && drillDown.uid === 1 && drillDown.svc === sc && drillDown.vehiculo === v;
                      return <TdHeat key={v} n={n} selected={sel}
                        onClick={() => n > 0 && setDrillDown({ uid: 1, svc: sc, vehiculo: v, n, rutas })} />;
                    })}
                    <TdTc>{total}</TdTc>
                  </tr>
                );
              })}
              <tr style={{ background: '#f8fafc', borderTop: `1px solid ${CH_BORDER}` }}>
                <TdSn total>Total</TdSn>
                {matriz.vehiculos.map(v => {
                  const t = matriz.scs.reduce(
                    (s, sc) => s + new Set(matriz.mat[sc][v].map(r => r.id_ruta)).size, 0
                  );
                  return <TdTotal key={v}>{t}</TdTotal>;
                })}
                <TdTotal strong>{conteos.U1}</TdTotal>
              </tr>
            </>}
          </tbody>
        </table>
        <HmLegend hint="Clic en celda → ver rutas" />
      </div>

      {drillDown && drillDown.uid === 1 && <DrillDown1 dd={drillDown} datos={datos} fecha={fecha} onClose={() => setDrillDown(null)} />}
      {!drillDown && matriz.scs.length > 0 && <Hint text="Haz clic en cualquier celda coloreada para ver las rutas" />}
    </div>
  );
}

function PanelU2({ matriz, conteos, datos, drillDown, setDrillDown, fecha, getAyer }) {
  const t = matriz.totals;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <KCard l="🚨 BT Rechazados" v={t.btRech} s="MELI activo + BT rechazó" a="alerta crítica" delta={conteos.U2 - getAyer('U2')} deltaIsBad={true} />
        <KCard l="🚨 No certificados" v={t.noCert} s="helpers fantasma" a="investigar" delta={null} />
        <KCard l="🟡 Sin validar BT" v={t.sinBt} s="MELI activo · falta BT" a="informativo" delta={null} />
        <KCard l="✅ Certificados OK" v={t.certOk} s="MELI activo + BT aprobado" a="normal" delta={conteos.OK - getAyer('OK')} deltaIsBad={false} />
      </div>

      {/* BANNER WARNING para NO_CERTIFICADO */}
      {t.noCert > 0 && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12,
          padding: '12px 16px', marginBottom: 14, fontSize: 12, color: '#7f1d1d',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>
            ⚠️ {t.noCert} helper{t.noCert > 1 ? 's' : ''} no identificado{t.noCert > 1 ? 's' : ''} · investigar manualmente
          </div>
          <div style={{ lineHeight: 1.5, color: '#991b1b' }}>
            MELI capturó nombres que no coinciden con el padrón ni con BBDD BT.
            Revisa el nombre raw en la tabla y verifica si es alias, error de escaneo, o helper fantasma real.
          </div>
        </div>
      )}

      <SLabel text="Helpers críticos por SC · MELI + BT" badge="cruce padrón MELI + BBDD BT" badgeColor="orange" fecha={fecha} />
      <div style={{ background: CH_CARD, borderRadius: 12, border: `0.5px solid ${CH_BORDER}`, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <ThHm align="left">SVC</ThHm>
              <ThHm>🚨 BT Rechazado</ThHm>
              <ThHm>🚨 No certificado</ThHm>
              <ThHm>Total críticos</ThHm>
            </tr>
          </thead>
          <tbody>
            {matriz.scs.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: CH_LIGHT, fontSize: 12 }}>Sin helpers críticos para esta fecha</td></tr>
            ) : <>
              {matriz.scs.map(sc => {
                const cell = matriz.mat[sc];
                const selRech = drillDown && drillDown.uid === 2 && drillDown.svc === sc && drillDown.col === 'btRech';
                const selNoCert = drillDown && drillDown.uid === 2 && drillDown.svc === sc && drillDown.col === 'noCert';
                return (
                  <tr key={sc}>
                    <TdSn>{sc}</TdSn>
                    <TdHeat n={cell.btRech.length} selected={selRech} onClick={() => cell.btRech.length > 0 && setDrillDown({ uid: 2, svc: sc, col: 'btRech', n: cell.btRech.length, rutas: cell.btRech, label: 'BT Rechazado' })} />
                    <TdHeat n={cell.noCert.length} selected={selNoCert} onClick={() => cell.noCert.length > 0 && setDrillDown({ uid: 2, svc: sc, col: 'noCert', n: cell.noCert.length, rutas: cell.noCert, label: 'No certificado' })} />
                    <TdTc>{cell.total}</TdTc>
                  </tr>
                );
              })}
              <tr style={{ background: '#f8fafc', borderTop: `1px solid ${CH_BORDER}` }}>
                <TdSn total>Total</TdSn>
                <TdTotal>{t.btRech}</TdTotal>
                <TdTotal>{t.noCert}</TdTotal>
                <TdTotal strong>{conteos.U2}</TdTotal>
              </tr>
            </>}
          </tbody>
        </table>
        <HmLegend note="Clic en celda para ver detalle del helper" hint="Score < 0.7 → match dudoso · revisar nombre raw" />
      </div>

      {drillDown && drillDown.uid === 2 && <DrillDown2 dd={drillDown} datos={datos} fecha={fecha} onClose={() => setDrillDown(null)} />}
      {!drillDown && matriz.scs.length > 0 && <Hint text="Haz clic en cualquier celda coloreada para ver los helpers" />}
    </div>
  );
}

function PanelU3({ matriz, conteos, datos, drillDown, setDrillDown, fecha, getAyer }) {
  const t = matriz.totals;
  const scPrincipal = matriz.scs.length > 0
    ? [...matriz.scs].sort((a, b) => matriz.mat[b].total - matriz.mat[a].total)[0]
    : '—';

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <KCard l="🟡 Sin validar BT" v={t.sinBt} s="MELI activo · falta cargar BT" a="acción RH" delta={null} />
        <KCard l="🟠 BT pendiente" v={t.btPend} s="MELI activo · BT en revisión" a="esperar BT" delta={null} />
        <KCard l="⚪ MELI inactivo" v={t.meliInact} s="no activo en padrón" a="verificar" delta={null} />
        <KCard l="🔍 Match dudoso" v={t.matchDudoso} s="score < 0.7" a="revisar nombre" delta={null} />
      </div>

      <div style={{
        background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12,
        padding: '12px 16px', marginBottom: 14, fontSize: 12, color: '#78350f',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>
          🟡 {conteos.U3} warning{conteos.U3 !== 1 ? 's' : ''} · revisar pendientes operativos
        </div>
        <div style={{ lineHeight: 1.5 }}>
          Estos helpers están operando pero no cumplen los 3 requisitos para "OK" (MELI activo + BT aprobado + score ≥ 0.7).
          {scPrincipal !== '—' && ` SC con más casos: ${scPrincipal}.`}
        </div>
      </div>

      <SLabel text="Warnings por SC · estado de cada helper" badge="acción operativa" badgeColor="yellow" fecha={fecha} />
      <div style={{ background: CH_CARD, borderRadius: 12, border: `0.5px solid ${CH_BORDER}`, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <ThHm align="left">SVC</ThHm>
              <ThHm>🟡 Sin BT</ThHm>
              <ThHm>🟠 BT pend.</ThHm>
              <ThHm>⚪ MELI inact.</ThHm>
              <ThHm>🔍 Match dudoso</ThHm>
              <ThHm>Total</ThHm>
            </tr>
          </thead>
          <tbody>
            {matriz.scs.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: CH_LIGHT, fontSize: 12 }}>Sin warnings para esta fecha</td></tr>
            ) : <>
              {matriz.scs.map(sc => {
                const m = matriz.mat[sc];
                const selSinBt = drillDown?.uid === 3 && drillDown?.svc === sc && drillDown?.col === 'sinBt';
                const selBtPend = drillDown?.uid === 3 && drillDown?.svc === sc && drillDown?.col === 'btPend';
                const selMeliInact = drillDown?.uid === 3 && drillDown?.svc === sc && drillDown?.col === 'meliInact';
                const selMatch = drillDown?.uid === 3 && drillDown?.svc === sc && drillDown?.col === 'matchDudoso';
                return (
                  <tr key={sc}>
                    <TdSn>{sc}</TdSn>
                    <TdHeat n={m.sinBt.length} selected={selSinBt} onClick={() => m.sinBt.length > 0 && setDrillDown({ uid: 3, svc: sc, col: 'sinBt', label: 'Sin BT', n: m.sinBt.length, rutas: m.sinBt })} />
                    <TdHeat n={m.btPend.length} selected={selBtPend} onClick={() => m.btPend.length > 0 && setDrillDown({ uid: 3, svc: sc, col: 'btPend', label: 'BT pendiente', n: m.btPend.length, rutas: m.btPend })} />
                    <TdHeat n={m.meliInact.length} selected={selMeliInact} onClick={() => m.meliInact.length > 0 && setDrillDown({ uid: 3, svc: sc, col: 'meliInact', label: 'MELI inactivo', n: m.meliInact.length, rutas: m.meliInact })} />
                    <TdHeat n={m.matchDudoso.length} selected={selMatch} onClick={() => m.matchDudoso.length > 0 && setDrillDown({ uid: 3, svc: sc, col: 'matchDudoso', label: 'Match dudoso', n: m.matchDudoso.length, rutas: m.matchDudoso })} />
                    <TdTc>{m.total}</TdTc>
                  </tr>
                );
              })}
              <tr style={{ background: '#f8fafc', borderTop: `1px solid ${CH_BORDER}` }}>
                <TdSn total>Total</TdSn>
                <TdTotal>{t.sinBt}</TdTotal>
                <TdTotal>{t.btPend}</TdTotal>
                <TdTotal>{t.meliInact}</TdTotal>
                <TdTotal>{t.matchDudoso}</TdTotal>
                <TdTotal strong>{conteos.U3}</TdTotal>
              </tr>
            </>}
          </tbody>
        </table>
        <HmLegend note="Sin BT y BT pendiente requieren acción de RH · MELI inactivo verificar con coordinador" hint="Clic en celda → ver helpers" />
      </div>

      {drillDown && drillDown.uid === 3 && <DrillDown3 dd={drillDown} datos={datos} fecha={fecha} onClose={() => setDrillDown(null)} />}
      {!drillDown && matriz.scs.length > 0 && <Hint text="Haz clic en cualquier celda coloreada para ver los helpers" />}
    </div>
  );
}

function DrillDown1({ dd, datos, fecha, onClose }) {
  // ⭐ v9: expandir a tripulación completa de las rutas afectadas
  const filas = expandirTripulacion(dd.rutas, datos);
  // ⭐ v9.2: pre-calcular cuántas filas tiene cada ruta para usar rowSpan
  const rutaCount = {};
  filas.forEach(r => { rutaCount[r.id_ruta] = (rutaCount[r.id_ruta] || 0) + 1; });

  const exportar = () => exportCH(
    ["Disparador", "Driver (chofer)", "Driver ID", "Ruta", "SC", "Vehículo",
     "Es chofer", "Persona", "Persona Raw", "Persona ID",
     "Match Padrón MELI", "Nombre padrón", "CURP padrón", "Score padrón",
     "Match BT", "Nombre BT", "Respuesta BT", "Empresa BT",
     "Universo persona", "Cert estado",
     "% Persona", "% Participación helper ruta", "Alertas Maestro",
     "Razón", "Acción"],
    filas.map(r => [
      r._esDisparador ? '⭐ SÍ' : '',
      r.chofer_nombre || '—',
      r.chofer_user_id || '—',
      r.id_ruta,
      r.sc,
      r.vehiculo || '—',
      r.es_chofer ? 'SÍ (driver)' : 'NO (helper)',
      r.helper_nombre_limpio || '—',
      r.helpers_nombres || '—',
      r.helper_ids_personas || '—',
      r.helper_estado_padron || '—',
      r.helper_name_padron || '—',
      r.helper_curp_padron || '—',
      r.helper_match_score_padron != null ? r.helper_match_score_padron : '—',
      r.helper_estado_bt || '—',
      r.helper_nombre_bt || '—',
      r.helper_respuesta_bt || '—',
      r.helper_empresa_bt || '—',
      r.universo || '—',
      r.helper_cert_estado || '—',
      r.helper_pct || '—',
      r.pct_participacion_helper != null ? r.pct_participacion_helper : '—',
      (r.helper_alertas || []).join(' · '),
      `Tarifa helper NO autorizada — ${r.sc} · ${r.vehiculo || ''}`,
      'Bloquear · gestionar con MELI',
    ]),
    `BT_U1_${dd.svc}_${(dd.vehiculo || '').replace(/[^a-zA-Z0-9]/g, '_')}.csv`
  );
  return (
    <DrillWrap dd={dd} fecha={fecha} onClose={onClose} icon="ti-map-pin" onExport={exportar}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <ThDt>Driver</ThDt>
          <ThDt>Ruta</ThDt>
          <ThDt>SC</ThDt>
          <ThDt>Persona que entregó</ThDt>
          <ThDt>Match Padrón MELI</ThDt>
          <ThDt>Match BT</ThDt>
          <ThDt>% Persona</ThDt>
          <ThDt>Alertas Maestro</ThDt>
          <ThDt>Acción</ThDt>
        </tr></thead>
        <tbody>{filas.map((r, i) => {
          const esPrimeraDeRuta = i === 0 || filas[i - 1].id_ruta !== r.id_ruta;
          const span = rutaCount[r.id_ruta];
          return (
            <DrillRow key={`${r.id_ruta}-${r.helper_idx}-${i}`} r={r} esPrimeraDeRuta={esPrimeraDeRuta && i > 0}>
              {esPrimeraDeRuta && <TdDt rowSpan={span}><DriverCell r={r} /></TdDt>}
              {esPrimeraDeRuta && <TdDt mono rowSpan={span}>{r.id_ruta}</TdDt>}
              {esPrimeraDeRuta && <TdDt mono rowSpan={span}>{r.sc}</TdDt>}
              <TdDt>
                <NombreHelper limpio={r.helper_nombre_limpio} raw={r.helpers_nombres} idx={r.helper_idx} count={r.helper_count} esChofer={r.es_chofer} esDisparador={r._esDisparador} />
                {r.helper_ids_personas && (
                  <div style={{ fontFamily: 'monospace', fontSize: 9, color: CH_LIGHT, marginTop: 2 }}>
                    id: {r.helper_ids_personas}
                  </div>
                )}
              </TdDt>
              <TdDt><PadronCell r={r} /></TdDt>
              <TdDt><BtCell r={r} /></TdDt>
              <TdDt center><PctHelperCell pct={r.helper_pct} /></TdDt>
              <TdDt>
                <AlertasInline alertas={r.helper_alertas} />
              </TdDt>
              <TdDt action>🚫 No autorizada · gestionar con MELI</TdDt>
            </DrillRow>
          );
        })}</tbody>
      </table>
    </DrillWrap>
  );
}

function DrillDown2({ dd, datos, fecha, onClose }) {
  const isBtRech = dd.col === 'btRech';
  const icon = isBtRech ? 'ti-shield-x' : 'ti-id-badge';
  const accionTxt = isBtRech
    ? '🔴 BT lo rechazó · NO debería operar · contactar SC inmediato'
    : '🔴 No identificado · investigar si es helper fantasma o alias';

  // ⭐ v9: expandir a tripulación completa de las rutas afectadas
  const filas = expandirTripulacion(dd.rutas, datos);
  // ⭐ v9.2: pre-calcular cuántas filas tiene cada ruta para usar rowSpan
  const rutaCount = {};
  filas.forEach(r => { rutaCount[r.id_ruta] = (rutaCount[r.id_ruta] || 0) + 1; });

  const exportar = () => exportCH(
    ["Disparador", "Driver (chofer)", "Driver ID", "Ruta", "SC",
     "Es chofer", "Helper", "Helper Raw", "Helper ID",
     "Match Padrón MELI", "Nombre padrón", "CURP padrón", "Score padrón",
     "Match BT", "Nombre BT", "Respuesta BT", "Empresa BT",
     "Universo persona", "Cert estado",
     "% Helper", "Alertas Maestro", "Acción"],
    filas.map(r => [
      r._esDisparador ? '⭐ SÍ' : '',
      r.chofer_nombre || '—',
      r.chofer_user_id || '—',
      r.id_ruta,
      r.sc,
      r.es_chofer ? 'SÍ (driver)' : 'NO (helper)',
      r.helper_nombre_limpio || '—',
      r.helpers_nombres || '—',
      r.helper_ids_personas || '—',
      r.helper_estado_padron || '—',
      r.helper_name_padron || '—',
      r.helper_curp_padron || '—',
      r.helper_match_score_padron != null ? r.helper_match_score_padron : '—',
      r.helper_estado_bt || '—',
      r.helper_nombre_bt || '—',
      r.helper_respuesta_bt || '—',
      r.helper_empresa_bt || '—',
      r.universo || '—',
      r.helper_cert_estado || '—',
      r.helper_pct || '—',
      (r.helper_alertas || []).join(' · '),
      r._esDisparador ? (isBtRech ? 'Contactar SC inmediato' : 'Verificar identidad') : 'Contexto · misma ruta',
    ]),
    `BT_U2_${dd.col}_${dd.svc}.csv`
  );

  return (
    <DrillWrap dd={dd} fecha={fecha} onClose={onClose} icon={icon} onExport={exportar}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <ThDt>Driver</ThDt>
          <ThDt>Ruta</ThDt>
          <ThDt>SC</ThDt>
          <ThDt>Persona que entregó</ThDt>
          <ThDt>Match Padrón MELI</ThDt>
          <ThDt>Match BT</ThDt>
          <ThDt>% Persona</ThDt>
        </tr></thead>
        <tbody>{filas.map((r, i) => {
          const esPrimeraDeRuta = i === 0 || filas[i - 1].id_ruta !== r.id_ruta;
          const span = rutaCount[r.id_ruta];
          return (
            <DrillRow key={`${r.id_ruta}-${r.helper_idx}-${i}`} r={r} esPrimeraDeRuta={esPrimeraDeRuta && i > 0}>
              {esPrimeraDeRuta && <TdDt rowSpan={span}><DriverCell r={r} /></TdDt>}
              {esPrimeraDeRuta && <TdDt mono rowSpan={span}>{r.id_ruta}</TdDt>}
              {esPrimeraDeRuta && <TdDt mono rowSpan={span}>{r.sc}</TdDt>}
              <TdDt>
                <NombreHelper limpio={r.helper_nombre_limpio} raw={r.helpers_nombres} idx={r.helper_idx} count={r.helper_count} esChofer={r.es_chofer} esDisparador={r._esDisparador} />
                {r.helper_ids_personas && (
                  <div style={{ fontFamily: 'monospace', fontSize: 9, color: CH_LIGHT, marginTop: 2 }}>
                    id: {r.helper_ids_personas}
                  </div>
                )}
              </TdDt>
              <TdDt><PadronCell r={r} /></TdDt>
              <TdDt><BtCell r={r} /></TdDt>
              <TdDt center><PctHelperCell pct={r.helper_pct} /></TdDt>
            </DrillRow>
          );
        })}</tbody>
      </table>
    </DrillWrap>
  );
}

function DrillDown3({ dd, datos, fecha, onClose }) {
  const config = {
    sinBt: { pill: 'yellow', pillTxt: 'SIN BT', accion: 'RH cargar en BBDD BT', icon: 'ti-file-x' },
    btPend: { pill: 'orange', pillTxt: 'BT PENDIENTE', accion: 'Esperar respuesta de BT', icon: 'ti-clock' },
    meliInact: { pill: 'gray', pillTxt: 'MELI INACTIVE', accion: 'Verificar status con coordinador', icon: 'ti-user-off' },
    matchDudoso: { pill: 'yellow', pillTxt: 'SCORE BAJO', accion: 'Verificar identidad · revisar nombre raw', icon: 'ti-search' },
  };
  const cfg = config[dd.col] || config.sinBt;

  // ⭐ v9: expandir a tripulación completa de las rutas afectadas
  const filas = expandirTripulacion(dd.rutas, datos);
  // ⭐ v9.2: pre-calcular cuántas filas tiene cada ruta para usar rowSpan
  const rutaCount = {};
  filas.forEach(r => { rutaCount[r.id_ruta] = (rutaCount[r.id_ruta] || 0) + 1; });

  const exportar = () => exportCH(
    ["Disparador", "Driver (chofer)", "Driver ID", "Ruta", "SC",
     "Es chofer", "Helper", "Helper Raw", "Helper ID",
     "Match Padrón MELI", "Nombre padrón", "CURP padrón", "Score padrón",
     "Match BT", "Nombre BT", "Respuesta BT", "Empresa BT",
     "Universo persona", "Cert estado",
     "% Helper", "Alertas Maestro", "Acción"],
    filas.map(r => [
      r._esDisparador ? '⭐ SÍ' : '',
      r.chofer_nombre || '—',
      r.chofer_user_id || '—',
      r.id_ruta,
      r.sc,
      r.es_chofer ? 'SÍ (driver)' : 'NO (helper)',
      r.helper_nombre_limpio || '—',
      r.helpers_nombres || '—',
      r.helper_ids_personas || '—',
      r.helper_estado_padron || '—',
      r.helper_name_padron || '—',
      r.helper_curp_padron || '—',
      r.helper_match_score_padron != null ? r.helper_match_score_padron : '—',
      r.helper_estado_bt || '—',
      r.helper_nombre_bt || '—',
      r.helper_respuesta_bt || '—',
      r.helper_empresa_bt || '—',
      r.universo || '—',
      r.helper_cert_estado || '—',
      r.helper_pct || '—',
      (r.helper_alertas || []).join(' · '),
      r._esDisparador ? cfg.accion : 'Contexto · misma ruta',
    ]),
    `BT_U3_${dd.col}_${dd.svc}.csv`
  );

  return (
    <DrillWrap dd={dd} fecha={fecha} onClose={onClose} icon={cfg.icon} onExport={exportar}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <ThDt>Driver</ThDt>
          <ThDt>Ruta</ThDt>
          <ThDt>SC</ThDt>
          <ThDt>Persona que entregó</ThDt>
          <ThDt>Match Padrón MELI</ThDt>
          <ThDt>Match BT</ThDt>
          <ThDt>% Persona</ThDt>
        </tr></thead>
        <tbody>{filas.map((r, i) => {
          const esPrimeraDeRuta = i === 0 || filas[i - 1].id_ruta !== r.id_ruta;
          const span = rutaCount[r.id_ruta];
          return (
            <DrillRow key={`${r.id_ruta}-${r.helper_idx}-${i}`} r={r} esPrimeraDeRuta={esPrimeraDeRuta && i > 0}>
              {esPrimeraDeRuta && <TdDt rowSpan={span}><DriverCell r={r} /></TdDt>}
              {esPrimeraDeRuta && <TdDt mono rowSpan={span}>{r.id_ruta}</TdDt>}
              {esPrimeraDeRuta && <TdDt mono rowSpan={span}>{r.sc}</TdDt>}
              <TdDt>
                <NombreHelper limpio={r.helper_nombre_limpio} raw={r.helpers_nombres} idx={r.helper_idx} count={r.helper_count} esChofer={r.es_chofer} esDisparador={r._esDisparador} />
                {r.helper_ids_personas && (
                  <div style={{ fontFamily: 'monospace', fontSize: 9, color: CH_LIGHT, marginTop: 2 }}>
                    id: {r.helper_ids_personas}
                  </div>
                )}
              </TdDt>
              <TdDt><PadronCell r={r} /></TdDt>
              <TdDt><BtCell r={r} /></TdDt>
              <TdDt center><PctHelperCell pct={r.helper_pct} /></TdDt>
            </DrillRow>
          );
        })}</tbody>
      </table>
    </DrillWrap>
  );
}

function DrillWrap({ dd, fecha, onClose, icon, onExport, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f8fafc',
        borderRadius: 12, marginBottom: 10, fontSize: 12, border: `0.5px solid ${CH_BORDER}`,
      }}>
        <i className={`ti ${icon}`} style={{ fontSize: 16, color: CH_NAVY }} />
        <span style={{ fontWeight: 700, color: CH_NAVY, fontSize: 13 }}>{dd.svc}</span>
        {(dd.vehiculo || dd.label) && (
          <>
            <i className="ti ti-chevron-right" style={{ fontSize: 12, color: CH_LIGHT }} />
            <span style={{ color: CH_MUTED }}>{dd.vehiculo || dd.label}</span>
          </>
        )}
        {/* Mini-leyenda del resaltado · ⭐ v9.2 */}
        <span style={{
          marginLeft: 12, display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 10, color: CH_MUTED,
        }}>
          <span style={{
            background: '#fed7aa', color: '#9a3412',
            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
            whiteSpace: 'nowrap',
          }}>⭐ CASO</span>
          <span style={{ color: CH_LIGHT }}>= persona que cumple el filtro · resto = tripulación de la misma ruta</span>
        </span>
        <span style={{
          background: '#fee2e2', color: '#991b1b', padding: '3px 9px', borderRadius: 5,
          fontSize: 10, fontWeight: 700, marginLeft: 'auto', letterSpacing: 0.3, textTransform: 'uppercase',
        }}>{dd.n} casos</span>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: CH_MUTED, padding: '0 4px',
        }}>✕</button>
      </div>
      <div style={{ background: CH_CARD, borderRadius: 12, border: `0.5px solid ${CH_BORDER}`, overflow: 'hidden' }}>
        {children}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderTop: `1px solid ${CH_BORDER}`, background: '#f8fafc',
        }}>
          <span style={{ fontSize: 10, color: CH_LIGHT, fontStyle: 'italic' }}>
            {dd.n} casos · {dd.svc} · {dd.vehiculo || dd.label || ''} · {fecha}
          </span>
          <button onClick={onExport} style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600,
            fontFamily: "'Geist', sans-serif", color: '#fff', border: 'none',
            borderRadius: 6, padding: '7px 14px', cursor: 'pointer', background: CH_NAVY,
          }}>
            <i className="ti ti-download" style={{ fontSize: 14 }} />Exportar CSV
          </button>
        </div>
      </div>
    </div>
  );
}

function KCard({ l, v, s, a, sk, accent, delta, deltaIsBad }) {
  // Si recibe delta numérico, mostrar comparación con ayer
  // deltaIsBad: si true, subir es malo (rojo) · si false, subir es bueno (verde)
  const showDelta = delta !== undefined && delta !== null;
  let deltaColor = '#9ca3af', deltaIcon = '—', deltaText = 'igual ayer';
  if (showDelta) {
    const subio = delta > 0;
    const bajo = delta < 0;
    if (subio) {
      deltaColor = deltaIsBad ? '#ef4444' : '#10b981';
      deltaIcon = '▲';
      deltaText = `${delta} vs ayer`;
    } else if (bajo) {
      deltaColor = deltaIsBad ? '#10b981' : '#ef4444';
      deltaIcon = '▼';
      deltaText = `${Math.abs(delta)} vs ayer`;
    }
  }
  return (
    <div style={{ background: CH_CARD, borderRadius: 12, border: `0.5px solid ${CH_BORDER}`, padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', minHeight: 130 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: CH_MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>{l}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: CH_TEXT, letterSpacing: -0.5, lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: 11, color: CH_LIGHT, marginTop: 5 }}>{s}</div>
      <div style={{ height: 1, background: CH_BORDER, margin: '10px 0' }} />
      {showDelta ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: deltaColor }}>{deltaIcon}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: deltaColor }}>{deltaText}</span>
        </div>
      ) : (
        <Spark vals={sk} height={28} color={accent} />
      )}
      <div style={{ height: 1, background: CH_BORDER, margin: '10px 0' }} />
      <div style={{ fontSize: 11, fontWeight: 500, color: CH_MUTED, marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className="ti ti-arrow-right" style={{ fontSize: 12 }} />{a}
      </div>
    </div>
  );
}

function Spark({ vals, height = 28, color }) {
  if (!vals || vals.length < 2) return <svg width="100%" height={height} />;
  const smooth = vals.map((x, i, a) => { const p = a[i - 1] ?? x, n = a[i + 1] ?? x; return (p + x + x + n) / 4; });
  const w = 100, h = height, pad = 2;
  const mn = Math.min(...smooth) - 0.5, mx = Math.max(...smooth) + 0.5;
  const px = i => pad + (i / (smooth.length - 1)) * (w - pad * 2);
  const py = v => h - pad - (v - mn) / (mx - mn || 1) * (h - pad * 2);
  let d = `M${px(0).toFixed(1)},${py(smooth[0]).toFixed(1)}`;
  for (let i = 0; i < smooth.length - 1; i++) {
    const x1 = px(i), y1 = py(smooth[i]), x2 = px(i + 1), y2 = py(smooth[i + 1]), cx = (x1 + x2) / 2;
    d += ` C${cx.toFixed(1)},${y1.toFixed(1)} ${cx.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  const lx = px(smooth.length - 1).toFixed(1), ly = py(smooth[smooth.length - 1]).toFixed(1);
  const area = `${d} L${lx},${h} L${px(0).toFixed(1)},${h} Z`;
  const stroke = color || CH_LIGHT;
  return (
    <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      <path d={area} fill={stroke} fillOpacity=".12" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2" fill={stroke} />
    </svg>
  );
}

function SLabel({ text, badge, badgeColor, fecha }) {
  const colors = badgeColor === 'yellow'
    ? { bg: CH_YELLOW, color: CH_YELLOW_TEXT, border: '#fde68a' }
    : { bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe' };
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: CH_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
      {text}
      <span style={{
        background: colors.bg, color: colors.color, border: `1px solid ${colors.border}`,
        fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
        marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, textTransform: 'none',
        letterSpacing: 0.2,
      }}>
        <i className="ti ti-database" style={{ fontSize: 10 }} />{badge} · {fecha}
      </span>
    </div>
  );
}

function Hint({ text }) {
  return (
    <div style={{
      textAlign: 'center', padding: 24, color: CH_LIGHT, fontSize: 12,
      border: `1px dashed ${CH_BORDER}`, borderRadius: 12, marginTop: 12, background: '#fafafa',
    }}>
      <i className="ti ti-hand-click" style={{ fontSize: 24, display: 'block', marginBottom: 6, color: '#d1d5db' }} />
      {text}
    </div>
  );
}

function HmLegend({ note, hint }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 14px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: CH_MUTED }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: CH_RED }} />Crítico (6+)
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: CH_MUTED }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: CH_RED_SOFT }} />Medio (3–5)
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: CH_MUTED }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: CH_YELLOW, border: '1px solid #fde68a' }} />Bajo (1–2)
      </div>
      {note && <span style={{ fontSize: 10, color: CH_LIGHT, fontStyle: 'italic' }}>{note}</span>}
      {hint && <span style={{ marginLeft: 'auto', fontSize: 10, color: CH_LIGHT }}>{hint}</span>}
    </div>
  );
}

function ThHm({ children, align }) {
  return <th style={{
    padding: '8px 10px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: CH_MUTED, textAlign: align || 'center', borderBottom: `1px solid ${CH_BORDER}`,
    background: '#f8fafc', whiteSpace: 'nowrap',
  }}>{children}</th>;
}

function TdSn({ children, total }) {
  return <td style={{
    padding: '9px 12px', border: `0.5px solid ${CH_BORDER}`, textAlign: 'left',
    fontWeight: 700, color: CH_NAVY, background: '#f8fafc',
    fontSize: total ? 12 : 11.5, borderTop: total ? `1px solid ${CH_BORDER}` : undefined,
  }}>{children}</td>;
}

function TdHeat({ n, selected, onClick }) {
  const cls = n === 0 ? { background: '#f8fafc', color: '#d1d5db' }
    : n >= 6 ? { background: CH_RED, color: '#fff', fontWeight: 700 }
    : n >= 3 ? { background: CH_RED_SOFT, color: '#7f1d1d', fontWeight: 700 }
    : { background: CH_YELLOW, color: CH_YELLOW_TEXT, fontWeight: 600 };
  return (
    <td onClick={onClick} style={{
      padding: '9px 10px', border: `0.5px solid ${CH_BORDER}`, textAlign: 'center',
      fontSize: 12.5, cursor: n > 0 ? 'pointer' : 'default',
      outline: selected ? `2.5px solid ${CH_ORANGE}` : undefined,
      outlineOffset: selected ? -2 : undefined, position: 'relative',
      ...cls,
    }}>{n === 0 ? '0' : n}</td>
  );
}

function TdTc({ children }) {
  return <td style={{ padding: '9px 10px', border: `0.5px solid ${CH_BORDER}`, textAlign: 'center', background: '#f8fafc', fontWeight: 700, color: CH_TEXT, fontSize: 12 }}>{children}</td>;
}

function TdTotal({ children, strong }) {
  return <td style={{ padding: '9px 10px', textAlign: 'center', background: '#f8fafc', fontWeight: 700, color: strong ? CH_NAVY : CH_TEXT, fontSize: 12 }}>{children}</td>;
}

function ThDt({ children }) {
  return <th style={{
    padding: '9px 12px', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: CH_MUTED, textAlign: 'left', borderBottom: `1px solid ${CH_BORDER}`, background: '#f8fafc',
  }}>{children}</th>;
}

function TdDt({ children, mono, bold, muted, center, action, rowSpan }) {
  return <td rowSpan={rowSpan} style={{
    padding: '9px 12px', borderBottom: '0.5px solid #f4f5f7', fontSize: 12,
    fontFamily: mono ? 'monospace' : "'Geist', sans-serif",
    color: action ? CH_NAVY : muted ? CH_MUTED : CH_TEXT,
    fontWeight: bold || action ? 600 : 'normal',
    textAlign: center ? 'center' : 'left',
    verticalAlign: rowSpan ? 'top' : 'baseline',
  }}>{children}</td>;
}

function Pill({ children, type }) {
  const palette = {
    red:    { background: '#fee2e2', color: '#991b1b' },
    orange: { background: '#fed7aa', color: '#9a3412' },
    yellow: { background: '#fef3c7', color: '#92400e' },
    rose:   { background: '#fce7f3', color: '#9f1239' },
    gray:   { background: '#f3f4f6', color: '#374151' },
    green:  { background: '#d1fae5', color: '#065f46' },
  };
  const styles = palette[type] || palette.yellow;
  return <span style={{ ...styles, fontSize: 9.5, fontWeight: 700, padding: '3px 8px', borderRadius: 5, textTransform: 'uppercase', letterSpacing: 0.3 }}>{children}</span>;
}

function expandirTripulacion(filasDisparadoras, datos) {
  if (!filasDisparadoras || filasDisparadoras.length === 0) return [];
  // Identificar disparadoras por (id_ruta + helper_idx) que es la clave única de cada fila
  const disparadorKey = new Set(
    filasDisparadoras.map(r => `${r.id_ruta}::${r.helper_idx ?? ''}`)
  );
  const rutaIds = new Set(filasDisparadoras.map(r => r.id_ruta));
  // Tomar TODAS las filas de las rutas afectadas
  const todasFilas = datos.filter(r => rutaIds.has(r.id_ruta));
  // Marcar disparadoras + ordenar por ruta, driver primero, luego helpers por idx
  const conFlag = todasFilas.map(r => ({
    ...r,
    _esDisparador: disparadorKey.has(`${r.id_ruta}::${r.helper_idx ?? ''}`),
  }));
  conFlag.sort((a, b) => {
    if (a.id_ruta !== b.id_ruta) return Number(a.id_ruta) - Number(b.id_ruta);
    if (a.es_chofer !== b.es_chofer) return a.es_chofer ? -1 : 1;
    return (a.helper_idx || 0) - (b.helper_idx || 0);
  });
  return conFlag;
}

function DrillRow({ r, esPrimeraDeRuta, children }) {
  const esDisp = r._esDisparador;
  return (
    <tr style={{
      borderBottom: `0.5px solid #f4f5f7`,
      borderTop: esPrimeraDeRuta ? `2px solid ${CH_BORDER}` : undefined,
      background: esDisp ? '#fffaf2' : 'transparent',
      verticalAlign: 'top',
    }}>
      {children}
    </tr>
  );
}

function DriverCell({ r }) {
  if (!r.chofer_nombre) return <span style={{ color: CH_LIGHT }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontWeight: 600, fontSize: 11 }}>{r.chofer_nombre}</span>
      {r.chofer_user_id && (
        <span style={{ fontSize: 9, color: CH_LIGHT, fontFamily: 'monospace' }}>
          id: {r.chofer_user_id}
        </span>
      )}
    </div>
  );
}

function NombreHelper({ limpio, raw, idx, count, esChofer, esDisparador }) {
  if (!limpio && !raw) return <span style={{ color: CH_LIGHT }}>—</span>;
  const showMulti = count > 1;
  // Pill rol DRIVER/HELPER
  const rolPill = esChofer === true ? (
    <span style={{
      background: '#d1fae5', color: '#065f46',
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
      whiteSpace: 'nowrap', marginRight: 4,
    }}>🚛 DRIVER</span>
  ) : esChofer === false ? (
    <span style={{
      background: '#dbeafe', color: '#1e40af',
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
      whiteSpace: 'nowrap', marginRight: 4,
    }}>👤 HELPER</span>
  ) : null;
  // ⭐ v9.2: pill de disparadora (la persona que cumple el filtro del drilldown)
  const dispPill = esDisparador ? (
    <span style={{
      background: '#fed7aa', color: '#9a3412',
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
      whiteSpace: 'nowrap', marginRight: 4,
    }}>⭐ CASO</span>
  ) : null;
  const multiPill = showMulti && (
    <span style={{
      background: '#ede9fe', color: '#5b21b6',
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
      whiteSpace: 'nowrap', marginLeft: 4,
    }}>{idx} de {count}</span>
  );
  const nombreMostrado = limpio || raw;
  // ⭐ v9.3: el raw del Maestro es a nivel ruta (mezcla todas las personas)
  // y solo confunde — se oculta siempre. Si hace falta investigar, está en el CSV exportado.
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
      {dispPill}
      {rolPill}
      <span style={{ fontWeight: 600, fontSize: 11 }}>{nombreMostrado}</span>
      {multiPill}
    </div>
  );
}

function AlertasInline({ alertas }) {
  if (!alertas || alertas.length === 0) return <span style={{ color: CH_LIGHT }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {alertas.map((a, idx) => {
        const isRojo = a.includes('Helper >90') || a.includes('Multi-ID');
        const isNaranja = a.includes('Investigar') || a.includes('3+ personas');
        const isGris = a.includes('invisible');
        return (
          <span key={idx} style={{
            background: isRojo ? '#fee2e2' : isNaranja ? '#fef3c7' : isGris ? '#f1f5f9' : '#e0e7ff',
            color: isRojo ? '#dc2626' : isNaranja ? '#b45309' : isGris ? '#475569' : '#4338ca',
            padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600, whiteSpace: 'nowrap',
          }}>{a}</span>
        );
      })}
    </div>
  );
}

function PadronCell({ r }) {
  const e = r.helper_estado_padron;
  const score = r.helper_match_score_padron;
  if (e === 'NO_EN_PADRON') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Pill type="rose">❌ NO EN PADRÓN</Pill>
        <span style={{ fontSize: 9, color: CH_LIGHT, fontStyle: 'italic' }}>fantasma · investigar</span>
      </div>
    );
  }
  const scoreColor = score >= 0.9 ? '#065f46' : score >= 0.7 ? '#15803d' : '#9a3412';
  const pillType =
    e === 'EN_PADRON_ACTIVO' ? 'green' :
    e === 'EN_PADRON_INACTIVO' ? 'gray' :
    e === 'MATCH_DUDOSO' ? 'orange' : 'yellow';
  const pillLabel =
    e === 'EN_PADRON_ACTIVO' ? '✅ ACTIVO' :
    e === 'EN_PADRON_INACTIVO' ? '⚪ INACTIVO' :
    e === 'MATCH_DUDOSO' ? '🔍 DUDOSO' : e;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Pill type={pillType}>{pillLabel}</Pill>
      {r.helper_name_padron && (
        <span style={{ fontSize: 10, color: CH_MUTED }}>{r.helper_name_padron}</span>
      )}
      {score != null && (
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: scoreColor, fontWeight: 600 }}>
          score: {Number(score).toFixed(3)}
        </span>
      )}
      {r.helper_curp_padron && (
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: CH_LIGHT }}>
          {r.helper_curp_padron}
        </span>
      )}
    </div>
  );
}

function BtCell({ r }) {
  const e = r.helper_estado_bt;
  if (e === 'SIN_CURP_PARA_BUSCAR') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Pill type="gray">⚪ SIN CURP</Pill>
        <span style={{ fontSize: 9, color: CH_LIGHT, fontStyle: 'italic' }}>no encontrado en padrón</span>
      </div>
    );
  }
  if (e === 'NO_EN_BT') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Pill type="yellow">🟡 NO EN BT</Pill>
        <span style={{ fontSize: 9, color: CH_LIGHT, fontStyle: 'italic' }}>cargar en BBDD BT</span>
      </div>
    );
  }
  const pillType =
    e === 'BT_APROBADO' ? 'green' :
    e === 'BT_RECHAZADO' ? 'red' :
    e === 'BT_PENDIENTE' ? 'orange' : 'gray';
  const pillLabel =
    e === 'BT_APROBADO' ? '✅ APROBADO' :
    e === 'BT_RECHAZADO' ? '🔴 RECHAZADO' :
    e === 'BT_PENDIENTE' ? '🟠 PENDIENTE' : e;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Pill type={pillType}>{pillLabel}</Pill>
      {r.helper_nombre_bt && (
        <span style={{ fontSize: 10, color: CH_MUTED }}>{r.helper_nombre_bt}</span>
      )}
      {r.helper_empresa_bt && (
        <span style={{ fontSize: 9, color: CH_LIGHT, fontStyle: 'italic' }}>{r.helper_empresa_bt}</span>
      )}
    </div>
  );
}

function PctHelperCell({ pct }) {
  if (pct == null) return <span style={{ color: CH_LIGHT }}>—</span>;
  const high = pct > 90;
  return (
    <span style={{
      fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
      color: high ? '#dc2626' : '#1a1a1a',
    }}>{pct}%</span>
  );
}

function exportCH(headers, rows, filename) {
  if (!rows || rows.length === 0) return;
  const csv = [
    headers.join(','),
    ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

const VBT_NAVY = "#1a3a6b";

const VBT_ORANGE = "#F47B20";

const VBT_BG = "#f0f2f5";

const VBT_CARD = "#fff";

const VBT_BORDER = "#e4e7ec";

const VBT_TEXT = "#1a1a1a";

const VBT_MUTED = "#64748b";

const VBT_LIGHT = "#94a3b8";

const VBT_RED = "#dc2626";

const VBT_GREEN = "#15803d";

function PoolMeliValidacionBT({ usuario }) {
  const [tab, setTab] = useState(0);
  const [bt, setBt] = useState([]);
  const [operando, setOperando] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filtroGrav, setFiltroGrav] = useState('TODOS');
  const [filtroSvc, setFiltroSvc] = useState('TODOS');
  const [busqueda, setBusqueda] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [historialCurp, setHistorialCurp] = useState(null);
  const [multiDriver, setMultiDriver] = useState([]);
  const [multiDriverSinBt, setMultiDriverSinBt] = useState([]);
  const [showMultiDriverModal, setShowMultiDriverModal] = useState(false);
  const esAdmin = usuario?.rol === 'superadmin';

  const cargar = async () => {
    setLoading(true); setError(null);
    try {
      const [r1q, r2q, r3q, r4q] = await Promise.all([
        sb.from('vw_bt_vs_padron').select('*').order('gravedad'),
        sb.from('vw_bt_rechazados_operando').select('*').order('rutas', { ascending: false }),
        sb.from('vw_bt_multi_driver_id').select('*'),
        sb.from('vw_meli_multi_driver_sin_bt').select('*'),
      ]);
      if (r1q.error) throw r1q.error;
      if (r2q.error) throw r2q.error;
      // Las 2 vistas multi-ID son opcionales · si fallan (no existen) seguimos sin ellas
      setBt(r1q.data || []);
      setOperando(r2q.data || []);
      setMultiDriver(r3q.error ? [] : (r3q.data || []));
      setMultiDriverSinBt(r4q.error ? [] : (r4q.data || []));
    } catch (e) { setError(e.message || 'Error'); } finally { setLoading(false); }
  };

  useEffect(() => { cargar(); }, []);

  const kpis = useMemo(() => {
    const hoy = new Date(Date.now() - 6*60*60*1000).toISOString().split('T')[0];
    // Dedup por CURP para obtener PERSONAS únicas (la vista trae filas duplicadas
    // cuando una persona tiene multi-driver_id en el padrón)
    const personasMap = new Map();
    for (const row of bt) {
      if (!row.curp) continue;
      if (!personasMap.has(row.curp)) personasMap.set(row.curp, row);
    }
    const personas = Array.from(personasMap.values());
    return {
      total_bt: personas.length,
      criticos: personas.filter(b => b.gravedad === 'CRITICO').length,
      altos: personas.filter(b => b.gravedad === 'ALTO').length,
      medios: personas.filter(b => b.gravedad === 'MEDIO').length,
      en_padron: personas.filter(b => b.driver_id_padron).length,
      no_padron: personas.filter(b => !b.driver_id_padron).length,
      multi_driver: multiDriver.length,
      multi_driver_critico: multiDriver.filter(m => m.es_critico).length,
      multi_driver_sin_bt: multiDriverSinBt.length,
      operando_personas: new Set(operando.map(o => o.curp)).size,
      operando_rutas: operando.reduce((s, o) => s + (o.rutas || 0), 0),
      operando_hoy: new Set(operando.filter(o => o.hasta === hoy).map(o => o.curp)).size,
    };
  }, [bt, operando, multiDriver, multiDriverSinBt]);

  const btFiltrado = useMemo(() => {
    let f = bt;
    if (filtroGrav !== 'TODOS') f = f.filter(b => b.gravedad === filtroGrav);
    if (filtroSvc !== 'TODOS') f = f.filter(b => b.svc === filtroSvc);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(b => (b.nombre_bt || '').toLowerCase().includes(q) || (b.curp || '').toLowerCase().includes(q));
    }
    return f;
  }, [bt, filtroGrav, filtroSvc, busqueda]);

  const svcs = useMemo(() => [...new Set(bt.map(b => b.svc).filter(Boolean))].sort(), [bt]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: VBT_MUTED, fontSize: 13, fontFamily: "'Geist', sans-serif" }}>Cargando datos BT…</div>;
  if (error) return (
    <div style={{ padding: 24, fontFamily: "'Geist', sans-serif" }}>
      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: 6 }}>No se pudo cargar Validación BT</div>
        <div style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.6 }}>
          {error}<br/><br/>
          <strong>Causa probable:</strong> falta correr <code>SQL_01_validacion_bt_setup.sql</code> y <code>SQL_02_validacion_bt_carga_inicial.sql</code>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Geist', sans-serif", background: VBT_BG, color: VBT_TEXT }}>
      <div style={{ background: VBT_CARD, borderBottom: `1px solid ${VBT_BORDER}`, padding: '0 24px', display: 'flex', gap: 2 }}>
        {['Resumen', 'Operando (rechazados/pendientes)', 'Listado completo'].map((label, i) => (
          <div key={i} onClick={() => setTab(i)} style={{
            padding: '10px 16px', fontSize: 12, fontWeight: 600,
            color: tab === i ? VBT_NAVY : VBT_MUTED,
            borderBottom: tab === i ? `2px solid ${VBT_ORANGE}` : '2px solid transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
          }}>{label}</div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingRight: 4 }}>
          {esAdmin && (
            <button onClick={() => setShowUpload(true)} style={{
              fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
              border: `1px solid ${VBT_NAVY}`, background: VBT_NAVY, color: '#fff',
              cursor: 'pointer', fontFamily: "'Geist', sans-serif", whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, lineHeight: 1,
            }}>
              <i className="ti ti-upload" style={{ fontSize: 13 }} />
              Subir Excel BT
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: '16px 24px' }}>
        {tab === 0 && <ResumenBT kpis={kpis} bt={bt} operando={operando} onOpenMultiDriver={() => setShowMultiDriverModal(true)} />}
        {tab === 1 && <OperandoBT operando={operando} onSelectCurp={setHistorialCurp} />}
        {tab === 2 && <ListadoBT bt={btFiltrado} svcs={svcs}
          filtroGrav={filtroGrav} setFiltroGrav={setFiltroGrav}
          filtroSvc={filtroSvc} setFiltroSvc={setFiltroSvc}
          busqueda={busqueda} setBusqueda={setBusqueda}
          totalSinFiltro={bt.length} onSelectCurp={setHistorialCurp} />}
      </div>

      {showUpload && <UploadExcelBT onClose={() => { setShowUpload(false); cargar(); }} />}
      {historialCurp && <HistorialPersonaModal curp={historialCurp} onClose={() => setHistorialCurp(null)} />}
      {showMultiDriverModal && <MultiDriverIdModal data={multiDriver} sinBt={multiDriverSinBt} onClose={() => setShowMultiDriverModal(false)} onSelectCurp={(c) => { setShowMultiDriverModal(false); setHistorialCurp(c); }} />}
    </div>
  );
}

function ResumenBT({ kpis, bt, operando, onOpenMultiDriver }) {
  const porEmpresa = {};
  operando.forEach(o => {
    if (!porEmpresa[o.empresa]) porEmpresa[o.empresa] = { personas: new Set(), rutas: 0 };
    porEmpresa[o.empresa].personas.add(o.curp);
    porEmpresa[o.empresa].rutas += o.rutas || 0;
  });
  const empresasArr = Object.entries(porEmpresa)
    .map(([e, v]) => ({ empresa: e, personas: v.personas.size, rutas: v.rutas }))
    .sort((a, b) => b.rutas - a.rutas).slice(0, 8);
  const porSvc = {};
  operando.forEach(o => {
    if (!porSvc[o.svc]) porSvc[o.svc] = { personas: new Set(), rutas: 0 };
    porSvc[o.svc].personas.add(o.curp);
    porSvc[o.svc].rutas += o.rutas || 0;
  });
  const svcArr = Object.entries(porSvc).map(([s, v]) => ({ svc: s, personas: v.personas.size, rutas: v.rutas })).sort((a, b) => b.rutas - a.rutas);

  // Subtítulo dinámico del tile Multi-ID
  const multiSub = kpis.multi_driver === 0
    ? 'Sin casos detectados'
    : kpis.multi_driver_critico > 0
      ? `Múltiples driver_id · ${kpis.multi_driver_critico} crítico${kpis.multi_driver_critico === 1 ? '' : 's'}`
      : 'Múltiples driver_id · sin alertas';

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 14 }}>
        <VBT_KPI
          l="Total BT"
          v={kpis.total_bt}
          s={`${kpis.en_padron} en padrón · ${kpis.no_padron} no en MELI`}
          accent={VBT_NAVY}
          info="Total de personas únicas cargadas en el Excel BT (CURPs distintos). Es el universo de tripulantes que BT validó alguna vez. El subtítulo indica cuántos matchean con el padrón MELI actual y cuántos no aparecen en MELI."
        />
        <VBT_KPI
          l="🔴 Críticos"
          v={kpis.criticos}
          s="Rechazado por MELI"
          accent={VBT_RED}
          info="Personas que el Excel BT marca como RECHAZADO en la columna 'Respuesta MELI'. No deberían estar operando. Si están operando, aparecen en la pestaña 'Operando (rechazados/pendientes)'."
        />
        <VBT_KPI
          l="🟠 Pendientes"
          v={kpis.altos}
          s="Pendiente en MELI"
          accent={VBT_ORANGE}
          info="Personas que el Excel BT marca como PENDIENTE en la columna 'Respuesta MELI'. Falta resolución de MELI antes de que puedan operar normalmente."
        />
        <VBT_KPI
          l="🟡 Alerta BT"
          v={kpis.medios}
          s="Validación BT marcada"
          accent="#eab308"
          info="Personas marcadas como RECHAZADO o PENDIENTE en la columna interna 'Validación BT' del Excel. Es una segunda capa de control que BT lleva aparte del estado de MELI."
        />
        <VBT_KPI
          l="🟣 Multi-ID"
          v={kpis.multi_driver}
          s={multiSub}
          accent="#6366f1"
          info={`Personas con más de un driver_id activo simultáneamente en el padrón MELI (misma CURP, distintos IDs). Puede indicar duplicación administrativa o cambio de carrier. ${kpis.multi_driver_sin_bt > 0 ? `Además hay ${kpis.multi_driver_sin_bt} personas con multi-driver_id en MELI que no están cargadas en BT. ` : ''}Click en la tarjeta para ver el listado completo.`}
          onClick={kpis.multi_driver > 0 ? onOpenMultiDriver : undefined}
        />
      </div>

      {kpis.operando_personas > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="ti ti-alert-triangle" style={{ fontSize: 16 }} />
            Universo crítico · Acción inmediata
          </div>
          <div style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.5 }}>
            <strong>{kpis.operando_personas} personas</strong> con flags activos en BT operando últimos 30 días · <strong>{kpis.operando_rutas} rutas</strong> · <strong>{kpis.operando_hoy} operando HOY</strong>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: VBT_CARD, borderRadius: 12, border: `0.5px solid ${VBT_BORDER}`, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${VBT_BORDER}`, background: '#f8fafc' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: VBT_MUTED, textTransform: 'uppercase', letterSpacing: 0.5 }}>Por empresa · TOP 8 (con alerta operando)</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr><VBT_ThS>Empresa</VBT_ThS><VBT_ThS>Personas</VBT_ThS><VBT_ThS>Rutas</VBT_ThS></tr></thead>
            <tbody>
              {empresasArr.length === 0 ? <tr><td colSpan={3} style={{ padding: 20, textAlign: 'center', color: VBT_LIGHT, fontSize: 11 }}>Sin datos</td></tr> :
                empresasArr.map((e, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid #f4f5f7' }}>
                    <VBT_TdS bold>{e.empresa || '—'}</VBT_TdS>
                    <VBT_TdS center>{e.personas}</VBT_TdS>
                    <VBT_TdS center strong>{e.rutas}</VBT_TdS>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div style={{ background: VBT_CARD, borderRadius: 12, border: `0.5px solid ${VBT_BORDER}`, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${VBT_BORDER}`, background: '#f8fafc' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: VBT_MUTED, textTransform: 'uppercase', letterSpacing: 0.5 }}>Por SVC</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr><VBT_ThS>SVC</VBT_ThS><VBT_ThS>Personas</VBT_ThS><VBT_ThS>Rutas</VBT_ThS></tr></thead>
            <tbody>
              {svcArr.length === 0 ? <tr><td colSpan={3} style={{ padding: 20, textAlign: 'center', color: VBT_LIGHT, fontSize: 11 }}>Sin datos</td></tr> :
                svcArr.map((s, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid #f4f5f7' }}>
                    <VBT_TdS bold>{s.svc || '—'}</VBT_TdS>
                    <VBT_TdS center>{s.personas}</VBT_TdS>
                    <VBT_TdS center strong>{s.rutas}</VBT_TdS>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function OperandoBT({ operando, onSelectCurp }) {
  const exportar = () => {
    const headers = ['Gravedad','CURP','Nombre','SC','Cargo','Empresa','Respuesta MELI','Validación BT','Rol','Rutas','Desde','Hasta'];
    const rows = operando.map(o => [o.gravedad,o.curp,o.nombre_bt,o.svc,o.cargo,o.empresa,o.respuesta_meli,o.validacion_bt,o.rol,o.rutas,o.desde,o.hasta]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `BT_rechazados_operando_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  };

  if (operando.length === 0) return (
    <div style={{ padding: 40, textAlign: 'center', color: VBT_LIGHT, fontSize: 13, background: VBT_CARD, borderRadius: 12, border: `1px dashed ${VBT_BORDER}` }}>
      <i className="ti ti-circle-check" style={{ fontSize: 32, color: VBT_GREEN, display: 'block', marginBottom: 8 }} />
      Sin personas rechazadas/pendientes operando en los últimos 30 días
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: VBT_MUTED }}>
          <strong>{new Set(operando.map(o=>o.curp)).size} personas</strong> con alerta operando · <strong>{operando.length} casos</strong> (rol chofer + helper)
        </div>
        <button onClick={exportar} style={{
          fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
          border: 'none', background: VBT_NAVY, color: '#fff', cursor: 'pointer',
          fontFamily: "'Geist', sans-serif",
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <i className="ti ti-download" style={{ fontSize: 13 }} />Exportar CSV
        </button>
      </div>
      <div style={{ background: VBT_CARD, borderRadius: 12, border: `0.5px solid ${VBT_BORDER}`, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <VBT_ThS>Gravedad</VBT_ThS><VBT_ThS>Nombre</VBT_ThS><VBT_ThS>SC</VBT_ThS><VBT_ThS>Cargo</VBT_ThS>
              <VBT_ThS>Respuesta MELI</VBT_ThS><VBT_ThS>Empresa</VBT_ThS><VBT_ThS>Rol</VBT_ThS><VBT_ThS>Rutas</VBT_ThS><VBT_ThS>Hasta</VBT_ThS>
            </tr>
          </thead>
          <tbody>
            {operando.map((o, i) => {
              const bg = o.gravedad === 'CRITICO' ? '#fef2f2' : o.gravedad === 'ALTO' ? '#fffbeb' : '#eff6ff';
              return (
                <tr key={i} onClick={() => onSelectCurp && onSelectCurp(o.curp)}
                    style={{ borderBottom: '0.5px solid #f4f5f7', background: bg, cursor: 'pointer' }}
                    title="Click para ver historial completo">
                  <VBT_TdS><VBT_Pill type={o.gravedad === 'CRITICO' ? 'red' : o.gravedad === 'ALTO' ? 'yellow' : 'blue'}>{o.gravedad}</VBT_Pill></VBT_TdS>
                  <VBT_TdS bold>{o.nombre_bt}</VBT_TdS>
                  <VBT_TdS mono>{o.svc}</VBT_TdS>
                  <VBT_TdS>{o.cargo}</VBT_TdS>
                  <VBT_TdS><VBT_Pill type={o.respuesta_meli === 'RECHAZADO' ? 'red' : 'yellow'}>{o.respuesta_meli}</VBT_Pill></VBT_TdS>
                  <VBT_TdS muted>{o.empresa}</VBT_TdS>
                  <VBT_TdS>{o.rol}</VBT_TdS>
                  <VBT_TdS center strong>{o.rutas}</VBT_TdS>
                  <VBT_TdS mono>{o.hasta}</VBT_TdS>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListadoBT({ bt, svcs, filtroGrav, setFiltroGrav, filtroSvc, setFiltroSvc, busqueda, setBusqueda, totalSinFiltro, onSelectCurp }) {
  const exportar = () => {
    const headers = ['CURP','Nombre','SC','Cargo','Empresa','Respuesta MELI','Validación BT','En padrón','Status padrón','Estado cruce','Gravedad'];
    const rows = bt.map(b => [b.curp,b.nombre_bt,b.svc,b.cargo,b.empresa,b.respuesta_meli,b.validacion_bt,b.driver_id_padron?'SÍ':'NO',b.status_padron||'',b.estado_cruce,b.gravedad]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `BT_listado_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre o CURP..."
          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: `1px solid ${VBT_BORDER}`, width: 220, fontFamily: "'Geist', sans-serif", outline: 'none' }} />
        <select value={filtroGrav} onChange={e => setFiltroGrav(e.target.value)}
          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: `1px solid ${VBT_BORDER}`, fontFamily: "'Geist', sans-serif", outline: 'none', cursor: 'pointer' }}>
          <option value="TODOS">Todas las gravedades</option>
          <option value="CRITICO">🔴 Crítico</option>
          <option value="ALTO">🟠 Alto</option>
          <option value="MEDIO">🟡 Medio</option>
          <option value="OK">🟢 OK</option>
        </select>
        <select value={filtroSvc} onChange={e => setFiltroSvc(e.target.value)}
          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: `1px solid ${VBT_BORDER}`, fontFamily: "'Geist', sans-serif", outline: 'none', cursor: 'pointer' }}>
          <option value="TODOS">Todos los SC</option>
          {svcs.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 11, color: VBT_MUTED, marginLeft: 4 }}>{bt.length} / {totalSinFiltro} registros</span>
        <button onClick={exportar} style={{
          marginLeft: 'auto', fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
          border: 'none', background: VBT_NAVY, color: '#fff', cursor: 'pointer',
          fontFamily: "'Geist', sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <i className="ti ti-download" style={{ fontSize: 13 }} />Exportar CSV
        </button>
      </div>

      <div style={{ background: VBT_CARD, borderRadius: 12, border: `0.5px solid ${VBT_BORDER}`, overflow: 'hidden', maxHeight: '60vh', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <VBT_ThS>Grav.</VBT_ThS><VBT_ThS>CURP</VBT_ThS><VBT_ThS>Nombre</VBT_ThS><VBT_ThS>SC</VBT_ThS><VBT_ThS>Cargo</VBT_ThS>
              <VBT_ThS>Empresa</VBT_ThS><VBT_ThS>Respuesta MELI</VBT_ThS><VBT_ThS>Padrón</VBT_ThS><VBT_ThS>Status</VBT_ThS><VBT_ThS>Hist.</VBT_ThS>
            </tr>
          </thead>
          <tbody>
            {bt.map((b, i) => (
              <tr key={i} onClick={() => onSelectCurp && onSelectCurp(b.curp)}
                  style={{ borderBottom: '0.5px solid #f4f5f7', cursor: 'pointer' }}
                  title="Click para ver historial completo">
                <VBT_TdS><VBT_Pill type={b.gravedad === 'CRITICO' ? 'red' : b.gravedad === 'ALTO' ? 'yellow' : b.gravedad === 'MEDIO' ? 'blue' : 'gray'}>{b.gravedad}</VBT_Pill></VBT_TdS>
                <VBT_TdS mono small>{b.curp}</VBT_TdS>
                <VBT_TdS bold>{b.nombre_bt}</VBT_TdS>
                <VBT_TdS mono>{b.svc}</VBT_TdS>
                <VBT_TdS>{b.cargo}</VBT_TdS>
                <VBT_TdS muted small>{b.empresa}</VBT_TdS>
                <VBT_TdS>{b.respuesta_meli || '—'}</VBT_TdS>
                <VBT_TdS center>{b.driver_id_padron ? '✅' : '🚨'}</VBT_TdS>
                <VBT_TdS mono small>{b.status_padron || '—'}</VBT_TdS>
                <VBT_TdS center>
                  {b.apariciones_historial > 1 ? (
                    <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>{b.apariciones_historial}×</span>
                  ) : <span style={{ color: VBT_LIGHT, fontSize: 10 }}>1</span>}
                </VBT_TdS>
              </tr>
            ))}
            {bt.length === 0 && (<tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: VBT_LIGHT, fontSize: 12 }}>Sin resultados con esos filtros</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistorialPersonaModal({ curp, onClose }) {
  const [historial, setHistorial] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await sb.from('vw_bt_historial_por_persona').select('*').eq('curp', curp).order('pos_temporal', { ascending: true });
        if (error) throw error;
        if (alive) setHistorial(data || []);
      } catch (e) { if (alive) setError(e.message || 'Error'); } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [curp]);

  const persona = historial[0] || {};
  const empresasUnicas = [...new Set(historial.map(h => h.empresa).filter(Boolean))];
  const cargosUnicos = [...new Set(historial.map(h => h.cargo).filter(Boolean))];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, minWidth: 720, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto', fontFamily: "'Geist', sans-serif" }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: VBT_NAVY, marginBottom: 4 }}>{persona.nombre || 'Historial de la persona'}</div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: VBT_MUTED }}>CURP: {curp}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: VBT_MUTED }}>✕</button>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: VBT_MUTED, fontSize: 13 }}>Cargando historial…</div>}
        {error && <div style={{ padding: 20, background: '#fef2f2', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>{error}</div>}

        {!loading && !error && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10, border: `0.5px solid ${VBT_BORDER}` }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: VBT_MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>Apariciones</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: VBT_NAVY, marginTop: 4 }}>{historial.length}</div>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10, border: `0.5px solid ${VBT_BORDER}` }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: VBT_MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>Empresas</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: VBT_NAVY, marginTop: 4 }}>{empresasUnicas.length}</div>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10, border: `0.5px solid ${VBT_BORDER}` }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: VBT_MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>Cargos</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: VBT_TEXT, marginTop: 4 }}>{cargosUnicos.join(' / ') || '—'}</div>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10, border: `0.5px solid ${VBT_BORDER}` }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: VBT_MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>SC actual</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: VBT_NAVY, fontFamily: 'monospace', marginTop: 4 }}>{persona.svc || '—'}</div>
              </div>
            </div>

            {empresasUnicas.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: VBT_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Empresas por las que pasó</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {empresasUnicas.map((e, i) => (
                    <span key={i} style={{ background: i === 0 ? VBT_NAVY : '#f1f5f9', color: i === 0 ? '#fff' : VBT_TEXT, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6 }}>
                      {i === 0 && '★ '}{e}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: VBT_LIGHT, marginTop: 4 }}>★ = empresa actual</div>
              </div>
            )}

            <div style={{ fontSize: 10, fontWeight: 700, color: VBT_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Historial completo · {historial.length} apariciones (más reciente arriba)</div>
            <div style={{ background: VBT_CARD, borderRadius: 10, border: `0.5px solid ${VBT_BORDER}`, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <VBT_ThS>#</VBT_ThS><VBT_ThS>Cargo</VBT_ThS><VBT_ThS>Empresa</VBT_ThS><VBT_ThS>SC</VBT_ThS>
                    <VBT_ThS>Respuesta MELI</VBT_ThS><VBT_ThS>H. Respuesta</VBT_ThS><VBT_ThS>F. Llegada</VBT_ThS><VBT_ThS>Validación BT</VBT_ThS>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((h, i) => (
                    <tr key={i} style={{ borderBottom: '0.5px solid #f4f5f7', background: h.es_actual ? '#eff6ff' : '#fff' }}>
                      <VBT_TdS center bold>{h.es_actual ? '★' : h.pos_temporal}</VBT_TdS>
                      <VBT_TdS>{h.cargo || '—'}</VBT_TdS>
                      <VBT_TdS bold={h.es_actual}>{h.empresa || '—'}</VBT_TdS>
                      <VBT_TdS mono>{h.svc || '—'}</VBT_TdS>
                      <VBT_TdS>
                        <VBT_Pill type={h.respuesta_meli === 'RECHAZADO' ? 'red' : h.respuesta_meli === 'PENDIENTE' ? 'yellow' : h.respuesta_meli === 'APROBADO' ? 'green' : 'gray'}>
                          {h.respuesta_meli || '—'}
                        </VBT_Pill>
                      </VBT_TdS>
                      <VBT_TdS mono small>{h.h_respuesta_meli ? new Date(h.h_respuesta_meli).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</VBT_TdS>
                      <VBT_TdS mono small>{h.f_llegada ? new Date(h.f_llegada).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</VBT_TdS>
                      <VBT_TdS>
                        {h.validacion_bt ? <VBT_Pill type={h.validacion_bt === 'RECHAZADO' ? 'red' : 'yellow'}>{h.validacion_bt}</VBT_Pill> : <span style={{ color: VBT_LIGHT }}>—</span>}
                      </VBT_TdS>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 12, fontSize: 10, color: VBT_LIGHT, fontStyle: 'italic' }}>★ = fila actual (la más reciente por H. Respuesta MELI)</div>
          </>
        )}
      </div>
    </div>
  );
}

function UploadExcelBT({ onClose }) {
  const [status, setStatus] = useState('idle');
  const [msg, setMsg] = useState('');
  const [count, setCount] = useState({ total: 0, ok: 0 });
  const [errores, setErrores] = useState([]);

  const handleFile = async (file) => {
    setStatus('parsing'); setMsg(`Leyendo ${file.name}...`); setErrores([]);
    try {
      if (!window.XLSX) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js";
          s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
        });
      }
      const XLSX = window.XLSX;
      if (!XLSX) { setStatus('error'); setMsg('No se pudo cargar SheetJS.'); return; }

      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array', cellDates: true });
      let sheetName = wb.SheetNames.includes('DATOS') ? 'DATOS' : wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { raw: false, defval: null });
      if (rows.length === 0) { setStatus('error'); setMsg('El archivo no tiene filas'); return; }

      setStatus('uploading'); setMsg(`Procesando ${rows.length} filas...`); setCount({ total: rows.length, ok: 0 });

      const cleanSvc = (v) => v ? String(v).replace(/^ML_MX_/, '').trim() : null;
      const toDate = (v) => {
        if (!v) return null;
        if (v instanceof Date) {
          if (isNaN(v.getTime())) return null;
          const y = v.getFullYear(); if (y < 2020 || y > 2100) return null;
          return v.toISOString();
        }
        const s = String(v).trim();
        if (/\d{5,}/.test(s)) return null;
        const d = new Date(s); if (isNaN(d.getTime())) return null;
        const y = d.getFullYear(); if (y < 2020 || y > 2100) return null;
        return d.toISOString();
      };

      const allRows = rows.filter(r => r.CURP && String(r.CURP).trim()).map(r => ({
        curp: String(r.CURP).trim().toUpperCase(),
        nombre: r.Nombres || r.nombres || r.nombre || '',
        cargo: r.CARGO || null, empresa: r.EMPRESA || null, svc: cleanSvc(r.SVC),
        f_llegada: toDate(r['F. LLEGADA']), enviado_meli: toDate(r['ENVIADO MELI']),
        respuesta_meli: r['RESPUESTA MELI'] || null, h_respuesta_meli: toDate(r['H. RESPUESTA MELI']),
        validacion_bt: r['VALIDACION BIGTICKET'] || null, aviso_transporte: toDate(r['AVISO A TRANSPORTE']),
        rfc: r.RFC || null, lc: r['L.C'] || null, ine: r.INE || null,
        email: r.Email || null, telefono: r['Teléfono'] || r['Telefono'] || null, idv: r.IDV || null,
        raw_json: r,
      }));

      const sortKey = (x) => {
        const t1 = x.h_respuesta_meli ? new Date(x.h_respuesta_meli).getTime() : 0;
        const t2 = x.f_llegada ? new Date(x.f_llegada).getTime() : 0;
        return t1 || t2 || 0;
      };
      const ordenadas = [...allRows].sort((a, b) => sortKey(b) - sortKey(a));
      const seenCurp = new Set();
      const rowsPrincipal = [];
      for (const r of ordenadas) {
        if (!seenCurp.has(r.curp)) { seenCurp.add(r.curp); rowsPrincipal.push(r); }
      }

      setMsg(`Subiendo ${rowsPrincipal.length} CURPs únicos a tabla principal...`);
      const batchSize = 50;
      let ok = 0; const errs = [];
      for (let i = 0; i < rowsPrincipal.length; i += batchSize) {
        const batch = rowsPrincipal.slice(i, i + batchSize);
        const { error } = await sb.from('bt_tripulaciones').upsert(batch, { onConflict: 'curp' });
        if (error) errs.push(`Principal batch ${i}: ${error.message}`); else ok += batch.length;
        setCount({ total: rowsPrincipal.length, ok });
        setMsg(`Tabla principal: ${ok}/${rowsPrincipal.length}...`);
      }

      setMsg(`Subiendo ${allRows.length} filas al historial...`);
      const batchId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      let okHist = 0;
      for (let i = 0; i < allRows.length; i += batchSize) {
        const batch = allRows.slice(i, i + batchSize).map(r => ({ ...r, upload_batch_id: batchId }));
        const { error } = await sb.from('bt_tripulaciones_historial').upsert(batch, { onConflict: 'curp,empresa,respuesta_meli,h_respuesta_meli', ignoreDuplicates: true });
        if (error) errs.push(`Historial batch ${i}: ${error.message}`); else okHist += batch.length;
        setMsg(`Historial: ${okHist}/${allRows.length}...`);
      }

      setCount({ total: rowsPrincipal.length, ok });
      setErrores(errs);
      setStatus(errs.length > 0 ? 'error' : 'done');
      setMsg(errs.length > 0
        ? `Cargado con errores: principal ${ok}/${rowsPrincipal.length} · historial ${okHist}/${allRows.length}`
        : `✅ ${ok} CURPs únicos cargados · ${okHist} filas en historial`);
    } catch (e) { setStatus('error'); setMsg('Error: ' + (e.message || e)); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={status === 'idle' || status === 'done' || status === 'error' ? onClose : undefined}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, minWidth: 500, maxWidth: 600, fontFamily: "'Geist', sans-serif" }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: VBT_NAVY }}>Subir BBDD BT</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: VBT_MUTED }}>✕</button>
        </div>

        {status === 'idle' && (<>
          <div style={{ fontSize: 12, color: VBT_MUTED, marginBottom: 14, lineHeight: 1.6 }}>
            Arrastrá o seleccioná el archivo <strong>VALIDACION_TRIPULACIONES_MELI_MX.xlsx</strong>.<br/>
            Hace UPSERT por CURP y guarda todo el historial.
          </div>
          <label style={{ display: 'block', padding: 30, border: `2px dashed ${VBT_BORDER}`, borderRadius: 12, textAlign: 'center', cursor: 'pointer', background: '#f8fafc' }}>
            <i className="ti ti-cloud-upload" style={{ fontSize: 32, color: VBT_NAVY, display: 'block', marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: VBT_NAVY }}>Click para seleccionar archivo</div>
            <div style={{ fontSize: 11, color: VBT_MUTED, marginTop: 4 }}>.xlsx</div>
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
          </label>
        </>)}

        {(status === 'parsing' || status === 'uploading') && (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <i className="ti ti-loader-2" style={{ fontSize: 32, color: VBT_NAVY, display: 'inline-block' }} />
            <div style={{ fontSize: 13, color: VBT_TEXT, marginTop: 12 }}>{msg}</div>
            {count.total > 0 && (
              <div style={{ marginTop: 10, height: 8, background: VBT_BORDER, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${100*count.ok/count.total}%`, height: '100%', background: VBT_NAVY, transition: 'width .3s' }} />
              </div>
            )}
          </div>
        )}

        {status === 'done' && (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <i className="ti ti-circle-check" style={{ fontSize: 40, color: VBT_GREEN }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: VBT_TEXT, marginTop: 8 }}>{msg}</div>
            <button onClick={onClose} style={{ marginTop: 14, fontSize: 12, fontWeight: 600, padding: '8px 18px', borderRadius: 6, border: 'none', background: VBT_NAVY, color: '#fff', cursor: 'pointer', fontFamily: "'Geist', sans-serif" }}>Cerrar y refrescar</button>
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: 20 }}>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>{msg}</div>
              {errores.length > 0 && (<div style={{ fontSize: 11, color: '#7f1d1d', marginTop: 6, maxHeight: 100, overflowY: 'auto' }}>{errores.map((e, i) => <div key={i}>{e}</div>)}</div>)}
            </div>
            <button onClick={() => { setStatus('idle'); setMsg(''); setErrores([]); }} style={{ fontSize: 12, fontWeight: 600, padding: '8px 18px', borderRadius: 6, border: `1px solid ${VBT_BORDER}`, background: VBT_CARD, color: VBT_TEXT, cursor: 'pointer', fontFamily: "'Geist', sans-serif" }}>Reintentar</button>
          </div>
        )}
      </div>
    </div>
  );
}

function VBT_KPI({ l, v, s, accent, info, onClick }) {
  const [hovered, setHovered] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const clickable = typeof onClick === 'function';
  return (
    <div
      onClick={clickable ? onClick : undefined}
      onMouseEnter={() => clickable && setHovered(true)}
      onMouseLeave={() => clickable && setHovered(false)}
      style={{
        background: VBT_CARD,
        borderRadius: 12,
        border: clickable && hovered ? `1px solid ${accent || VBT_NAVY}` : `0.5px solid ${VBT_BORDER}`,
        padding: 14,
        cursor: clickable ? 'pointer' : 'default',
        position: 'relative',
        transition: 'all 120ms ease',
        boxShadow: clickable && hovered ? `0 2px 8px ${accent ? accent + '22' : 'rgba(0,0,0,0.05)'}` : 'none',
        transform: clickable && hovered ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: VBT_MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>{l}</div>
        {info && (
          <div
            onMouseEnter={(e) => { e.stopPropagation(); setTooltipOpen(true); }}
            onMouseLeave={(e) => { e.stopPropagation(); setTooltipOpen(false); }}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', border: `1px solid ${VBT_BORDER}`, color: VBT_MUTED, fontSize: 10, fontWeight: 700, cursor: 'help', fontFamily: 'serif', fontStyle: 'italic', lineHeight: 1, background: '#f8fafc' }}
          >
            i
            {tooltipOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: -4, width: 260, background: '#1a1a1a', color: '#fff', fontSize: 11, lineHeight: 1.5, padding: '10px 12px', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 50, fontWeight: 400, fontFamily: "'Geist', sans-serif", textTransform: 'none', letterSpacing: 0, fontStyle: 'normal' }}>
                <div style={{ position: 'absolute', top: -4, right: 8, width: 8, height: 8, background: '#1a1a1a', transform: 'rotate(45deg)' }} />
                {info}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent || VBT_TEXT, letterSpacing: -0.5, lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: 11, color: VBT_LIGHT, marginTop: 6 }}>{s}</div>
      {clickable && (
        <div style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 9, fontWeight: 600, color: accent || VBT_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, opacity: hovered ? 1 : 0.45, transition: 'opacity 120ms' }}>
          Ver detalle →
        </div>
      )}
    </div>
  );
}

function VBT_ThS({ children }) {
  return <th style={{ padding: '8px 10px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: VBT_MUTED, textAlign: 'left', borderBottom: `1px solid ${VBT_BORDER}`, background: '#f8fafc', whiteSpace: 'nowrap' }}>{children}</th>;
}

function VBT_TdS({ children, bold, muted, mono, center, strong, small }) {
  return <td style={{ padding: '8px 10px', fontSize: small ? 11 : 12, fontFamily: mono ? 'monospace' : "'Geist', sans-serif", color: muted ? VBT_MUTED : strong ? VBT_NAVY : VBT_TEXT, fontWeight: bold || strong ? 600 : 'normal', textAlign: center ? 'center' : 'left' }}>{children}</td>;
}

function VBT_Pill({ children, type }) {
  const c = type === 'red' ? { bg: '#fee2e2', col: '#991b1b' }
    : type === 'yellow' ? { bg: '#fef3c7', col: '#92400e' }
    : type === 'blue' ? { bg: '#dbeafe', col: '#1e40af' }
    : type === 'green' ? { bg: '#d1fae5', col: '#065f46' }
    : { bg: '#f1f5f9', col: '#475569' };
  return <span style={{ background: c.bg, color: c.col, fontSize: 9.5, fontWeight: 700, padding: '3px 8px', borderRadius: 5, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>{children}</span>;
}

function MultiDriverIdModal({ data, sinBt, onClose, onSelectCurp }) {
  const [showSinBt, setShowSinBt] = useState(false);
  const totalCriticos = (data || []).filter(d => d.es_critico).length;

  const exportarCSV = () => {
    const headers = ['CURP','Nombre BT','Empresa BT','SVC','Cargo','Respuesta MELI','Validación BT','# IDs','driver_ids','Nombres MELI','Carriers'];
    const rows = (data || []).map(d => [
      d.curp, d.nombre_bt, d.empresa_bt, d.svc, d.cargo,
      d.respuesta_meli, d.validacion_bt, d.cantidad_driver_ids,
      d.driver_ids, d.nombres_meli, d.carriers
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `multi_driver_id_bt_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'Geist', sans-serif" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 1100, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${VBT_BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(135deg, #f8f7ff 0%, #fff 100%)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: VBT_NAVY, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} />
              Personas con múltiples driver_id en MELI
            </div>
            <div style={{ fontSize: 11.5, color: VBT_MUTED }}>
              {(data || []).length} {((data || []).length === 1) ? 'persona' : 'personas'} en BT con 2+ driver_id activos en el padrón
              {totalCriticos > 0 && <span style={{ color: '#991b1b', fontWeight: 600 }}> · {totalCriticos} con alerta BT</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(data || []).length > 0 && (
              <button onClick={exportarCSV} style={{ fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 6, border: `1px solid ${VBT_BORDER}`, background: '#fff', color: VBT_NAVY, cursor: 'pointer', fontFamily: "'Geist', sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <i className="ti ti-download" style={{ fontSize: 13 }} />
                Exportar CSV
              </button>
            )}
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 20, color: VBT_MUTED, padding: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        </div>

        {/* Cuerpo */}
        <div style={{ overflowY: 'auto', flex: 1, padding: 20 }}>
          {/* Tabla principal */}
          {(!data || data.length === 0) ? (
            <div style={{ padding: 40, textAlign: 'center', color: VBT_LIGHT, fontSize: 13 }}>
              No hay personas BT con múltiples driver_id en este momento.
            </div>
          ) : (
            <div style={{ border: `0.5px solid ${VBT_BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <VBT_ThS>Estado</VBT_ThS>
                    <VBT_ThS>Nombre BT</VBT_ThS>
                    <VBT_ThS>CURP</VBT_ThS>
                    <VBT_ThS>Empresa BT</VBT_ThS>
                    <VBT_ThS>SVC</VBT_ThS>
                    <VBT_ThS>Respuesta MELI</VBT_ThS>
                    <VBT_ThS># IDs</VBT_ThS>
                    <VBT_ThS>driver_ids</VBT_ThS>
                    <VBT_ThS>Carriers</VBT_ThS>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d, i) => (
                    <tr key={d.curp || i}
                      onClick={() => onSelectCurp && onSelectCurp(d.curp)}
                      style={{
                        borderBottom: '0.5px solid #f4f5f7',
                        background: d.es_critico ? '#fef2f2' : 'transparent',
                        cursor: onSelectCurp ? 'pointer' : 'default'
                      }}
                      onMouseEnter={(e) => { if (onSelectCurp) e.currentTarget.style.background = d.es_critico ? '#fee2e2' : '#f8fafc'; }}
                      onMouseLeave={(e) => { if (onSelectCurp) e.currentTarget.style.background = d.es_critico ? '#fef2f2' : 'transparent'; }}
                    >
                      <VBT_TdS>
                        {d.es_critico ? (
                          <VBT_Pill type="red">{d.respuesta_meli || 'CRÍTICO'}</VBT_Pill>
                        ) : (
                          <VBT_Pill type="gray">OK</VBT_Pill>
                        )}
                      </VBT_TdS>
                      <VBT_TdS bold>{d.nombre_bt || '—'}</VBT_TdS>
                      <VBT_TdS mono small>{d.curp}</VBT_TdS>
                      <VBT_TdS muted small>{d.empresa_bt || '—'}</VBT_TdS>
                      <VBT_TdS mono>{d.svc || '—'}</VBT_TdS>
                      <VBT_TdS>
                        {d.respuesta_meli === 'RECHAZADO' ? <VBT_Pill type="red">RECHAZADO</VBT_Pill>
                          : d.respuesta_meli === 'PENDIENTE' ? <VBT_Pill type="yellow">PENDIENTE</VBT_Pill>
                          : d.respuesta_meli === 'APROBADO' ? <VBT_Pill type="green">APROBADO</VBT_Pill>
                          : (d.respuesta_meli || '—')}
                      </VBT_TdS>
                      <VBT_TdS center strong>
                        <span style={{ background: '#eef2ff', color: '#4338ca', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                          {d.cantidad_driver_ids}
                        </span>
                      </VBT_TdS>
                      <VBT_TdS mono small>{d.driver_ids}</VBT_TdS>
                      <VBT_TdS mono small muted>{d.carriers}</VBT_TdS>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tip */}
          {data && data.length > 0 && onSelectCurp && (
            <div style={{ marginTop: 10, fontSize: 11, color: VBT_LIGHT, fontStyle: 'italic' }}>
              Click en una fila para ver el historial completo de la persona.
            </div>
          )}

          {/* Sección secundaria: multi-ID sin BT */}
          {sinBt && sinBt.length > 0 && (
            <div style={{ marginTop: 20, padding: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setShowSinBt(!showSinBt)}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#92400e', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className="ti ti-alert-circle" style={{ fontSize: 14 }} />
                    Además, {sinBt.length} {sinBt.length === 1 ? 'persona' : 'personas'} con multi-driver_id en MELI no están cargadas en BT
                  </div>
                  <div style={{ fontSize: 11, color: '#92400e', opacity: 0.85 }}>
                    Estos casos no fueron validados por BT pero existen como múltiples perfiles en el padrón MELI. Revisar con la carrier correspondiente.
                  </div>
                </div>
                <i className={`ti ti-chevron-${showSinBt ? 'up' : 'down'}`} style={{ fontSize: 16, color: '#92400e' }} />
              </div>
              {showSinBt && (
                <div style={{ marginTop: 12, background: '#fff', border: `0.5px solid ${VBT_BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead>
                      <tr>
                        <VBT_ThS>CURP</VBT_ThS>
                        <VBT_ThS>Nombres MELI</VBT_ThS>
                        <VBT_ThS># IDs</VBT_ThS>
                        <VBT_ThS>driver_ids</VBT_ThS>
                        <VBT_ThS>Carriers</VBT_ThS>
                      </tr>
                    </thead>
                    <tbody>
                      {sinBt.map((p, i) => (
                        <tr key={p.curp || i} style={{ borderBottom: '0.5px solid #f4f5f7' }}>
                          <VBT_TdS mono small>{p.curp}</VBT_TdS>
                          <VBT_TdS bold small>{p.nombres_meli}</VBT_TdS>
                          <VBT_TdS center strong>
                            <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                              {p.cantidad_driver_ids}
                            </span>
                          </VBT_TdS>
                          <VBT_TdS mono small>{p.driver_ids}</VBT_TdS>
                          <VBT_TdS mono small muted>{p.carriers}</VBT_TdS>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MeliModal({ modal, onClose }) {
  const [busqueda, setBusqueda] = useState("");
  const filas = modal.filas || [];
  const columnas = modal.columnas || (filas[0] ? Object.keys(filas[0]) : []);

  const filtradas = useMemo(() => {
    let res = filas;
    if (modal.filtros) {
      Object.entries(modal.filtros).forEach(([col, valores]) => {
        if (valores && valores.length > 0) {
          res = res.filter(r => valores.includes(r[col]));
        }
      });
    }
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase().trim();
      res = res.filter(row =>
        columnas.some(c => {
          const val = row[c];
          if (val == null) return false;
          return String(val).toLowerCase().includes(q);
        })
      );
    }
    return res;
  }, [busqueda, filas, columnas, modal.filtros]);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(15,23,42,0.55)", zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 1200,
          maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #e4e7ec",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a6b" }}>{modal.titulo}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              {filtradas.length} {filtradas.length === 1 ? "registro" : "registros"}
              {(busqueda || modal.filtros) && ` (de ${filas.length} totales)`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="text" placeholder="Buscar..." value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              style={{ width: 240, padding: "7px 10px", border: "1px solid #d0d5dd",
                borderRadius: 6, fontSize: 12, fontFamily: "'Geist', sans-serif" }} />
            <button onClick={() => descargarExcelMeli(filtradas, modal.nombreArchivo || "export_meli", modal.titulo.slice(0, 31))}
              className="btn-orange" style={{ padding: "7px 12px", fontSize: 12 }}>
              Descargar Excel
            </button>
            <button onClick={onClose}
              style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer",
                color: "#64748b", padding: "0 4px", lineHeight: 1 }}>×</button>
          </div>
        </div>

        {modal.filtros_ui && (
          <div style={{ padding: "10px 20px", background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
            {modal.filtros_ui}
          </div>
        )}

        <div style={{ flex: 1, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 1 }}>
              <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                {columnas.map(c => (
                  <th key={c} style={{ textAlign: "left", padding: "8px 12px",
                    fontSize: 10, fontWeight: 700, color: "#475569",
                    textTransform: "uppercase", letterSpacing: 0.5,
                    whiteSpace: "nowrap" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr><td colSpan={columnas.length} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>
                  Sin resultados
                </td></tr>
              )}
              {filtradas.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  {columnas.map(c => (
                    <td key={c} style={{ padding: "7px 12px", color: "#1a1a1a", whiteSpace: "nowrap" }}>
                      {row[c] === null || row[c] === undefined ? "—"
                        : typeof row[c] === "boolean" ? (row[c] ? "Sí" : "No")
                        : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PoolMeliKpi({ label, value, sublabel, color = "#1a3a6b", danger = false, warn = false, onClick = null }) {
  const bg = danger ? "#fef2f2" : warn ? "#fffbeb" : "#fff";
  const border = danger ? "#fecaca" : warn ? "#fde68a" : "#e4e7ec";
  const valColor = danger ? "#991b1b" : warn ? "#92400e" : color;
  const clickable = !!onClick;
  return (
    <div onClick={onClick}
      style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: 16,
        cursor: clickable ? "pointer" : "default", transition: "all 0.15s",
        ...(clickable ? { boxShadow: "0 1px 2px rgba(0,0,0,0.03)" } : {}) }}
      onMouseEnter={e => clickable && (e.currentTarget.style.boxShadow = "0 4px 12px rgba(26,58,107,0.12)")}
      onMouseLeave={e => clickable && (e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.03)")}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, fontWeight: 600,
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{label}</span>
        {clickable && <span style={{ fontSize: 9, color: "#94a3b8" }}>VER →</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: valColor, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      {sublabel && <div style={{ fontSize: 11, color: "#94a3b8" }}>{sublabel}</div>}
    </div>
  );
}

// ── Actualizar desde MELI: dispara el scrape via webhook n8n (proxy seguro) ──
// El webhook lee las cookies vigentes de sesiones_meli, dispara el scraper en
// el VPS y espera a que termine. El token va en header para que el webhook no
// quede publico. Si lo rotas, cambialo aca y en el nodo IF del workflow n8n.
const N8N_REFRESH_URL = "https://bigticket2026.app.n8n.cloud/webhook/refrescar-compromiso-meli";
const N8N_REFRESH_TOKEN = "bt_meli_r3fr3sh_9f4c2a7e8b1d6350";

function PoolMeliCompromiso() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [excelDesde, setExcelDesde] = useState(fechaOperativaOffset(-7));
  const [excelHasta, setExcelHasta] = useState(fechaHoyOperativa());
  const [excelHistBusy, setExcelHistBusy] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState(null);
  const [fechaVista, setFechaVista] = useState(""); // "" = operativa de mañana (vivo); YYYY-MM-DD = histórico
  const [recalc, setRecalc] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (fechaVista) {
          // Histórico: usa payload si existe; si no (filas viejas del job diario), reconstruye desde columnas
          const { data: rows, error: err } = await sb
            .from("compromiso_meli_historico")
            .select("payload, rankings, fecha_operativa, generado_en, capturado_en, ofrecidas_sdd, ofrecidas_spot, aceptadas_sdd, aceptadas_spot, rechazadas_sdd, rechazadas_spot, canceladas_sdd, canceladas_spot, pendientes_sdd, pendientes_spot")
            .eq("fecha_operativa", fechaVista)
            .limit(1);
          if (!alive) return;
          if (err) throw err;
          if (!rows || rows.length === 0) {
            setData(null);
            setError(`No hay snapshot guardado para ${fechaVista}. La foto histórica se guarda a diario; probá otra fecha.`);
          } else {
            const row = rows[0];
            let foto = row.payload;
            if (!foto) {
              const rk = row.rankings || {};
              foto = {
                fecha_manana: row.fecha_operativa,
                generado_en: row.generado_en || row.capturado_en,
                conteos: {
                  ofrecidas_sdd: row.ofrecidas_sdd || 0, ofrecidas_spot: row.ofrecidas_spot || 0,
                  aceptadas_sdd: row.aceptadas_sdd || 0, aceptadas_spot: row.aceptadas_spot || 0,
                  rechazadas_sdd: row.rechazadas_sdd || 0, rechazadas_spot: row.rechazadas_spot || 0,
                  canceladas_sdd: row.canceladas_sdd || 0, canceladas_spot: row.canceladas_spot || 0,
                  pendientes_sdd: row.pendientes_sdd || 0, pendientes_spot: row.pendientes_spot || 0,
                },
                ranking_sdd_aceptadas: rk.sdd_aceptadas || [],
                ranking_sdd_rechazadas: rk.sdd_rechazadas || [],
                ranking_spot_aceptadas: rk.spot_aceptadas || [],
                ranking_spot_rechazadas: rk.spot_rechazadas || [],
              };
            }
            setData(foto);
          }
        } else {
          const { data: result, error: err } = await sb.rpc("get_compromiso_meli_manana");
          if (!alive) return;
          if (err) throw err;
          setData(result);
        }
      } catch (e) {
        if (alive) { setData(null); setError(e.message || String(e)); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, fechaVista]);

  const actualizarDesdeMeli = async () => {
    setScraping(true);
    setScrapeMsg(null);
    try {
      const resp = await fetch(N8N_REFRESH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-brain-token": N8N_REFRESH_TOKEN },
        body: JSON.stringify({ origen: "compromiso-meli" }),
      });
      let j = null;
      try { j = await resp.json(); } catch (_) { j = null; }
      if (j && j.ok) {
        setScrapeMsg({ tipo: "ok", texto: j.mensaje || "Datos actualizados desde MELI." });
        setRefreshKey(k => k + 1);
      } else {
        setScrapeMsg({ tipo: "err", texto: (j && (j.mensaje || j.error)) || ("No se pudo actualizar (HTTP " + resp.status + ").") });
      }
    } catch (e) {
      setScrapeMsg({ tipo: "err", texto: "Error de red al contactar el actualizador: " + (e.message || String(e)) });
    } finally {
      setScraping(false);
    }
  };

  const recalcularDia = async () => {
    if (!fechaVista) return;
    setRecalc(true);
    setScrapeMsg(null);
    try {
      const { data: result, error: err } = await sb.rpc("recalcular_y_guardar_compromiso", { p_fecha: fechaVista });
      if (err) throw err;
      if (!result) throw new Error("Sin datos para esa fecha en meli_travel_requests");
      setData(result);
      setScrapeMsg({ tipo: "ok", texto: "Recalculado y guardado desde el crudo de MELI para " + fechaVista + "." });
    } catch (e) {
      setScrapeMsg({ tipo: "err", texto: "No se pudo recalcular: " + (e.message || String(e)) });
    } finally {
      setRecalc(false);
    }
  };

  if (loading) {
    return <div className="pg" style={{ padding: 60, textAlign: "center", color: "#888" }}>Cargando compromiso…</div>;
  }
  if (error) {
    return (
      <div className="pg" style={{ padding: 40, color: "#c0392b" }}>
        Error: {error}
        {fechaVista && (
          <div style={{ marginTop: 16 }}>
            <button onClick={() => setFechaVista("")}
              style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #1a3a6b", background: "#1a3a6b", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Geist', sans-serif" }}>
              ← Volver a la operativa de mañana
            </button>
          </div>
        )}
      </div>
    );
  }
  if (!data) {
    return <div className="pg" style={{ padding: 40, color: "#888" }}>Sin datos</div>;
  }

  const c = data.conteos || {};
  const fechaManana = data.fecha_manana;
  const generadoEn = data.generado_en ? new Date(data.generado_en) : null;

  const ofrecidasTotal = (c.ofrecidas_sdd || 0) + (c.ofrecidas_spot || 0);
  const aceptadasTotal = (c.aceptadas_sdd || 0) + (c.aceptadas_spot || 0);
  const rechazadasTotal = (c.rechazadas_sdd || 0) + (c.rechazadas_spot || 0);
  const canceladasTotal = (c.canceladas_sdd || 0) + (c.canceladas_spot || 0);
  const pendientesTotal = (c.pendientes_sdd || 0) + (c.pendientes_spot || 0);

  const calcularCump = (acept, ofrec, canc) => {
    const efectivas = ofrec - canc;
    if (efectivas <= 0) return null;
    return (acept / efectivas) * 100;
  };
  const cumpTotal = calcularCump(aceptadasTotal, ofrecidasTotal, canceladasTotal);
  const cumpSdd = calcularCump(c.aceptadas_sdd || 0, c.ofrecidas_sdd || 0, c.canceladas_sdd || 0);
  const cumpSpot = calcularCump(c.aceptadas_spot || 0, c.ofrecidas_spot || 0, c.canceladas_spot || 0);
  const efectTotal = ofrecidasTotal - canceladasTotal;
  const efectSdd = (c.ofrecidas_sdd || 0) - (c.canceladas_sdd || 0);
  const efectSpot = (c.ofrecidas_spot || 0) - (c.canceladas_spot || 0);

  const colorPct = (pct) => {
    if (pct === null) return "#94a3b8";
    if (pct >= 95) return "#047857";
    if (pct >= 85) return "#0891b2";
    if (pct >= 70) return "#ca8a04";
    return "#b91c1c";
  };

  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const dias = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  let fechaTexto = fechaManana;
  if (fechaManana) {
    const [y, m, d] = fechaManana.split("-").map(Number);
    const fechaObj = new Date(y, m - 1, d);
    fechaTexto = `${dias[fechaObj.getDay()]} ${d} de ${meses[m - 1]} de ${y}`;
  }

  // Export Excel de la foto de compromiso (un día: la operativa de mañana). Incluye la fecha.
  const exportarExcel = async () => {
    const fmt = (x) => (x != null ? Number(x.toFixed(1)) : "—");
    const resumenSheet = [
      ["Reporte", "Compromiso MELI · Operativa de mañana"],
      ["Fecha operativa", fechaManana || ""],
      ["Generado", generadoEn ? generadoEn.toLocaleString("es-MX") : ""],
      [""],
      ["Métrica", "SDD", "SPOT", "Total"],
      ["Ofrecidas", c.ofrecidas_sdd || 0, c.ofrecidas_spot || 0, ofrecidasTotal],
      ["Para responder", c.pendientes_sdd || 0, c.pendientes_spot || 0, pendientesTotal],
      ["Aceptadas", c.aceptadas_sdd || 0, c.aceptadas_spot || 0, aceptadasTotal],
      ["Rechazadas", c.rechazadas_sdd || 0, c.rechazadas_spot || 0, rechazadasTotal],
      ["Canceladas MELI", c.canceladas_sdd || 0, c.canceladas_spot || 0, canceladasTotal],
      ["Efectivas (ofrec − canc)", efectSdd, efectSpot, efectTotal],
      ["% Cumplimiento", fmt(cumpSdd), fmt(cumpSpot), fmt(cumpTotal)],
    ];
    const rk = (titulo, arr) => {
      const rows = [[titulo], ["SC / Facility", "Cantidad"]];
      (arr || []).forEach(x => rows.push([x.facility_id || "", Number(x.cant) || 0]));
      return rows;
    };
    const rankingSheet = [
      ...rk("SDD · Más aceptadas", data.ranking_sdd_aceptadas), [""],
      ...rk("SDD · Más rechazadas", data.ranking_sdd_rechazadas), [""],
      ...rk("SPOT · Más aceptadas", data.ranking_spot_aceptadas), [""],
      ...rk("SPOT · Más rechazadas", data.ranking_spot_rechazadas),
    ];
    await descargarExcelMultihoja(
      [{ nombre: "Compromiso", datos: resumenSheet }, { nombre: "Rankings", datos: rankingSheet }],
      `compromiso_meli_${fechaManana || "manana"}`
    );
  };

  // Export Excel por RANGO desde la tabla histórica (se llena a diario con snapshot_compromiso_meli)
  const exportarHistorico = async () => {
    if (!excelDesde || !excelHasta) { alert("Elegí el rango de fechas."); return; }
    const desde = excelDesde <= excelHasta ? excelDesde : excelHasta;
    const hasta = excelHasta >= excelDesde ? excelHasta : excelDesde;
    setExcelHistBusy(true);
    try {
      const { data: hist, error: err } = await sb
        .from("compromiso_meli_historico")
        .select("*")
        .gte("fecha_operativa", desde).lte("fecha_operativa", hasta)
        .order("fecha_operativa")
        .limit(100000);
      if (err) throw err;
      const rows = hist || [];
      if (rows.length === 0) {
        alert("No hay histórico guardado en ese rango todavía. La tabla se llena a diario con snapshot_compromiso_meli().");
        setExcelHistBusy(false);
        return;
      }
      const cumpl = (acept, ofrec, canc) => {
        const ef = (ofrec || 0) - (canc || 0);
        return ef > 0 ? Number(((acept || 0) / ef * 100).toFixed(1)) : "";
      };
      const headers = [
        "FECHA OPERATIVA",
        "OFRECIDAS SDD", "ACEPTADAS SDD", "RECHAZADAS SDD", "CANCELADAS SDD", "% CUMPL SDD",
        "OFRECIDAS SPOT", "ACEPTADAS SPOT", "RECHAZADAS SPOT", "CANCELADAS SPOT", "% CUMPL SPOT",
        "OFRECIDAS TOTAL", "ACEPTADAS TOTAL", "% CUMPL TOTAL",
        "GENERADO EN",
      ];
      const datos = rows.map(r => {
        const ofrecT = (r.ofrecidas_sdd || 0) + (r.ofrecidas_spot || 0);
        const aceptT = (r.aceptadas_sdd || 0) + (r.aceptadas_spot || 0);
        const cancT  = (r.canceladas_sdd || 0) + (r.canceladas_spot || 0);
        return [
          r.fecha_operativa,
          r.ofrecidas_sdd || 0, r.aceptadas_sdd || 0, r.rechazadas_sdd || 0, r.canceladas_sdd || 0, cumpl(r.aceptadas_sdd, r.ofrecidas_sdd, r.canceladas_sdd),
          r.ofrecidas_spot || 0, r.aceptadas_spot || 0, r.rechazadas_spot || 0, r.canceladas_spot || 0, cumpl(r.aceptadas_spot, r.ofrecidas_spot, r.canceladas_spot),
          ofrecT, aceptT, cumpl(aceptT, ofrecT, cancT),
          r.generado_en ? new Date(r.generado_en).toLocaleString("es-MX") : "",
        ];
      });
      await descargarExcelMultihoja(
        [{ nombre: "Compromiso histórico", datos: [headers, ...datos] }],
        `compromiso_meli_${desde === hasta ? desde : desde + "_a_" + hasta}`
      );
    } catch (e) {
      alert("Error al generar el histórico: " + (e.message || e));
    } finally {
      setExcelHistBusy(false);
    }
  };

  return (
    <div className="pg">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="sec-title">Torre de Control Compromiso</div>
          <div className="sec-sub">
            {fechaVista ? "Histórico" : "Operativa de mañana"} · {fechaTexto}
            {generadoEn && (
              <span style={{ color: "#94a3b8", marginLeft: 8 }}>
                · datos al {generadoEn.toLocaleString("es-MX", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Excel · rango:</span>
          <input type="date" value={excelDesde} onChange={e => setExcelDesde(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid #e4e7ec", fontSize: 12, color: "#1a1a1a" }} />
          <span style={{ fontSize: 11, color: "#888" }}>a</span>
          <input type="date" value={excelHasta} onChange={e => setExcelHasta(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid #e4e7ec", fontSize: 12, color: "#1a1a1a" }} />
          <button onClick={exportarHistorico} disabled={excelHistBusy}
            style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid #16a34a", background: excelHistBusy ? "#9ca3af" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: excelHistBusy ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Geist', sans-serif" }}
            title="Excel por rango desde la tabla histórica (se llena a diario)"
          >{excelHistBusy ? "⏳ Generando..." : "📥 Descargar Excel"}</button>
          <button
            onClick={exportarExcel}
            style={{
              padding: "8px 14px", fontSize: 12, fontWeight: 600,
              background: "#fff", color: "#1a3a6b",
              border: "1px solid #e4e7ec", borderRadius: 6,
              cursor: "pointer", fontFamily: "'Geist', sans-serif",
              display: "flex", alignItems: "center", gap: 6,
            }}
            title="Excel de la foto de mañana (un día)"
          >⬇ Mañana</button>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            style={{
              padding: "8px 14px", fontSize: 12, fontWeight: 600,
              background: "#fff", color: "#1a3a6b",
              border: "1px solid #e4e7ec", borderRadius: 6,
              cursor: "pointer", fontFamily: "'Geist', sans-serif",
              display: "flex", alignItems: "center", gap: 6,
            }}
            title="Recargar datos"
          >↻ Refrescar</button>
          {!fechaVista && (
          <button
            onClick={actualizarDesdeMeli}
            disabled={scraping}
            style={{
              padding: "8px 14px", fontSize: 12, fontWeight: 700,
              background: scraping ? "#f0a875" : "#F47B20", color: "#fff",
              border: "1px solid #F47B20", borderRadius: 6,
              cursor: scraping ? "wait" : "pointer", fontFamily: "'Geist', sans-serif",
              display: "flex", alignItems: "center", gap: 6,
            }}
            title="Vuelve a scrapear MELI con las cookies vigentes y recarga (~30s)"
          >{scraping ? "⏳ Consultando MELI…" : "🔄 Actualizar desde MELI"}</button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "10px 14px", background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: 0.5 }}>Ver operativa de:</span>
        <input type="date" value={fechaVista} max={fechaHoyOperativa()} onChange={e => setFechaVista(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, color: "#1a1a1a", fontFamily: "'Geist', sans-serif" }} />
        {fechaVista ? (
          <>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#F47B20" }}>📅 Viendo histórico</span>
            <button onClick={() => setFechaVista("")}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #1a3a6b", background: "#1a3a6b", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Geist', sans-serif" }}>
              ← Volver a mañana (en vivo)
            </button>
            <button onClick={recalcularDia} disabled={recalc}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #F47B20", background: recalc ? "#f0a875" : "#F47B20", color: "#fff", fontSize: 12, fontWeight: 700, cursor: recalc ? "wait" : "pointer", fontFamily: "'Geist', sans-serif" }}
              title="Recalcula el total del día desde los datos crudos de MELI (meli_travel_requests)">
              {recalc ? "⏳ Recalculando…" : "🔁 Recalcular y guardar (crudo MELI)"}
            </button>
          </>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: "#047857" }}>🟢 Operativa de mañana (en vivo)</span>
        )}
      </div>

      {scrapeMsg && (
        <div style={{
          marginBottom: 16, padding: "10px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
          background: scrapeMsg.tipo === "ok" ? "#ecfdf5" : "#fef2f2",
          color: scrapeMsg.tipo === "ok" ? "#065f46" : "#991b1b",
          border: "1px solid " + (scrapeMsg.tipo === "ok" ? "#a7f3d0" : "#fecaca"),
        }}>{scrapeMsg.texto}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <div className="form-card" style={{
          marginBottom: 0,
          background: "linear-gradient(135deg, #1a3a6b 0%, #0f2647 100%)",
          color: "#fff", padding: 20,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.8, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            % Cumplimiento Total
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, marginBottom: 8 }}>
            {cumpTotal !== null ? `${cumpTotal.toFixed(1)}%` : "—"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6 }}>
            {aceptadasTotal} aceptadas / {efectTotal} efectivas
          </div>
          <div style={{ fontSize: 10, opacity: 0.7, lineHeight: 1.4 }}>
            Fórmula: Aceptadas ÷ (Ofrecidas − Canceladas MELI)
          </div>
        </div>

        <div className="form-card" style={{ marginBottom: 0, padding: 20, borderTop: `4px solid ${colorPct(cumpSdd)}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            % Cumplimiento SDD
            <span style={{ fontSize: 9, fontWeight: 600, color: "#94a3b8", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
              · Súper Dedicadas (flota fija)
            </span>
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, marginBottom: 8, color: colorPct(cumpSdd) }}>
            {cumpSdd !== null ? `${cumpSdd.toFixed(1)}%` : "—"}
          </div>
          <div style={{ fontSize: 12, color: "#334155", marginBottom: 6 }}>
            {c.aceptadas_sdd || 0} aceptadas / {efectSdd} efectivas
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
            Aceptadas ÷ (Ofrecidas − Canceladas MELI)
          </div>
        </div>

        <div className="form-card" style={{ marginBottom: 0, padding: 20, borderTop: `4px solid ${colorPct(cumpSpot)}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            % Cumplimiento SPOT
            <span style={{ fontSize: 9, fontWeight: 600, color: "#94a3b8", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
              · Variables (flota flexible)
            </span>
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, marginBottom: 8, color: colorPct(cumpSpot) }}>
            {cumpSpot !== null ? `${cumpSpot.toFixed(1)}%` : "—"}
          </div>
          <div style={{ fontSize: 12, color: "#334155", marginBottom: 6 }}>
            {c.aceptadas_spot || 0} aceptadas / {efectSpot} efectivas
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
            Aceptadas ÷ (Ofrecidas − Canceladas MELI)
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        <CompromisoTarjeta label="Ofrecidas" sublabel="Total por MELI" total={ofrecidasTotal} sdd={c.ofrecidas_sdd || 0} spot={c.ofrecidas_spot || 0} color="#1a3a6b" />
        <CompromisoTarjeta label="Para responder" sublabel="Pendientes" total={pendientesTotal} sdd={c.pendientes_sdd || 0} spot={c.pendientes_spot || 0} color="#ca8a04" />
        <CompromisoTarjeta label="Aceptadas" sublabel="Por nosotros" total={aceptadasTotal} sdd={c.aceptadas_sdd || 0} spot={c.aceptadas_spot || 0} color="#047857" />
        <CompromisoTarjeta label="Rechazadas" sublabel="Por nosotros" total={rechazadasTotal} sdd={c.rechazadas_sdd || 0} spot={c.rechazadas_spot || 0} color="#b91c1c" />
        <CompromisoTarjeta label="Canceladas" sublabel="Por MELI" total={canceladasTotal} sdd={c.canceladas_sdd || 0} spot={c.canceladas_spot || 0} color="#92400e" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="form-card" style={{ marginBottom: 0 }}>
          <div className="form-title" style={{ marginBottom: 4 }}>Ranking SDD por SC</div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>Top 5 · Súper Dedicadas (compromiso obligatorio)</div>
          <RankingBloque titulo="Más aceptadas" datos={data.ranking_sdd_aceptadas || []} color="#047857" />
          <div style={{ height: 12 }} />
          <RankingBloque titulo="Más rechazadas" datos={data.ranking_sdd_rechazadas || []} color="#b91c1c" emptyMsg="Sin rechazadas SDD" />
        </div>

        <div className="form-card" style={{ marginBottom: 0 }}>
          <div className="form-title" style={{ marginBottom: 4 }}>Ranking SPOT por SC</div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>Top 5 · Variables (flota flexible)</div>
          <RankingBloque titulo="Más aceptadas" datos={data.ranking_spot_aceptadas || []} color="#047857" />
          <div style={{ height: 12 }} />
          <RankingBloque titulo="Más rechazadas" datos={data.ranking_spot_rechazadas || []} color="#b91c1c" emptyMsg="Sin rechazadas SPOT" />
        </div>
      </div>
    </div>
  );
}

function CompromisoTarjeta({ label, sublabel, total, sdd, spot, color }) {
  return (
    <div className="form-card" style={{ marginBottom: 0, padding: 16, borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 8 }}>{sublabel}</div>
      <div style={{ fontSize: 36, fontWeight: 700, color, lineHeight: 1, marginBottom: 12, fontVariantNumeric: "tabular-nums" }}>{total}</div>
      <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#334155" }}>SDD</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>{sdd}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#334155" }}>SPOT</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>{spot}</span>
        </div>
      </div>
    </div>
  );
}

function RankingBloque({ titulo, datos, color, emptyMsg = "Sin datos" }) {
  if (!datos || datos.length === 0) {
    return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{titulo}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", padding: "8px 0" }}>{emptyMsg}</div>
      </div>
    );
  }
  const maxCant = Math.max(...datos.map(d => Number(d.cant) || 0));
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{titulo}</div>
      {datos.map((d, i) => {
        const pct = maxCant > 0 ? (Number(d.cant) / maxCant) * 100 : 0;
        return (
          <div key={d.facility_id} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
                <span style={{ color: "#cbd5e1", fontFamily: "monospace", marginRight: 6 }}>#{i + 1}</span>
                {d.facility_id}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{d.cant}</span>
            </div>
            <div style={{ height: 4, background: "#f1f5f9", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PoolMeliKPIOperacion() {
  const [data, setData] = useState(null);            // KPIs del día (comparativo)
  const [compromiso, setCompromiso] = useState(null); // Compromiso MELI (Confirmados/SDD/SPOT)
  const [historico, setHistorico] = useState([]);    // Array de filas por día (puede quedar vacío)
  const [rankingHistorico, setRankingHistorico] = useState([]); // Ranking promediado por SC del período
  const [pnrCasos, setPnrCasos] = useState([]);      // Casos PNR del período actual
  const [rutaToSc, setRutaToSc] = useState({});      // Mapeo id_ruta → service_center_id
  const [loading, setLoading] = useState(true);
  const [loadingRanking, setLoadingRanking] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [periodo, setPeriodo] = useState(1); // 1, 7, 15, 22 días

  // ═══ Fecha ancla (ayer en hora MX) ═══════════════════════════════════════
  const fechaAyer = useMemo(() => {
    const ayerMX = fechaOperativaOffset(-1); // helper global ya existente
    return ayerMX;
  }, []);

  // ═══ Carga de datos ══════════════════════════════════════════════════════
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Calcular ventana del histórico (máx 30 días desde fechaAyer hacia atrás)
        const fechaHasta = fechaAyer;
        const desde = new Date(fechaAyer);
        desde.setDate(desde.getDate() - 29); // 30 días incluyendo fechaAyer
        const fechaDesde = desde.toISOString().slice(0, 10);

        // 1) Obtener el período PNR más reciente (formato YYYY-MM por convención del módulo PNR)
        let periodoPnrActual = null;
        try {
          const { data: periodosPnr } = await sb.from("pnr_casos")
            .select("periodo")
            .not("periodo", "is", null)
            .order("periodo", { ascending: false })
            .limit(1);
          if (periodosPnr && periodosPnr.length > 0) {
            periodoPnrActual = periodosPnr[0].periodo;
          }
        } catch { /* sin datos PNR es OK */ }

        // 2) Llamadas en paralelo
        const calls = [
          sb.rpc("get_kpi_operacion_comparativo", { p_fecha: fechaAyer }),
          sb.rpc("get_compromiso_meli_manana"),
          sb.rpc("get_kpi_operacion_historico", { p_desde: fechaDesde, p_hasta: fechaHasta }),
          // Casos PNR del período actual
          periodoPnrActual
            ? sb.from("pnr_casos").select("*").eq("periodo", periodoPnrActual).order("fecha_caso", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          // Viajes del rango histórico para mapear id_ruta → service_center_id
          sb.from("viajes")
            .select("id_ruta, service_center_id")
            .eq("pais", "MX")
            .gte("fecha_salida", fechaDesde + "T00:00:00Z")
            .lte("fecha_salida", fechaHasta + "T23:59:59Z")
            .limit(10000),
        ];
        const [rKpi, rComp, rHist, rPnr, rViajes] = await Promise.all(calls);

        if (!alive) return;
        if (rKpi.error) throw rKpi.error;
        setData(rKpi.data);
        setCompromiso(rComp.error ? null : rComp.data);
        setHistorico(rHist.error ? [] : (Array.isArray(rHist.data) ? rHist.data : []));
        setPnrCasos(rPnr.error ? [] : (rPnr.data || []));

        // Construir mapa id_ruta → service_center_id (último valor gana)
        const mapa = {};
        (rViajes.data || []).forEach(v => {
          if (v.id_ruta != null && v.service_center_id) {
            mapa[String(v.id_ruta)] = v.service_center_id;
          }
        });
        setRutaToSc(mapa);
      } catch (e) {
        if (alive) setError(e.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, fechaAyer]);

  // ═══ Carga del ranking promediado del período (se ejecuta al cambiar período) ═══
  useEffect(() => {
    if (periodo === 1) {
      // En D-1 usamos el ranking del día (data.ranking_sc + visitados.por_sc)
      setRankingHistorico([]);
      return;
    }
    let alive = true;
    (async () => {
      setLoadingRanking(true);
      try {
        const fechaHasta = fechaAyer;
        const desde = new Date(fechaAyer);
        desde.setDate(desde.getDate() - (periodo - 1));
        const fechaDesde = desde.toISOString().slice(0, 10);

        const { data: rData, error: rErr } = await sb.rpc(
          "get_kpi_operacion_ranking_historico",
          { p_desde: fechaDesde, p_hasta: fechaHasta }
        );
        if (!alive) return;
        if (rErr) {
          // RPC no existe aún o falló → caemos al ranking del día
          setRankingHistorico([]);
        } else {
          setRankingHistorico(Array.isArray(rData) ? rData : []);
        }
      } catch {
        if (alive) setRankingHistorico([]);
      } finally {
        if (alive) setLoadingRanking(false);
      }
    })();
    return () => { alive = false; };
  }, [periodo, fechaAyer, refreshKey]);

  // ═══ Hooks (deben ir antes de cualquier early return) ════════════════════
  // Histórico filtrado al período activo.
  // En D-1 mostramos igual los últimos 7 días en el sparkline (con dot grande en el último)
  // pero el valor grande arriba sigue siendo del día actual.
  const histPeriodo = useMemo(() => {
    if (!historico || historico.length === 0) return [];
    const ventana = periodo === 1 ? 7 : periodo;
    return historico.slice(-ventana);
  }, [historico, periodo]);

  // Período anterior (para curva punteada de comparación)
  const histPrev = useMemo(() => {
    if (!historico || historico.length === 0) return [];
    const ventana = periodo === 1 ? 7 : periodo;
    const start = Math.max(0, historico.length - ventana * 2);
    const end = historico.length - ventana;
    return historico.slice(start, end);
  }, [historico, periodo]);

  // Ranking unificado: si hay ranking histórico (período > 1), usar ese; sino, ranking del día
  const rankingsDia = useMemo(() => {
    // Si hay ranking del período seleccionado, usarlo directamente
    if (rankingHistorico && rankingHistorico.length > 0) {
      return rankingHistorico.map(r => ({
        sc: r.sc,
        ns_pond: Number(r.ns_pond) || 0,
        rutas: Math.round(Number(r.rutas) || 0),
        cargados: Number(r.cargados) || 0,
        entregados: Number(r.entregados) || 0,
        devueltos: Number(r.devueltos) || 0,
        ambulancias: Number(r.ambulancias) || 0,
        pct_visitados: r.pct_visitados != null ? Number(r.pct_visitados) : null,
        no_visitados: Number(r.no_visitados) || 0,
      }));
    }
    // Fallback: ranking del día (data.ranking_sc + visitados.por_sc)
    if (!data) return [];
    const ranking = data.ranking_sc || [];
    const visPorSc = data.visitados?.por_sc || [];
    const m = {};
    ranking.forEach(r => {
      m[r.sc] = {
        sc: r.sc,
        ns_pond: Number(r.ns_pond) || 0,
        rutas: Number(r.rutas) || 0,
        cargados: Number(r.cargados) || 0,
        entregados: Number(r.entregados) || 0,
        devueltos: Number(r.devueltos) || 0,
        ambulancias: Number(r.ambulancias) || 0,
        pct_visitados: null,
        no_visitados: 0,
      };
    });
    visPorSc.forEach(v => {
      if (!m[v.sc]) m[v.sc] = { sc: v.sc, ns_pond: 0, rutas: 0, cargados: 0, entregados: 0, devueltos: 0, ambulancias: 0 };
      m[v.sc].pct_visitados = Number(v.pct_visitados) || 0;
      m[v.sc].no_visitados = Number(v.no_visitados) || 0;
      if (!m[v.sc].cargados) m[v.sc].cargados = Number(v.cargados) || 0;
    });
    return Object.values(m);
  }, [data, rankingHistorico]);

  // ═══ Procesamiento de casos PNR ══════════════════════════════════════════
  // Clasificación de estados:
  //   ABIERTOS  = "Esperando comprobante" + "Comprobante cargado" + "Pendiente de revision" + "Sin comprobante cargado"
  //   A_COBRO   = "Con penalidad"
  //   CERRADOS  = "Anulado"
  const pnrStats = useMemo(() => {
    const ESTADOS_ABIERTOS = ["Esperando comprobante", "Comprobante cargado", "Pendiente de revision", "Sin comprobante cargado"];
    const ESTADO_COBRO = "Con penalidad";
    const ESTADO_CERRADO = "Anulado";

    const total = pnrCasos.length;
    let abiertos = 0, aCobro = 0, cerrados = 0;
    let valorAbiertos = 0, valorACobro = 0, valorTotal = 0;
    const desglose = {
      "Esperando comprobante": 0,
      "Comprobante cargado": 0,
      "Pendiente de revision": 0,
      "Sin comprobante cargado": 0,
      "Con penalidad": 0,
      "Anulado": 0,
    };

    // Casos del día (D-1)
    const casosHoy = pnrCasos.filter(c => {
      if (!c.fecha_caso) return false;
      // fecha_caso es timestamp ISO → comparar solo la parte YYYY-MM-DD
      return String(c.fecha_caso).slice(0, 10) === fechaAyer;
    });

    // Por SC (usando mapeo ruta → service_center_id)
    const porSC = {};
    pnrCasos.forEach(c => {
      const v = Number(c.valor_compra) || 0;
      valorTotal += v;
      const est = c.estado;
      if (desglose[est] !== undefined) desglose[est]++;
      if (ESTADOS_ABIERTOS.includes(est)) { abiertos++; valorAbiertos += v; }
      else if (est === ESTADO_COBRO) { aCobro++; valorACobro += v; }
      else if (est === ESTADO_CERRADO) { cerrados++; }

      // SC: buscar en el mapa por id_ruta (PNR.ruta debería matchear con viajes.id_ruta)
      const scId = rutaToSc[String(c.ruta)] || "SIN_SC";
      if (!porSC[scId]) {
        porSC[scId] = {
          sc: scId, total: 0, abiertos: 0, aCobro: 0, cerrados: 0, valor: 0, valorACobro: 0,
          esperando: 0, cargado: 0, pendiente: 0, sinComprobante: 0,
        };
      }
      porSC[scId].total++;
      porSC[scId].valor += v;
      if (est === "Esperando comprobante") porSC[scId].esperando++;
      else if (est === "Comprobante cargado") porSC[scId].cargado++;
      else if (est === "Pendiente de revision") porSC[scId].pendiente++;
      else if (est === "Sin comprobante cargado") porSC[scId].sinComprobante++;
      else if (est === ESTADO_COBRO) { porSC[scId].aCobro++; porSC[scId].valorACobro += v; }
      else if (est === ESTADO_CERRADO) porSC[scId].cerrados++;
      if (ESTADOS_ABIERTOS.includes(est)) porSC[scId].abiertos++;
    });

    // Serie histórica diaria (últimos 30 días contando casos por fecha_caso)
    const serieDiaria = {};
    pnrCasos.forEach(c => {
      if (!c.fecha_caso) return;
      const f = String(c.fecha_caso).slice(0, 10);
      serieDiaria[f] = (serieDiaria[f] || 0) + 1;
    });
    // Generar array de 30 días terminando en fechaAyer
    const sparkSerie = [];
    const base = new Date(fechaAyer + "T00:00:00");
    for (let i = 29; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      sparkSerie.push(serieDiaria[key] || 0);
    }

    return {
      total, abiertos, aCobro, cerrados,
      valorTotal, valorAbiertos, valorACobro,
      desglose,
      casosHoy: casosHoy.length,
      porSC: Object.values(porSC).sort((a, b) => b.total - a.total),
      sparkSerie,
    };
  }, [pnrCasos, rutaToSc, fechaAyer]);

  if (loading) {
    return <div className="pg" style={{ padding: 60, textAlign: "center", color: "#888", fontFamily: "'Geist', sans-serif" }}>Cargando KPI de operación…</div>;
  }
  if (error) {
    return <div className="pg" style={{ padding: 40, color: "#c0392b", fontFamily: "'Geist', sans-serif" }}>Error: {error}</div>;
  }
  if (!data) {
    return <div className="pg" style={{ padding: 40, color: "#888", fontFamily: "'Geist', sans-serif" }}>Sin datos</div>;
  }

  // ═══ Extracción de datos del día (RPC comparativo) ═══════════════════════
  const meli = data.meli || {};
  const meliT = meli.total || {};
  const snap = data.snap || {};
  const snapT = snap.total || {};
  const ranking = data.ranking_sc || [];
  const vis = data.visitados || {};
  const visTotal = vis.total || {};
  const visPorSc = vis.por_sc || [];
  const umbralVis = Number(vis.umbral) || 99.5;
  const generadoEn = data.generado_en ? new Date(data.generado_en) : null;

  // Foco operativo
  const porCat = data.fallidas?.por_categoria || [];
  const getCat = (k) => porCat.find(c => c.categoria_operativa === k)?.paquetes || 0;
  const devueltosTotal = getCat("DEVOLUCION");
  const ambulanciasTotal = getCat("AMBULANCIA");
  const noVisitadosTotal = getCat("NO_VISITADO");
  const pctDev = snapT.cargados > 0 ? (devueltosTotal / snapT.cargados * 100) : 0;
  const pctNoVis = snapT.cargados > 0 ? (noVisitadosTotal / snapT.cargados * 100) : 0;

  // Compromiso MELI (servicios ofertados)
  const c = compromiso?.conteos || {};
  const ofrecidasTotal = (c.ofrecidas_sdd || 0) + (c.ofrecidas_spot || 0);
  const aceptadasTotal = (c.aceptadas_sdd || 0) + (c.aceptadas_spot || 0);
  const canceladasTotal = (c.canceladas_sdd || 0) + (c.canceladas_spot || 0);
  const rechazadasTotal = (c.rechazadas_sdd || 0) + (c.rechazadas_spot || 0);
  const efectivasTotal = ofrecidasTotal - canceladasTotal;
  const calcPct = (a, ef) => ef > 0 ? (a / ef) * 100 : null;
  const pctConfirmadosTotal = calcPct(aceptadasTotal, efectivasTotal);
  const pctSDD = calcPct(c.aceptadas_sdd || 0, (c.ofrecidas_sdd || 0) - (c.canceladas_sdd || 0));
  const pctSPOT = calcPct(c.aceptadas_spot || 0, (c.ofrecidas_spot || 0) - (c.canceladas_spot || 0));

  // ═══ Fecha texto formateada ══════════════════════════════════════════════
  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const dias = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  let fechaTexto = data.fecha;
  if (data.fecha) {
    const [y, m, d] = data.fecha.split("-").map(Number);
    const fObj = new Date(y, m - 1, d);
    fechaTexto = `${dias[fObj.getDay()]} ${d} de ${meses[m - 1]} de ${y}`;
  }

  // ═══ Helpers de color (paleta BRAIN) ═════════════════════════════════════
  // Cumplimiento NS (meta 98.5%)
  const cumpleNS = (pct) => pct != null && Number(pct) >= 98.5;
  const cumpleVis = (pct) => pct != null && Number(pct) >= umbralVis;
  const cumpleDev = (pct) => pct != null && Number(pct) < 2;
  const cumpleNoVis = (pct) => pct != null && Number(pct) <= 0.5;

  // Badges: usa paleta de severidad del Brain (verde #16a34a / naranja #F47B20 / rojo #c0392b)
  const badge = (tipo, txt) => {
    const styles = {
      ok:   { bg: "#dcfce7", color: "#166534" },
      warn: { bg: "#fef3c7", color: "#92400e" },
      bad:  { bg: "#fee2e2", color: "#991b1b" },
    };
    const s = styles[tipo] || styles.warn;
    return (
      <span style={{
        fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
        textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: 0.3,
        background: s.bg, color: s.color, fontFamily: "'Geist', sans-serif",
      }}>{txt}</span>
    );
  };

  // Color de borde izquierdo según severidad (Brain colors)
  const borderColors = { bad: "#c0392b", warn: "#F47B20", ok: "#16a34a" };

  // ═══ Procesado de histórico ══════════════════════════════════════════════
  // (los useMemo de histPeriodo/histPrev/rankingsDia se calculan arriba, antes de los returns)

  // Extrae serie por campo
  const serie = (rows, campo) => rows.map(r => Number(r[campo]) || 0);

  // Delta vs período anterior
  //  • En D-1: comparar último día (ayer) vs penúltimo (anteayer)
  //  • En D-7/D-15/D-22: comparar avg del período actual vs avg del período anterior
  const computeDelta = (campo) => {
    if (periodo === 1) {
      // Necesitamos los 2 últimos puntos del histórico completo
      if (!historico || historico.length < 2) return null;
      const ult = Number(historico[historico.length - 1]?.[campo]);
      const pen = Number(historico[historico.length - 2]?.[campo]);
      if (isNaN(ult) || isNaN(pen)) return null;
      return ult - pen;
    }
    if (histPeriodo.length < 3 || histPrev.length < 3) return null;
    const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    const curr = serie(histPeriodo, campo);
    const prev = serie(histPrev, campo);
    return avg(curr) - avg(prev);
  };

  const labelPeriodo = periodo === 1 ? "ayer"
                     : periodo === 7 ? "sem. anterior"
                     : periodo === 15 ? "15D anteriores"
                     : "período anterior";

  // (rankingsDia se calcula arriba como useMemo, antes de los returns)

  // top3/bot3 por métrica. lower=true → menos es mejor.
  const buildRank = (campo, fmt, lower = false) => {
    if (rankingsDia.length === 0) return { top3: "—", bot3: "—" };
    const valid = rankingsDia.filter(r => r[campo] != null);
    if (valid.length === 0) return { top3: "—", bot3: "—" };
    const sorted = [...valid].sort((a, b) => lower ? a[campo] - b[campo] : b[campo] - a[campo]);
    const top3 = sorted.slice(0, 3).map(s => `${s.sc} ${fmt(s[campo])}`).join(" · ");
    const bot3 = [...sorted].reverse().slice(0, 3).map(s => `${s.sc} ${fmt(s[campo])}`).join(" · ");
    return { top3, bot3 };
  };

  const fmtPct1 = x => `${Number(x).toFixed(1)}%`;
  const fmtPct2 = x => `${Number(x).toFixed(2)}%`;
  const fmtInt = x => `${Math.round(Number(x))}`;
  const fmtNum = x => Number(x).toLocaleString();
  const fmtZero = x => Number(x) === 0 ? "0 ✓" : `${x}`;

  // ═══ Estilos inline reutilizables (paleta Brain) ═════════════════════════
  const S = {
    NAVY: "#1a3a6b",
    ORANGE: "#F47B20",
    BG: "#f0f2f5",
    BORDER: "#e4e7ec",
    TEXT_MAIN: "#1a1a1a",
    TEXT_SEC: "#666",
    TEXT_MUTED: "#94a3b8",
    TEXT_LBL: "#64748b",
    OK: "#16a34a",
    WARN: "#F47B20",
    BAD: "#c0392b",
    INFO: "#1a3a6b",
  };

  return (
    <div style={{ fontFamily: "'Geist', sans-serif", background: S.BG, paddingBottom: 40 }}>
      {/* ═══ CONTEXT BAR ═══ */}
      <div style={{
        background: "#fff", borderBottom: `1px solid ${S.BORDER}`,
        padding: "10px 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 12, flexWrap: "wrap",
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: S.NAVY }}>KPI de Operación</div>
          <div style={{ fontSize: 11, color: S.TEXT_LBL, marginTop: 2 }}>
            {fechaTexto}
            {generadoEn && (
              <span style={{ color: S.TEXT_MUTED, marginLeft: 8 }}>
                · datos al {generadoEn.toLocaleString("es-MX", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
              </span>
            )}
            {historico.length === 0 && (
              <span style={{ color: S.WARN, marginLeft: 8 }}>
                · histórico no disponible (sparklines vacíos)
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: S.TEXT_MUTED, fontWeight: 500, marginRight: 4 }}>Período:</span>
          {[1, 7, 15, 22].map(n => (
            <button key={n} onClick={() => setPeriodo(n)}
              style={{
                fontSize: 11, fontWeight: 600, padding: "5px 12px",
                borderRadius: 6, border: `1px solid ${periodo === n ? S.NAVY : S.BORDER}`,
                background: periodo === n ? S.NAVY : "#fff",
                color: periodo === n ? "#fff" : "#475569",
                cursor: "pointer", fontFamily: "'Geist', sans-serif",
              }}>D-{n}</button>
          ))}
          <button onClick={() => setRefreshKey(k => k + 1)}
            style={{
              marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "5px 10px",
              background: "#fff", color: S.NAVY, border: `1px solid ${S.BORDER}`,
              borderRadius: 6, cursor: "pointer", fontFamily: "'Geist', sans-serif",
            }}>↻ Refrescar</button>
        </div>
      </div>

      {/* ═══ MAIN ═══ */}
      <div style={{ padding: "20px 24px", maxWidth: 1600, margin: "0 auto" }}>

        {/* ① NIVEL DE SERVICIO */}
        <GrupoTitulo icon="trend" titulo="Nivel de servicio" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 28 }}>
          {/* NS Ponderado */}
          <CardNS
            S={S}
            label="NS Ponderado"
            tipo={cumpleNS(meliT.ns_ponderado) ? "ok" : "bad"}
            badgeTxt={cumpleNS(meliT.ns_ponderado) ? "Cumple" : "No cumple"}
            valorMeli={meliT.ns_ponderado}
            valorSnap={snapT.ns_ponderado}
            subtitle={`${fmtNum(meliT.entregados || 0)} / ${fmtNum(meliT.cargados || 0)}`}
            meta={98.5}
            sparkSerieMeli={serie(histPeriodo, "ns_pond_meli")}
            sparkSerieSnap={serie(histPeriodo, "ns_pond_snap")}
            sparkPrev={serie(histPrev, "ns_pond_meli")}
            sparkAllVals={serie(historico, "ns_pond_meli")}
            delta={computeDelta("ns_pond_meli")}
            deltaLabel={labelPeriodo}
            deltaUnit="pp"
            lower={false}
            ranking={buildRank("ns_pond", fmtPct1)}
            zmMin={93} zmMax={100}
          />
          {/* NS Promedio SC */}
          <CardNS
            S={S}
            label="NS Promedio SC"
            tipo={cumpleNS(meli.ns_promedio_sc) ? "ok" : "bad"}
            badgeTxt={cumpleNS(meli.ns_promedio_sc) ? "Cumple" : `${rankingsDia.filter(r => r.ns_pond > 0 && r.ns_pond < 98.5).length} SCs no cumplen`}
            valorMeli={meli.ns_promedio_sc}
            valorSnap={snap.ns_promedio_sc}
            subtitle={`avg ${snapT.rutas || 0} rutas / ${rankingsDia.length} SCs`}
            meta={98.5}
            sparkSerieMeli={serie(histPeriodo, "ns_prom_sc_meli")}
            sparkSerieSnap={serie(histPeriodo, "ns_prom_sc_snap")}
            sparkPrev={serie(histPrev, "ns_prom_sc_meli")}
            sparkAllVals={serie(historico, "ns_prom_sc_meli")}
            delta={computeDelta("ns_prom_sc_meli")}
            deltaLabel={labelPeriodo}
            deltaUnit="pp"
            lower={false}
            ranking={buildRank("ns_pond", fmtPct1)}
            zmMin={93} zmMax={100}
          />
          {/* % Visitados */}
          <CardSingle
            S={S}
            label="% Visitados"
            tipo={cumpleVis(visTotal.pct_general) ? "ok" : "bad"}
            badgeTxt={cumpleVis(visTotal.pct_general) ? "Cumple" : "No cumple"}
            valor={visTotal.pct_general}
            valorFmt={v => v != null ? `${Number(v).toFixed(2)}%` : "—"}
            subtitle={`${Number(visTotal.no_visitados || 0)} no visitado(s) · óptimo ${umbralVis}%`}
            meta={umbralVis}
            sparkSerie={serie(histPeriodo, "pct_visitados")}
            sparkPrev={serie(histPrev, "pct_visitados")}
            sparkAllVals={serie(historico, "pct_visitados")}
            delta={computeDelta("pct_visitados")}
            deltaLabel={labelPeriodo}
            deltaUnit="pp"
            lower={false}
            ranking={buildRank("pct_visitados", v => v != null ? fmtPct1(v) : "—")}
            zmMin={98} zmMax={100}
            zoom
          />
        </div>

        {/* ② VOLUMEN DEL NEGOCIO */}
        <GrupoTitulo icon="box" titulo="Volumen del negocio" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 28 }}>
          <CardVolumen
            S={S}
            label="Rutas"
            valor={snapT.rutas || 0}
            subtitle={`${rankingsDia.length} SCs operando`}
            sparkSerie={serie(histPeriodo, "rutas")}
            sparkPrev={serie(histPrev, "rutas")}
            sparkAllVals={serie(historico, "rutas")}
            delta={computeDelta("rutas")}
            deltaLabel={labelPeriodo}
            deltaUnit=""
            ranking={buildRank("rutas", fmtInt)}
          />
          <CardVolumen
            S={S}
            label="Cargados"
            valor={fmtNum(snapT.cargados || 0)}
            subtitle="paquetes operados"
            sparkSerie={serie(histPeriodo, "cargados")}
            sparkPrev={serie(histPrev, "cargados")}
            sparkAllVals={serie(historico, "cargados")}
            delta={computeDelta("cargados")}
            deltaLabel={labelPeriodo}
            deltaUnit=""
            ranking={buildRank("cargados", fmtNum)}
          />
          <CardVolumen
            S={S}
            label="Entregados"
            valor={fmtNum(snapT.entregados || 0)}
            subtitle={`${(snapT.ns_ponderado || 0).toFixed(2)}% efectividad${ambulanciasTotal > 0 ? ` · incl. ${ambulanciasTotal} amb.` : ""}`}
            sparkSerie={serie(histPeriodo, "entregados")}
            sparkPrev={serie(histPrev, "entregados")}
            sparkAllVals={serie(historico, "entregados")}
            delta={computeDelta("entregados")}
            deltaLabel={labelPeriodo}
            deltaUnit=""
            ranking={buildRank("entregados", fmtNum)}
          />
        </div>

        {/* ③ FOCO OPERATIVO */}
        <GrupoTitulo icon="alert" titulo="Foco operativo" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 28 }}>
          <CardFoco
            S={S}
            label="Devueltos"
            tipo={cumpleDev(pctDev) ? "ok" : "bad"}
            badgeTxt={cumpleDev(pctDev) ? "Cumple" : "No cumple"}
            valor={devueltosTotal}
            subtitle={`${pctDev.toFixed(2)}% · meta <2%`}
            sparkSerie={serie(histPeriodo, "devueltos")}
            sparkPrev={serie(histPrev, "devueltos")}
            sparkAllVals={serie(historico, "devueltos")}
            delta={computeDelta("devueltos")}
            deltaLabel={labelPeriodo}
            deltaUnit=""
            lower={true}
            ranking={buildRank("devueltos", fmtInt, true)}
          />
          <CardFoco
            S={S}
            label="PNR del día"
            tipo={pnrStats.aCobro > 0 ? "bad" : pnrStats.abiertos > 0 ? "warn" : "ok"}
            badgeTxt={
              pnrStats.aCobro > 0 ? `${pnrStats.aCobro} a cobro` :
              pnrStats.abiertos > 0 ? `${pnrStats.abiertos} abiertos` : "Sin PNR"
            }
            valor={pnrStats.casosHoy}
            subtitle={`${pnrStats.total} acumulados · $${Math.round(pnrStats.valorTotal).toLocaleString("es-MX")} en riesgo`}
            sparkSerie={pnrStats.sparkSerie.slice(-periodo)}
            sparkPrev={pnrStats.sparkSerie.slice(Math.max(0, 30 - periodo * 2), 30 - periodo)}
            sparkAllVals={pnrStats.sparkSerie}
            delta={(() => {
              const s = pnrStats.sparkSerie;
              if (s.length < periodo * 2) return null;
              const avg = a => a.reduce((x, v) => x + v, 0) / a.length;
              return avg(s.slice(-periodo)) - avg(s.slice(-periodo * 2, -periodo));
            })()}
            deltaLabel={labelPeriodo}
            deltaUnit=""
            lower={true}
            ranking={(() => {
              if (pnrStats.porSC.length === 0) return { top3: "—", bot3: "—" };
              // Filtramos SIN_SC para el ranking
              const conSC = pnrStats.porSC.filter(s => s.sc !== "SIN_SC");
              if (conSC.length === 0) return { top3: "—", bot3: "—" };
              // ▲ menos casos (mejor) · ▼ más casos (peor)
              const asc = [...conSC].sort((a, b) => a.total - b.total);
              const top3 = asc.slice(0, 3).map(s => `${s.sc} ${s.total}`).join(" · ");
              const bot3 = [...asc].reverse().slice(0, 3).map(s => `${s.sc} ${s.total}`).join(" · ");
              return { top3, bot3 };
            })()}
          />
          <CardFoco
            S={S}
            label="Ambulancias"
            tipo={ambulanciasTotal === 0 ? "ok" : "warn"}
            badgeTxt={ambulanciasTotal === 0 ? "Sin amb." : `${ambulanciasTotal} amb.`}
            valor={ambulanciasTotal}
            subtitle="Rutas con refuerzo"
            sparkSerie={serie(histPeriodo, "ambulancias")}
            sparkPrev={serie(histPrev, "ambulancias")}
            sparkAllVals={serie(historico, "ambulancias")}
            delta={computeDelta("ambulancias")}
            deltaLabel={labelPeriodo}
            deltaUnit=""
            lower={true}
            ranking={buildRank("ambulancias", x => Number(x) === 0 ? "0 ✓" : `${x}`, true)}
          />
          <CardFoco
            S={S}
            label="No visitados"
            tipo={cumpleNoVis(pctNoVis) ? "ok" : "bad"}
            badgeTxt={cumpleNoVis(pctNoVis) ? "Cumple" : "No cumple"}
            valor={`${pctNoVis.toFixed(2)}%`}
            subtitle={`${noVisitadosTotal} paquete(s) · meta ≤0.5%`}
            sparkSerie={serie(histPeriodo, "no_visitados")}
            sparkPrev={serie(histPrev, "no_visitados")}
            sparkAllVals={serie(historico, "no_visitados")}
            delta={computeDelta("no_visitados")}
            deltaLabel={labelPeriodo}
            deltaUnit=""
            lower={true}
            ranking={buildRank("no_visitados", fmtInt, true)}
          />
        </div>

        {/* ③.b DETALLE PNR — Solo si hay casos */}
        {pnrStats.total > 0 && (
          <>
            <GrupoTitulo icon="clipboard" titulo="Detalle PNR por estado y SC" />

            {/* Resumen general 4 cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
              <CardWrap S={S} tipo={null}>
                <CardHeader label="Total PNR" S={S} />
                <div style={{ fontSize: 24, fontWeight: 700, color: "#111827", letterSpacing: -0.5, lineHeight: 1, marginBottom: 3 }}>
                  {pnrStats.total}
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                  ${Math.round(pnrStats.valorTotal).toLocaleString("es-MX")} en riesgo
                </div>
              </CardWrap>

              <CardWrap S={S} tipo="warn">
                <CardHeader label="Abiertos" tipo="warn" badgeTxt="en gestión" S={S} />
                <div style={{ fontSize: 24, fontWeight: 700, color: "#111827", letterSpacing: -0.5, lineHeight: 1, marginBottom: 3 }}>
                  {pnrStats.abiertos}
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                  ${Math.round(pnrStats.valorAbiertos).toLocaleString("es-MX")}
                </div>
              </CardWrap>

              <CardWrap S={S} tipo={pnrStats.aCobro > 0 ? "bad" : "ok"}>
                <CardHeader label="A cobro" tipo={pnrStats.aCobro > 0 ? "bad" : "ok"} badgeTxt={pnrStats.aCobro > 0 ? "Con penalidad" : "Sin penalidad"} S={S} />
                <div style={{ fontSize: 24, fontWeight: 700, color: pnrStats.aCobro > 0 ? "#c0392b" : "#111827", letterSpacing: -0.5, lineHeight: 1, marginBottom: 3 }}>
                  {pnrStats.aCobro}
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                  ${Math.round(pnrStats.valorACobro).toLocaleString("es-MX")} a pagar
                </div>
              </CardWrap>

              <CardWrap S={S} tipo="ok">
                <CardHeader label="Cerrados" tipo="ok" badgeTxt="Anulado" S={S} />
                <div style={{ fontSize: 24, fontWeight: 700, color: "#111827", letterSpacing: -0.5, lineHeight: 1, marginBottom: 3 }}>
                  {pnrStats.cerrados}
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                  archivados
                </div>
              </CardWrap>
            </div>

            {/* Desglose de estados (todos los 6) */}
            <div style={{ background: "#fff", border: `0.5px solid ${S.BORDER}`, borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 12 }}>
                Desglose por estado
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8 }}>
                {[
                  { k: "Esperando comprobante", color: "#92400e", bg: "#fef3c7" },
                  { k: "Comprobante cargado", color: "#1e40af", bg: "#dbeafe" },
                  { k: "Pendiente de revision", color: "#6b21a8", bg: "#f3e8ff" },
                  { k: "Sin comprobante cargado", color: "#c0392b", bg: "#fee2e2" },
                  { k: "Con penalidad", color: "#991b1b", bg: "#fee2e2" },
                  { k: "Anulado", color: "#475569", bg: "#f1f5f9" },
                ].map(({ k, color, bg }) => (
                  <div key={k} style={{ padding: "10px 12px", background: bg, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4, lineHeight: 1.2, minHeight: 24 }}>
                      {k}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>
                      {pnrStats.desglose[k] || 0}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabla detallada por SC */}
            <div style={{ background: "#fff", border: `0.5px solid ${S.BORDER}`, borderRadius: 12, padding: 14, marginBottom: 28, overflow: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Detalle por SC
                </div>
                <div style={{ fontSize: 10, color: "#9CA3AF" }}>
                  {pnrStats.porSC.length} SC con casos
                  {pnrStats.porSC.some(s => s.sc === "SIN_SC") && (
                    <span style={{ color: "#F47B20", marginLeft: 8 }}>
                      · {pnrStats.porSC.find(s => s.sc === "SIN_SC")?.total || 0} casos sin mapeo de ruta
                    </span>
                  )}
                </div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "'Geist', sans-serif" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${S.BORDER}`, textAlign: "left" }}>
                    <th style={{ padding: "8px 10px", fontSize: 10, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>SC</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, textAlign: "right" }}>Total</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, textAlign: "right" }}>Esperando</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, textAlign: "right" }}>Cargado</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, color: "#6b21a8", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, textAlign: "right" }}>Pendiente</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, color: "#c0392b", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, textAlign: "right" }}>Sin comp.</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, color: "#991b1b", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, textAlign: "right" }}>A cobro</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, textAlign: "right" }}>Anulado</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, textAlign: "right" }}>$ Riesgo</th>
                  </tr>
                </thead>
                <tbody>
                  {pnrStats.porSC.map((s, i) => (
                    <tr key={s.sc} style={{ borderBottom: i === pnrStats.porSC.length - 1 ? "none" : `1px solid ${S.BORDER}` }}>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: s.sc === "SIN_SC" ? "#F47B20" : "#1a3a6b" }}>
                        {s.sc === "SIN_SC" ? "— Sin mapeo" : s.sc}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums" }}>{s.total}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: s.esperando > 0 ? "#92400e" : "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>{s.esperando || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: s.cargado > 0 ? "#1e40af" : "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>{s.cargado || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: s.pendiente > 0 ? "#6b21a8" : "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>{s.pendiente || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: s.sinComprobante > 0 ? "#c0392b" : "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>{s.sinComprobante || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: s.aCobro > 0 ? "#991b1b" : "#cbd5e1", fontWeight: s.aCobro > 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>{s.aCobro || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: s.cerrados > 0 ? "#475569" : "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>{s.cerrados || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: "#1a3a6b", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        ${Math.round(s.valor).toLocaleString("es-MX")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ④ SERVICIOS OFERTADOS */}
        {compromiso && (
          <>
            <GrupoTitulo icon="award" titulo="Servicios ofertados · semana en curso" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 28 }}>
              <CardCompromiso
                S={S}
                label="Confirmados · Mié lock"
                tipo={pctConfirmadosTotal >= 95 ? "ok" : pctConfirmadosTotal >= 80 ? "warn" : "bad"}
                badgeTxt={pctConfirmadosTotal != null ? `${pctConfirmadosTotal.toFixed(0)}%` : "—"}
                valor={aceptadasTotal}
                subtitle={`de ${efectivasTotal} efectivos · ${ofrecidasTotal} ofertados`}
                footer={`efectivos = ofertados − canc. MELI (${canceladasTotal})`}
              />
              <CardCompromiso
                S={S}
                label="SDD · Súper dedicadas"
                tipo={pctSDD === 100 ? "ok" : pctSDD >= 95 ? "warn" : "bad"}
                badgeTxt={pctSDD != null ? `${pctSDD.toFixed(0)}%` : "—"}
                valor={`${c.aceptadas_sdd || 0}/${(c.ofrecidas_sdd || 0) - (c.canceladas_sdd || 0)}`}
                subtitle="Flota fija · deadline Mié"
                footer="Compromiso irrenunciable"
                footerIcon="lock"
              />
              <CardCompromiso
                S={S}
                label="SPOT · Variables"
                tipo={pctSPOT >= 90 ? "ok" : pctSPOT >= 70 ? "warn" : "bad"}
                badgeTxt={pctSPOT != null ? `${pctSPOT.toFixed(1)}%` : "—"}
                valor={`${c.aceptadas_spot || 0}/${(c.ofrecidas_spot || 0) - (c.canceladas_spot || 0)}`}
                subtitle={`${c.rechazadas_spot || 0} rechazados · ${c.canceladas_spot || 0} canc. MELI`}
                footer="Ver análisis de compromiso"
              />
            </div>
          </>
        )}

        <div style={{ textAlign: "center", fontSize: 10, color: S.TEXT_MUTED, padding: "12px 0 24px" }}>
          Bigticket · KPI de Operación · Pool MELI MX · {fechaTexto}
        </div>
      </div>
    </div>
  );
}

function GrupoTitulo({ icon, titulo }) {
  const icons = {
    trend: <path d="M3 17 L8 12 L13 15 L18 9 L21 12 M3 3 L3 21 M3 21 L21 21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="#6B7280" />,
    box:   <g fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><line x1="12" y1="12" x2="12" y2="21"/><polyline points="4 7.5 12 12 20 7.5"/></g>,
    alert: <g fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></g>,
    award: <g fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></g>,
    clipboard: <g fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></g>,
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      fontSize: 14, fontWeight: 600, color: "#6B7280",
      textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24">{icons[icon]}</svg>
      <span>{titulo}</span>
      <span style={{ flex: 1, height: 0.5, background: "#e4e7ec" }}></span>
    </div>
  );
}

function CardWrap({ S, tipo, children, height }) {
  const borderColors = { bad: "#c0392b", warn: "#F47B20", ok: "#16a34a" };
  const bc = tipo ? borderColors[tipo] : null;
  return (
    <div style={{
      background: "#fff",
      border: `0.5px solid ${S.BORDER}`,
      borderRadius: bc ? "0 12px 12px 0" : 12,
      borderLeft: bc ? `3px solid ${bc}` : `0.5px solid ${S.BORDER}`,
      padding: 14, display: "flex", flexDirection: "column",
      minHeight: height || "auto",
    }}>{children}</div>
  );
}

function CardHeader({ label, tipo, badgeTxt, S }) {
  const styles = {
    ok:   { bg: "#dcfce7", color: "#166534" },
    warn: { bg: "#fef3c7", color: "#92400e" },
    bad:  { bg: "#fee2e2", color: "#991b1b" },
  };
  const st = badgeTxt && tipo ? styles[tipo] : null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </span>
      {st && (
        <span style={{
          fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
          textTransform: "uppercase", whiteSpace: "nowrap",
          background: st.bg, color: st.color,
        }}>{badgeTxt}</span>
      )}
    </div>
  );
}

function ZoomBar({ valor, meta, zmMin, zmMax, lower = false, S }) {
  if (valor == null || meta == null) return null;
  const v = Number(valor);
  const range = zmMax - zmMin;
  const valPct = Math.max(0, Math.min(100, ((v - zmMin) / range) * 100));
  const metaPct = Math.max(0, Math.min(100, ((meta - zmMin) / range) * 100));
  const deltaPp = v - meta;
  const cumple = lower ? v <= meta : v >= meta;
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ position: "relative", height: 16, marginBottom: 2 }}>
        <span style={{
          position: "absolute", left: `${metaPct}%`, transform: "translateX(-50%)",
          fontSize: 9, color: "#374151", fontWeight: 600, whiteSpace: "nowrap",
          background: "#fff", padding: "0 2px", lineHeight: 1,
        }}>meta {meta}%</span>
      </div>
      <div style={{ position: "relative", height: 6, marginBottom: 4 }}>
        <div style={{ position: "absolute", inset: 0, background: "#F3F4F6", borderRadius: 3 }}></div>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${valPct}%`, background: "#9CA3AF", borderRadius: 3 }}></div>
        <div style={{ position: "absolute", left: `${metaPct}%`, top: -5, width: 2, height: 16, background: "#111827", borderRadius: 1, zIndex: 2 }}></div>
        <div style={{
          position: "absolute", left: `${valPct}%`, top: "50%",
          width: 10, height: 10, borderRadius: "50%", background: "#374151",
          border: "2px solid #fff", transform: "translateX(-50%) translateY(-50%)",
          zIndex: 3, boxShadow: "0 0 0 1px #D1D5DB",
        }}></div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#9CA3AF" }}>
        <span>{zmMin}%</span><span>{zmMax}%</span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 500, color: "#6B7280", marginTop: 4 }}>
        {Math.abs(deltaPp).toFixed(2)} pp {cumple ? "sobre" : "para alcanzar"} la meta
      </div>
    </div>
  );
}

function Sparkline({ vals, allVals, meta, prevVals, height = 52, color = "#9CA3AF", secondaryVals = null }) {
  // Si no hay suficientes datos, mostrar área vacía con leyenda sutil
  if (!vals || vals.length < 3) {
    return (
      <svg width="100%" height={height} viewBox={`0 0 400 ${height}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        <text x="200" y={height / 2 + 4} textAnchor="middle" fontSize="9" fill="#cbd5e1" fontFamily="'Geist', sans-serif">
          {(vals?.length || 0) === 0 ? "sin histórico" : "datos insuficientes"}
        </text>
      </svg>
    );
  }

  const W = 400, H = height, pad = 4;
  const ref = [...(allVals && allVals.length ? allVals : vals)];
  if (meta != null) ref.push(meta);
  if (prevVals?.length) ref.push(...prevVals);
  if (secondaryVals?.length) ref.push(...secondaryVals);
  const dMin = Math.min(...ref), dMax = Math.max(...ref);
  const padY = Math.max((dMax - dMin) * 0.10, 0.15);
  const yMin = dMin - padY, yMax = dMax + padY;
  const py = v => H - pad - ((v - yMin) / (yMax - yMin)) * (H - pad * 2);

  function buildPath(data) {
    const smF = Math.min(data.length / 30, 0.5);
    const sm = data.map((v, i, a) => {
      const p = a[i - 1] ?? v, n2 = a[i + 1] ?? v;
      return v + ((p + n2) / 2 - v) * smF;
    });
    const xs = sm.map((_, i) => pad + (i / (sm.length - 1)) * (W - pad * 2));
    const ys = sm.map(v => py(v));
    const N = xs.length, t = 0.45;
    let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
    for (let i = 0; i < N - 1; i++) {
      const x0 = xs[i > 0 ? i - 1 : 0], y0 = ys[i > 0 ? i - 1 : 0];
      const x1 = xs[i], y1 = ys[i], x2 = xs[i + 1], y2 = ys[i + 1];
      const x3 = xs[i < N - 2 ? i + 2 : N - 1], y3 = ys[i < N - 2 ? i + 2 : N - 1];
      const cp1x = x1 + (x2 - x0) * t / 3, cp1y = y1 + (y2 - y0) * t / 3;
      const cp2x = x2 - (x3 - x1) * t / 3, cp2y = y2 - (y3 - y1) * t / 3;
      d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
    return { d, lx: xs[N - 1].toFixed(1), ly: ys[N - 1].toFixed(1), x0: xs[0].toFixed(1) };
  }

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {meta != null && (
        <line x1={pad} y1={py(meta).toFixed(1)} x2={W - pad} y2={py(meta).toFixed(1)}
              stroke="#E5E7EB" strokeWidth="1" strokeDasharray="5,4" />
      )}
      {prevVals?.length >= 3 && (() => {
        const { d } = buildPath(prevVals);
        return <path d={d} fill="none" stroke="#D1D5DB" strokeWidth="1.5" strokeDasharray="4,3" strokeLinejoin="round" strokeLinecap="round" />;
      })()}
      {secondaryVals?.length >= 3 && (() => {
        const { d } = buildPath(secondaryVals);
        return <path d={d} fill="none" stroke="#1a3a6b" strokeWidth="1.3" strokeDasharray="2,3" strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />;
      })()}
      {(() => {
        const { d, lx, ly, x0 } = buildPath(vals);
        return (
          <>
            <path d={`${d} L${lx},${H} L${x0},${H} Z`} fill={color} fillOpacity="0.1" />
            <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={lx} cy={ly} r="3.5" fill="#6B7280" />
          </>
        );
      })()}
    </svg>
  );
}

function DeltaText({ delta, lower, label, unit }) {
  if (delta == null) return <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4, minHeight: 16 }}></div>;
  const better = lower ? delta < 0 : delta > 0;
  const worse = lower ? delta > 0 : delta < 0;
  const arrow = better ? "↑" : worse ? "↓" : "→";
  const sign = delta > 0 ? "+" : "";
  const val = `${sign}${delta.toFixed(2)}${unit ? " " + unit : ""}`;
  const color = better ? "#16a34a" : worse ? "#c0392b" : "#9CA3AF";
  return (
    <div style={{ fontSize: 11, color, marginTop: 4, minHeight: 16 }}>
      {arrow} {val} vs {label}
    </div>
  );
}

function RankingBlock({ top3, bot3 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "14px 1fr", gap: 5, alignItems: "start" }}>
        <span style={{ color: "#16a34a", fontSize: 11, fontWeight: 600, paddingTop: 1 }}>▲</span>
        <span style={{ fontSize: 11, color: "#9CA3AF", lineHeight: 1.5 }}>{top3}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "14px 1fr", gap: 5, alignItems: "start" }}>
        <span style={{ color: "#c0392b", fontSize: 11, fontWeight: 600, paddingTop: 1 }}>▼</span>
        <span style={{ fontSize: 11, color: "#9CA3AF", lineHeight: 1.5 }}>{bot3}</span>
      </div>
    </div>
  );
}

const Div = () => <div style={{ height: 0.5, background: "#F0F0F0", margin: "8px 0" }}></div>;

function CardNS({ S, label, tipo, badgeTxt, valorMeli, valorSnap, subtitle, meta,
                  sparkSerieMeli, sparkSerieSnap, sparkPrev, sparkAllVals,
                  delta, deltaLabel, deltaUnit, lower, ranking, zmMin, zmMax }) {
  const fmt = v => v != null ? `${Number(v).toFixed(2)}%` : "—";
  return (
    <CardWrap S={S} tipo={tipo}>
      <CardHeader label={label} tipo={tipo} badgeTxt={badgeTxt} S={S} />
      {/* Dos valores apilados */}
      <div style={{ marginBottom: 3 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.4 }}>📄 MELI</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: "#111827", letterSpacing: -0.5, lineHeight: 1 }}>{fmt(valorMeli)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#047857", textTransform: "uppercase", letterSpacing: 0.4 }}>📸 SNAP</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#475569", letterSpacing: -0.3, lineHeight: 1 }}>{fmt(valorSnap)}</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10, marginTop: 4 }}>{subtitle}</div>
      <ZoomBar valor={valorMeli} meta={meta} zmMin={zmMin} zmMax={zmMax} lower={lower} S={S} />
      <Sparkline
        vals={sparkSerieMeli}
        secondaryVals={sparkSerieSnap}
        allVals={sparkAllVals}
        meta={meta}
        prevVals={sparkPrev}
        height={72}
      />
      <DeltaText delta={delta} lower={lower} label={deltaLabel} unit={deltaUnit} />
      <Div />
      <RankingBlock {...ranking} />
    </CardWrap>
  );
}

function CardSingle({ S, label, tipo, badgeTxt, valor, valorFmt, subtitle, meta,
                      sparkSerie, sparkPrev, sparkAllVals,
                      delta, deltaLabel, deltaUnit, lower, ranking, zmMin, zmMax, zoom }) {
  return (
    <CardWrap S={S} tipo={tipo}>
      <CardHeader label={label} tipo={tipo} badgeTxt={badgeTxt} S={S} />
      <div style={{ fontSize: 24, fontWeight: 700, color: "#111827", letterSpacing: -0.5, lineHeight: 1, marginBottom: 3 }}>
        {valorFmt ? valorFmt(valor) : valor}
      </div>
      <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>{subtitle}</div>
      {zoom && <ZoomBar valor={valor} meta={meta} zmMin={zmMin} zmMax={zmMax} lower={lower} S={S} />}
      <Sparkline vals={sparkSerie} allVals={sparkAllVals} meta={meta} prevVals={sparkPrev} height={72} />
      <DeltaText delta={delta} lower={lower} label={deltaLabel} unit={deltaUnit} />
      <Div />
      <RankingBlock {...ranking} />
    </CardWrap>
  );
}

function CardVolumen({ S, label, valor, subtitle, sparkSerie, sparkPrev, sparkAllVals,
                       delta, deltaLabel, deltaUnit, ranking }) {
  return (
    <CardWrap S={S} tipo={null}>
      <CardHeader label={label} S={S} />
      <div style={{ fontSize: 24, fontWeight: 700, color: "#111827", letterSpacing: -0.5, lineHeight: 1, marginBottom: 3 }}>{valor}</div>
      <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>{subtitle}</div>
      <Sparkline vals={sparkSerie} allVals={sparkAllVals} prevVals={sparkPrev} height={52} />
      <DeltaText delta={delta} lower={false} label={deltaLabel} unit={deltaUnit} />
      <Div />
      <RankingBlock {...ranking} />
    </CardWrap>
  );
}

function CardFoco({ S, label, tipo, badgeTxt, valor, subtitle, sparkSerie, sparkPrev, sparkAllVals,
                    delta, deltaLabel, deltaUnit, lower, ranking }) {
  return (
    <CardWrap S={S} tipo={tipo}>
      <CardHeader label={label} tipo={tipo} badgeTxt={badgeTxt} S={S} />
      <div style={{ fontSize: 24, fontWeight: 700, color: "#111827", letterSpacing: -0.5, lineHeight: 1, marginBottom: 3 }}>{valor}</div>
      <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>{subtitle}</div>
      <Sparkline vals={sparkSerie} allVals={sparkAllVals} prevVals={sparkPrev} height={52} />
      <DeltaText delta={delta} lower={lower} label={deltaLabel} unit={deltaUnit} />
      <Div />
      <RankingBlock {...ranking} />
    </CardWrap>
  );
}

function CardCompromiso({ S, label, tipo, badgeTxt, valor, subtitle, footer, footerIcon }) {
  return (
    <CardWrap S={S} tipo={tipo}>
      <CardHeader label={label} tipo={tipo} badgeTxt={badgeTxt} S={S} />
      <div style={{ fontSize: 24, fontWeight: 700, color: "#111827", letterSpacing: -0.5, lineHeight: 1, marginBottom: 3 }}>{valor}</div>
      <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>{subtitle}</div>
      <Div />
      <div style={{ fontSize: 11, color: "#6B7280", display: "flex", alignItems: "center", gap: 4, marginTop: "auto" }}>
        {footerIcon === "lock" && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        )}
        {footer}
      </div>
    </CardWrap>
  );
}

function PoolMeliDiferenciasMaestros() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Calcular ayer en hora local
  const [fechaSel, setFechaSel] = useState(() => {
    const ahora = new Date();
    const ayer = new Date(ahora);
    ayer.setDate(ayer.getDate() - 1);
    return ayer.toISOString().slice(0, 10);
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: result, error: err } = await sb.rpc("get_diferencias_maestros", { p_fecha: fechaSel });
        if (!alive) return;
        if (err) throw err;
        setData(result);
      } catch (e) {
        if (alive) setError(e.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, fechaSel]);

  if (loading) {
    return <div className="pg" style={{ padding: 60, textAlign: "center", color: "#888" }}>Cargando diferencias entre Maestros…</div>;
  }
  if (error) {
    return <div className="pg" style={{ padding: 40, color: "#c0392b" }}>Error: {error}</div>;
  }
  if (!data) {
    return <div className="pg" style={{ padding: 40, color: "#888" }}>Sin datos</div>;
  }

  const resumen = data.resumen || {};
  const porSc = data.por_sc || [];
  const conDif = data.con_diferencias || [];
  const soloSnap = data.solo_snapshot || [];
  const soloMeli = data.solo_meli || [];
  const generadoEn = data.generado_en ? new Date(data.generado_en) : null;

  const totalRutas = resumen.total_rutas || 0;
  const rutasMatch = resumen.rutas_match || 0;
  const rutasConDif = resumen.rutas_con_diferencias || 0;
  const rutasSoloSnap = resumen.rutas_solo_snap || 0;
  const rutasSoloMeli = resumen.rutas_solo_meli || 0;
  const pctMatch = totalRutas > 0 ? (rutasMatch / totalRutas * 100) : 0;

  // Formato fecha
  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const dias = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  let fechaTexto = data.fecha;
  if (data.fecha) {
    const [y, m, d] = data.fecha.split("-").map(Number);
    const fechaObj = new Date(y, m - 1, d);
    fechaTexto = `${dias[fechaObj.getDay()]} ${d} de ${meses[m - 1]} de ${y}`;
  }

  const colorPctMatch = pctMatch >= 95 ? "#047857" : pctMatch >= 85 ? "#1A3A6B" : "#b91c1c";

  return (
    <div className="pg">
      {/* Header con selector de fecha y refresh */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="sec-title">Diferencias Maestros</div>
          <div className="sec-sub">
            Auditoría ruta por ruta · {fechaTexto}
            {generadoEn && (
              <span style={{ color: "#94a3b8", marginLeft: 8 }}>
                · generado {generadoEn.toLocaleString("es-MX", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="date"
            value={fechaSel}
            onChange={(e) => setFechaSel(e.target.value)}
            style={{
              padding: "6px 10px", fontSize: 12,
              border: "1px solid #e4e7ec", borderRadius: 6,
              fontFamily: "'Geist', sans-serif", color: "#1a3a6b",
            }}
          />
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            style={{
              padding: "8px 14px", fontSize: 12, fontWeight: 600,
              background: "#fff", color: "#1a3a6b",
              border: "1px solid #e4e7ec", borderRadius: 6,
              cursor: "pointer", fontFamily: "'Geist', sans-serif",
            }}
            title="Recargar datos"
          >
            ↻ Refrescar
          </button>
        </div>
      </div>

      {/* KPIs principales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        <div className="form-card" style={{ marginBottom: 0, padding: 16, borderTop: "3px solid #1A3A6B" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Total de Rutas
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#1A3A6B", lineHeight: 1, marginBottom: 4 }}>
            {totalRutas}
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            Combinadas de ambas fuentes
          </div>
        </div>
        <div className="form-card" style={{ marginBottom: 0, padding: 16, borderTop: `3px solid ${colorPctMatch}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            % Match exacto
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: colorPctMatch, lineHeight: 1, marginBottom: 4 }}>
            {pctMatch.toFixed(1)}%
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            {rutasMatch} de {totalRutas} cuadran
          </div>
        </div>
        <div className="form-card" style={{ marginBottom: 0, padding: 16, borderTop: "3px solid #F47B20" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Con diferencias
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#F47B20", lineHeight: 1, marginBottom: 4 }}>
            {rutasConDif}
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            Mismo ID, números distintos
          </div>
        </div>
        <div className="form-card" style={{ marginBottom: 0, padding: 16, borderTop: "3px solid #b91c1c" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Faltantes en algún lado
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#b91c1c", lineHeight: 1, marginBottom: 4 }}>
            {rutasSoloSnap + rutasSoloMeli}
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            {rutasSoloSnap} solo Snap · {rutasSoloMeli} solo MELI
          </div>
        </div>
        <div className="form-card" style={{ marginBottom: 0, padding: 16, borderTop: `3px solid ${(resumen.rutas_no_operadas || 0) > 0 ? "#dc2626" : "#94a3b8"}` }}
          title="Rutas con vehículo cargado pero que NO salieron del SC (cierre de bodega, cancelación operativa o similar). Estos paquetes NO son fallos de entrega.">
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Rutas no operadas
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: (resumen.rutas_no_operadas || 0) > 0 ? "#dc2626" : "#94a3b8", lineHeight: 1, marginBottom: 4 }}>
            {resumen.rutas_no_operadas || 0}
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            {(resumen.paquetes_no_operados || 0) > 0
              ? `${Number(resumen.paquetes_no_operados).toLocaleString()} paquetes no salieron`
              : "Vehículo cargado, sin salir"}
          </div>
        </div>
      </div>

      {/* Comparativa de totales (volumen agregado) */}
      <div className="form-card" style={{ marginBottom: 20 }}>
        <div className="form-title" style={{ marginBottom: 4 }}>Comparativa de volúmenes</div>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>Totales agregados de ambas fuentes</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e4e7ec", color: "#64748b", fontWeight: 700 }}>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" }}>Métrica</th>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Maestro MELI</th>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Snapshots</th>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Cargados", meli: resumen.total_cargados_meli, snap: resumen.total_cargados_snap },
                { label: "Entregados", meli: resumen.total_entregados_meli, snap: resumen.total_entregados_snap },
                { label: "Devueltos", meli: resumen.total_devueltos_meli, snap: resumen.total_devueltos_snap },
              ].map((row, i) => {
                const dif = (row.snap || 0) - (row.meli || 0);
                const colorDif = dif > 0 ? "#F47B20" : dif < 0 ? "#b91c1c" : "#94a3b8";
                return (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px", fontWeight: 600, color: "#0f172a" }}>{row.label}</td>
                    <td style={{ padding: "10px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>
                      {Number(row.meli || 0).toLocaleString()}
                    </td>
                    <td style={{ padding: "10px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>
                      {Number(row.snap || 0).toLocaleString()}
                    </td>
                    <td style={{ padding: "10px", textAlign: "right", color: colorDif, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {dif > 0 ? "+" : ""}{Number(dif).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resumen por SC */}
      <div className="form-card" style={{ marginBottom: 20 }}>
        <div className="form-title" style={{ marginBottom: 4 }}>Estado por SC</div>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>Cuántas rutas matchean, tienen diferencias o están faltantes en cada SC</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e4e7ec", color: "#64748b", fontWeight: 700 }}>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" }}>SC</th>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" }}>Rutas</th>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" }}>Match</th>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" }}>Con dif.</th>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" }}>Solo Snap</th>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" }}>Solo MELI</th>
                <th style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Σ |dif| cargados</th>
              </tr>
            </thead>
            <tbody>
              {porSc.map((sc, i) => {
                const tieneIssues = (sc.con_dif || 0) + (sc.solo_snap || 0) + (sc.solo_meli || 0) > 0;
                return (
                  <tr key={sc.sc} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 700, color: "#0f172a" }}>{sc.sc}</td>
                    <td style={{ padding: "8px 10px", textAlign: "center", color: "#475569", fontVariantNumeric: "tabular-nums" }}>{sc.rutas}</td>
                    <td style={{ padding: "8px 10px", textAlign: "center", color: "#047857", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{sc.match}</td>
                    <td style={{ padding: "8px 10px", textAlign: "center", color: (sc.con_dif || 0) > 0 ? "#F47B20" : "#94a3b8", fontWeight: (sc.con_dif || 0) > 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
                      {sc.con_dif || 0}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center", color: (sc.solo_snap || 0) > 0 ? "#b91c1c" : "#94a3b8", fontWeight: (sc.solo_snap || 0) > 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
                      {sc.solo_snap || 0}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center", color: (sc.solo_meli || 0) > 0 ? "#b91c1c" : "#94a3b8", fontWeight: (sc.solo_meli || 0) > 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
                      {sc.solo_meli || 0}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: tieneIssues ? "#F47B20" : "#94a3b8", fontWeight: tieneIssues ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
                      {sc.total_dif_cargados || 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rutas con diferencias en valores */}
      {conDif.length > 0 && (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <div className="form-title" style={{ marginBottom: 4 }}>Rutas con diferencias en valores</div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>
            Mismo ID de ruta en ambas fuentes, pero los números no coinciden. Ordenado por mayor diferencia en cargados.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e4e7ec", color: "#64748b", fontWeight: 700 }}>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" }}>ID Ruta</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" }}>SC</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" }}>Driver</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Carg. MELI/Snap</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Δ Carg.</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Entr. MELI/Snap</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Δ Entr.</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Dev. MELI/Snap</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Δ Dev.</th>
                </tr>
              </thead>
              <tbody>
                {conDif.map((r, i) => (
                  <tr key={r.idviaje} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                    <td style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 11, color: "#475569" }}>{r.idviaje}</td>
                    <td style={{ padding: "8px 6px", fontWeight: 700, color: "#0f172a" }}>
                      {r.sc}
                      {r.ruta_no_operada && (
                        <span title="RUTA NO OPERADA: vehículo cargado pero no salió del SC (cierre de bodega / cancelación operativa)"
                          style={{ marginLeft: 6, background: "#fef2f2", color: "#991b1b",
                            padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                            border: "1px solid #fca5a5", cursor: "help",
                            display: "inline-block", whiteSpace: "nowrap" }}>
                          🚫 NO OPERADA
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px 6px", color: "#475569" }}>{r.driver_name || "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>
                      {r.cargados_meli ?? "—"} / {r.cargados_snap ?? "—"}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: "#F47B20", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {r.dif_cargados > 0 ? "+" : ""}{r.dif_cargados}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>
                      {r.entregados_meli ?? "—"} / {r.entregados_snap ?? "—"}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: r.dif_entregados !== 0 ? "#F47B20" : "#94a3b8", fontWeight: r.dif_entregados !== 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
                      {r.dif_entregados > 0 ? "+" : ""}{r.dif_entregados}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>
                      {r.devueltos_meli ?? "—"} / {r.devueltos_snap ?? "—"}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: r.dif_devueltos !== 0 ? "#F47B20" : "#94a3b8", fontWeight: r.dif_devueltos !== 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
                      {r.dif_devueltos > 0 ? "+" : ""}{r.dif_devueltos}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rutas solo en Snapshot (operaron sin estar en MELI) */}
      {soloSnap.length > 0 && (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <div className="form-title" style={{ marginBottom: 4 }}>Rutas solo en Snapshot</div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>
            Operaron y cerraron, pero el Maestro MELI no las reporta. Posiblemente rutas reasignadas o creadas en días anteriores.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e4e7ec", color: "#64748b", fontWeight: 700 }}>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" }}>ID Ruta</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" }}>SC</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" }}>Driver</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Cargados</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Entregados</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Devueltos</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {soloSnap.map((r, i) => (
                  <tr key={r.idviaje} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                    <td style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 11, color: "#475569" }}>{r.idviaje}</td>
                    <td style={{ padding: "8px 6px", fontWeight: 700, color: "#0f172a" }}>
                      {r.sc}
                      {r.ruta_no_operada && (
                        <span title="RUTA NO OPERADA: vehículo cargado pero no salió del SC (cierre de bodega / cancelación operativa)"
                          style={{ marginLeft: 6, background: "#fef2f2", color: "#991b1b",
                            padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                            border: "1px solid #fca5a5", cursor: "help",
                            display: "inline-block", whiteSpace: "nowrap" }}>
                          🚫 NO OPERADA
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px 6px", color: "#475569" }}>{r.driver_name || "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: "#1A3A6B", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{r.cargados_snap}</td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>{r.entregados_snap}</td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>{r.devueltos_snap}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: "#94a3b8" }}>{r.status_final || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rutas solo en MELI (planificadas sin operar) */}
      {soloMeli.length > 0 && (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <div className="form-title" style={{ marginBottom: 4 }}>Rutas solo en Maestro MELI</div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>
            MELI las reporta pero los snapshots no las capturaron. Posibles rutas canceladas o que no salieron a operar.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e4e7ec", color: "#64748b", fontWeight: 700 }}>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" }}>ID Ruta</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left" }}>SC</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Cargados</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Entregados</th>
                  <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Devueltos</th>
                </tr>
              </thead>
              <tbody>
                {soloMeli.map((r, i) => (
                  <tr key={r.idviaje} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                    <td style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 11, color: "#475569" }}>{r.idviaje}</td>
                    <td style={{ padding: "8px 6px", fontWeight: 700, color: "#0f172a" }}>
                      {r.sc}
                      {r.ruta_no_operada && (
                        <span title="RUTA NO OPERADA: vehículo cargado pero no salió del SC (cierre de bodega / cancelación operativa)"
                          style={{ marginLeft: 6, background: "#fef2f2", color: "#991b1b",
                            padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                            border: "1px solid #fca5a5", cursor: "help",
                            display: "inline-block", whiteSpace: "nowrap" }}>
                          🚫 NO OPERADA
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: "#1A3A6B", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{r.cargados_meli}</td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>{r.entregados_meli}</td>
                    <td style={{ padding: "8px 6px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>{r.devueltos_meli}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Nota explicativa */}
      <div style={{ fontSize: 11, color: "#64748b", padding: 12, background: "#f8fafc", borderRadius: 6, border: "1px solid #e4e7ec", marginBottom: 20 }}>
        <strong>📋 Nota:</strong> Esta pestaña audita las diferencias entre el Excel oficial de MELI (descarga del portal) y los snapshots automáticos del scraper. 
        Los Snapshots son la fuente de verdad operativa por su mayor frecuencia de captura. 
        Las diferencias detectadas se documentan aquí para identificar patrones, validar reportes y conciliar números con MELI cuando sea necesario.
        <br /><br />
        <strong>🚫 Rutas no operadas:</strong> rutas con vehículo cargado pero que nunca salieron del SC (cierre de bodega, cancelación operativa, problema mecánico, etc.). 
        MELI las reporta con todos los paquetes como "devueltos", pero NO son fallos de entrega — son paquetes que se quedaron en bodega y se reasignan al día siguiente.
        Estos paquetes NO aparecen en <code>meli_paquetes_fallidos</code> porque MELI no genera eventos individuales con substatus de fallo.
      </div>
    </div>
  );
}

function PoolMeliInventario({ drivers, vehiculos, resumen, setModal, setDetalle, mesGlobal }) {
  const [tipo, setTipo] = useState("drivers");
  const [filtroCat, setFiltroCat] = useState("activos"); // activos | durmientes | fantasmas | todos
  const [calendarios, setCalendarios] = useState({ drivers: null, vehiculos: null });
  // Mes viene del padre (mesGlobal). Usamos directamente.
  const mesSeleccionado = mesGlobal || (() => {
    const hoy = new Date();
    return { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 };
  })();
  const r = resumen || {};

  // Cargar calendarios cuando cambia el mes
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const fechaInicio = `${mesSeleccionado.anio}-${String(mesSeleccionado.mes).padStart(2, '0')}-01`;
        const fechaFin = `${mesSeleccionado.anio}-${String(mesSeleccionado.mes).padStart(2, '0')}-${diasDelMes(mesSeleccionado.anio, mesSeleccionado.mes)}`;
        
        const [rd, rv] = await Promise.all([
          sb.from("vw_meli_calendario_drivers").select("*").gte("fecha", fechaInicio).lte("fecha", fechaFin),
          sb.from("vw_meli_calendario_vehiculos").select("*").gte("fecha", fechaInicio).lte("fecha", fechaFin),
        ]);
        if (!alive) return;
        
        // Agrupar por driver/placa
        const calDrivers = {};
        (rd.data || []).forEach(row => {
          if (!calDrivers[row.nombre]) calDrivers[row.nombre] = new Set();
          calDrivers[row.nombre].add(row.dia);
        });
        
        const calVehiculos = {};
        (rv.data || []).forEach(row => {
          if (!calVehiculos[row.placa]) calVehiculos[row.placa] = new Set();
          calVehiculos[row.placa].add(row.dia);
        });
        
        setCalendarios({ drivers: calDrivers, vehiculos: calVehiculos });
      } catch (e) {
        console.error("Error calendarios:", e);
      }
    })();
    return () => { alive = false; };
  }, [mesSeleccionado.anio, mesSeleccionado.mes]);

  // Filtrado por categoría
  const driversFiltrados = useMemo(() => {
    if (filtroCat === "todos") return drivers;
    if (filtroCat === "activos") return drivers.filter(d => d.categoria !== "durmiente" && d.categoria !== "fantasma");
    if (filtroCat === "durmientes") return drivers.filter(d => d.categoria === "durmiente");
    if (filtroCat === "fantasmas") return drivers.filter(d => d.categoria === "fantasma");
    return drivers;
  }, [drivers, filtroCat]);

  const vehiculosFiltrados = useMemo(() => {
    if (filtroCat === "todos") return vehiculos;
    if (filtroCat === "activos") return vehiculos.filter(v => v.categoria !== "durmiente" && v.categoria !== "fantasma");
    if (filtroCat === "durmientes") return vehiculos.filter(v => v.categoria === "durmiente");
    if (filtroCat === "fantasmas") return vehiculos.filter(v => v.categoria === "fantasma");
    return vehiculos;
  }, [vehiculos, filtroCat]);

  const driversActivos = drivers.filter(d => d.categoria !== "durmiente" && d.categoria !== "fantasma");
  const driversDurmientes = drivers.filter(d => d.categoria === "durmiente");
  const driversFantasma = drivers.filter(d => d.categoria === "fantasma");
  const driversEnMaster = drivers.filter(d => d.en_master);
  
  const vehiculosActivos = vehiculos.filter(v => v.categoria !== "durmiente" && v.categoria !== "fantasma");
  const vehiculosDurmientes = vehiculos.filter(v => v.categoria === "durmiente");
  const vehiculosFantasma = vehiculos.filter(v => v.categoria === "fantasma");

  const verDriversMaster = () => setModal({
    titulo: "Drivers · Master Oficial Meli",
    filas: driversEnMaster,
    nombreArchivo: "drivers_master_oficial_meli"
  });

  return (
    <div className="pg">
      {/* Selector tipo + mes */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 4, background: "#f1f5f9", padding: 4, borderRadius: 8 }}>
          <button onClick={() => setTipo("drivers")}
            style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", borderRadius: 6,
              background: tipo === "drivers" ? "#fff" : "transparent",
              color: tipo === "drivers" ? "#1a3a6b" : "#64748b",
              boxShadow: tipo === "drivers" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              fontFamily: "'Geist', sans-serif" }}>
            Drivers ({drivers.length})
          </button>
          <button onClick={() => setTipo("vehicles")}
            style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", borderRadius: 6,
              background: tipo === "vehicles" ? "#fff" : "transparent",
              color: tipo === "vehicles" ? "#1a3a6b" : "#64748b",
              boxShadow: tipo === "vehicles" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              fontFamily: "'Geist', sans-serif" }}>
            Vehículos ({vehiculos.length})
          </button>
        </div>
      </div>

      {/* KPIs */}
      {tipo === "drivers" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          <PoolMeliKpi label="En master oficial" value={r.drivers_master ?? driversEnMaster.length} sublabel="API rostering Meli"
                       onClick={verDriversMaster} />
          <PoolMeliKpi label={`Activos en ${NOMBRES_MES[mesSeleccionado.mes - 1]}`} value={driversActivos.length} sublabel={`${Math.round(driversActivos.length / (r.drivers_master || 1) * 100)}% del master`} color="#047857"
                       onClick={() => setFiltroCat("activos")} />
          <PoolMeliKpi label="Durmientes" value={r.drivers_durmientes ?? driversDurmientes.length} sublabel="En master, no operaron"
                       onClick={() => setFiltroCat("durmientes")} />
          <PoolMeliKpi label="Fantasmas" value={r.drivers_fantasma ?? driversFantasma.length} sublabel="Operan sin estar en master" danger
                       onClick={() => setFiltroCat("fantasmas")} />
        </div>
      )}

      {tipo === "vehicles" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          <PoolMeliKpi label="En master oficial" value={r.vehiculos_master} sublabel="API rostering Meli" />
          <PoolMeliKpi label={`Activos en ${NOMBRES_MES[mesSeleccionado.mes - 1]}`} value={vehiculosActivos.length} sublabel={`${Math.round(vehiculosActivos.length / (r.vehiculos_master || 1) * 100)}% de la flota`} color="#047857"
                       onClick={() => setFiltroCat("activos")} />
          <PoolMeliKpi label="Durmientes" value={r.vehiculos_durmientes} sublabel={`Sin uso en ${NOMBRES_MES[mesSeleccionado.mes - 1]}`}
                       onClick={() => setFiltroCat("durmientes")} />
          <PoolMeliKpi label="Fantasmas" value={r.vehiculos_fantasma} sublabel="Sin registro oficial" danger
                       onClick={() => setFiltroCat("fantasmas")} />
        </div>
      )}

      {/* Filtro de categoría */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginRight: 4 }}>Filtrar:</span>
        {[
          { id: "activos", label: "Activos", color: "#047857" },
          { id: "durmientes", label: "Durmientes", color: "#64748b" },
          { id: "fantasmas", label: "Fantasmas", color: "#b91c1c" },
          { id: "todos", label: "Todos", color: "#1a3a6b" },
        ].map(f => {
          const active = filtroCat === f.id;
          const count = tipo === "drivers"
            ? (f.id === "activos" ? driversActivos.length : f.id === "durmientes" ? driversDurmientes.length : f.id === "fantasmas" ? driversFantasma.length : drivers.length)
            : (f.id === "activos" ? vehiculosActivos.length : f.id === "durmientes" ? vehiculosDurmientes.length : f.id === "fantasmas" ? vehiculosFantasma.length : vehiculos.length);
          return (
            <button key={f.id} onClick={() => setFiltroCat(f.id)}
              style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, borderRadius: 4,
                border: active ? "none" : "1px solid #e4e7ec",
                background: active ? f.color : "#fff",
                color: active ? "#fff" : "#475569",
                cursor: "pointer", fontFamily: "'Geist', sans-serif" }}>
              {f.label}
              <span style={{ marginLeft: 6, opacity: 0.7 }}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* Calendario */}
      {tipo === "drivers" && (
        <PoolMeliCalendario 
          tipo="drivers"
          registros={driversFiltrados}
          calendario={calendarios.drivers}
          mes={mesSeleccionado}
          onVerDetalle={(d) => setDetalle({ tipo: "driver", registro: d })}
        />
      )}
      {tipo === "vehicles" && (
        <PoolMeliCalendario 
          tipo="vehiculos"
          registros={vehiculosFiltrados}
          calendario={calendarios.vehiculos}
          mes={mesSeleccionado}
          onVerDetalle={(v) => setDetalle({ tipo: "vehiculo", registro: v })}
        />
      )}
    </div>
  );
}

function PoolMeliCalendario({ tipo, registros, calendario, mes, onVerDetalle }) {
  const totalDias = diasDelMes(mes.anio, mes.mes);
  const dias = Array.from({ length: totalDias }, (_, i) => i + 1);

  if (registros.length === 0) {
    return (
      <div className="form-card" style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 12 }}>
        No hay registros para mostrar en esta categoría.
      </div>
    );
  }

  return (
    <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, position: "sticky", left: 0, background: "#f8fafc", zIndex: 2 }}>
                {tipo === "drivers" ? "ID Driver" : "Vehicle ID"}
              </th>
              <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, position: "sticky", left: 80, background: "#f8fafc", zIndex: 2 }}>
                {tipo === "drivers" ? "Nombre" : "Placa"}
              </th>
              {dias.map(d => (
                <th key={d} style={{ padding: "6px 4px", textAlign: "center", fontSize: 9, fontWeight: 700, color: "#64748b", minWidth: 22 }}>
                  {d}
                </th>
              ))}
              <th style={{ padding: "10px 12px", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, position: "sticky", right: 0, background: "#f8fafc", zIndex: 2 }}>
                Acción
              </th>
            </tr>
          </thead>
          <tbody>
            {registros.map((reg, i) => {
              const key = tipo === "drivers" ? reg.nombre : reg.placa;
              const idLabel = tipo === "drivers" ? reg.driver_id : reg.vehicle_id;
              const nombreLabel = tipo === "drivers" ? reg.nombre : reg.placa;
              const diasActivos = (calendario && calendario[key]) || new Set();
              const diasTrabajados = diasActivos.size || 0;
              
              return (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 12px", fontSize: 11, color: "#0f172a", fontFamily: "monospace", position: "sticky", left: 0, background: "#fff", zIndex: 1, fontWeight: 600 }}>
                    {idLabel || "—"}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 11, color: "#0f172a", whiteSpace: "nowrap", position: "sticky", left: 80, background: "#fff", zIndex: 1, fontWeight: 500 }}>
                    {nombreLabel}
                    <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>
                      {diasTrabajados} {diasTrabajados === 1 ? "día" : "días"} activo
                    </div>
                  </td>
                  {dias.map(d => {
                    const trabajo = diasActivos.has(d);
                    return (
                      <td key={d} style={{ padding: "4px 2px", textAlign: "center" }}>
                        <div style={{
                          width: 18, height: 18, margin: "0 auto",
                          background: trabajo ? "#10b981" : "transparent",
                          border: trabajo ? "1px solid #059669" : "1px solid #e4e7ec",
                          borderRadius: 3,
                        }} title={trabajo ? `Trabajó el ${d}` : `No trabajó el ${d}`}></div>
                      </td>
                    );
                  })}
                  <td style={{ padding: "8px 12px", textAlign: "center", position: "sticky", right: 0, background: "#fff", zIndex: 1 }}>
                    <button onClick={() => onVerDetalle(reg)}
                      style={{ padding: "4px 10px", fontSize: 10, fontWeight: 600, border: "1px solid #1a3a6b",
                        borderRadius: 4, background: "#fff", color: "#1a3a6b", cursor: "pointer",
                        fontFamily: "'Geist', sans-serif" }}>
                      Ver
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "10px 16px", borderTop: "1px solid #f1f5f9", background: "#fafbfc", display: "flex", gap: 16, alignItems: "center", fontSize: 10, color: "#64748b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 12, height: 12, background: "#10b981", border: "1px solid #059669", borderRadius: 2 }}></div>
          Trabajó / Usado
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 12, height: 12, border: "1px solid #e4e7ec", borderRadius: 2 }}></div>
          Sin actividad
        </div>
        <span style={{ marginLeft: "auto" }}>{registros.length} {tipo === "drivers" ? "drivers" : "vehículos"} mostrados</span>
      </div>
    </div>
  );
}

function PoolMeliDetalleRegistro({ tipo, registro, onVolver }) {
  const [extra, setExtra] = useState(null); // info adicional cargada (viajes, anomalías de tipo)
  const [loadingExtra, setLoadingExtra] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingExtra(true);
      try {
        if (tipo === "driver") {
          const { data } = await sb.from("meli_carrier_metricas")
            .select("fecha, service_center, placa, vehiculo, envios_despachados, envios_entregados, entrega_exitosa, dpph, orh_horas_ruta, kilometros_recorridos")
            .eq("nombre_transportista", registro.nombre)
            .order("fecha", { ascending: false })
            .limit(100);
          if (alive) setExtra({ viajes: data || [] });
        } else {
          // Vehículo: cargar viajes + chequeo de anomalía de tipo
          const [rViajes, rAnom] = await Promise.all([
            sb.from("meli_carrier_metricas")
              .select("fecha, service_center, nombre_transportista, vehiculo, envios_despachados, envios_entregados, entrega_exitosa, dpph")
              .eq("placa", registro.placa)
              .order("fecha", { ascending: false })
              .limit(100),
            sb.from("vw_meli_placas_anomalia_tipo")
              .select("*")
              .eq("placa", registro.placa)
          ]);
          if (alive) setExtra({ viajes: rViajes.data || [], anomalias: rAnom.data || [] });
        }
      } catch (e) {
        console.error("Error cargando detalle:", e);
        if (alive) setExtra({ viajes: [], anomalias: [] });
      } finally {
        if (alive) setLoadingExtra(false);
      }
    })();
    return () => { alive = false; };
  }, [tipo, registro]);

  return (
    <div style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onVolver} className="btn-back">
            ← Volver al inventario
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>
            {tipo === "driver" ? registro.nombre : `Placa ${registro.placa}`}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {tipo === "driver" ? `Driver ID: ${registro.driver_id || "—"}` : `Vehicle ID: ${registro.vehicle_id || "—"} · Tipo: ${registro.tipo || "—"}`}
          </div>
        </div>
      </div>

      <div className="pg">
        {/* KPIs del registro */}
        {tipo === "driver" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
            <PoolMeliKpi label="Categoría" value={(registro.categoria || "—").toUpperCase()} sublabel={registro.en_master ? "En master oficial" : "Sin master (FANTASMA)"} 
                         danger={registro.categoria === "fantasma"} />
            <PoolMeliKpi label="Viajes ejecutados" value={registro.viajes_total || 0} sublabel={`${registro.dias_trabajados || 0} días trabajados`} color="#047857" />
            <PoolMeliKpi label="DPPH promedio" value={registro.dpph_promedio?.toFixed?.(1) || "—"} sublabel="paquetes/hora" />
            <PoolMeliKpi label="Entrega exitosa" value={`${registro.entrega_exitosa_pct?.toFixed?.(1) || "—"}%`} sublabel={registro.entrega_exitosa_pct >= 95 ? "Excelente" : "Atención"} 
                         color={registro.entrega_exitosa_pct >= 95 ? "#047857" : "#92400e"} />
            <PoolMeliKpi label="SCs operados" value={registro.cantidad_scs || 0} sublabel={registro.scs_operados || "—"} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
            <PoolMeliKpi label="Categoría" value={(registro.categoria || "—").toUpperCase()} sublabel={registro.en_master ? "En master oficial" : "Sin master (FANTASMA)"} 
                         danger={registro.categoria === "fantasma"} />
            <PoolMeliKpi label="Tipo (master)" value={registro.tipo || "—"} sublabel={registro.es_sdd ? "Es SDD" : "Estándar"} />
            <PoolMeliKpi label="Capacidad" value={`${registro.capacidad || "—"} m³`} sublabel="Según master Meli" />
            <PoolMeliKpi label="Viajes" value={registro.viajes_total || 0} sublabel={`${registro.dias_usado || 0} días usado`} color="#047857" />
            <PoolMeliKpi label="Drivers distintos" value={registro.drivers_distintos || 0} sublabel={registro.drivers_distintos > 1 ? "Compartido" : "Dedicado"} />
          </div>
        )}

        {/* Anomalías de tipo (solo vehículos) */}
        {tipo === "vehiculo" && extra && extra.anomalias && extra.anomalias.length > 0 && (
          <div className="form-card" style={{ background: "#fffbeb", border: "1px solid #fde68a", marginBottom: 16 }}>
            <div className="form-title" style={{ color: "#92400e" }}>⚠ Anomalía de tipo de vehículo detectada</div>
            <div style={{ fontSize: 12, color: "#78350f", marginBottom: 12, lineHeight: 1.5 }}>
              Esta placa fue registrada con <strong>{extra.anomalias.length} tipos diferentes</strong> en distintos viajes. 
              Posibles causas: error de carga, recambio físico, o reasignación de placa.
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #fde68a" }}>
                    <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#78350f", textTransform: "uppercase" }}>Tipo observado</th>
                    <th style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: "#78350f", textTransform: "uppercase" }}>Viajes</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#78350f", textTransform: "uppercase" }}>Primera</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#78350f", textTransform: "uppercase" }}>Última</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#78350f", textTransform: "uppercase" }}>Tipo en master</th>
                    <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#78350f", textTransform: "uppercase" }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {extra.anomalias.map((a, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #fef3c7" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600 }}>{a.tipo_observado}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>{a.viajes_con_este_tipo}</td>
                      <td style={{ padding: "6px 10px" }}>{a.primera_aparicion}</td>
                      <td style={{ padding: "6px 10px" }}>{a.ultima_aparicion}</td>
                      <td style={{ padding: "6px 10px" }}>{a.tipo_master || "—"}</td>
                      <td style={{ padding: "6px 10px", textAlign: "center" }}>
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, fontWeight: 700,
                          background: a.estado_vs_master === "COINCIDE" ? "#dcfce7" : a.estado_vs_master === "PLACA_FANTASMA" ? "#fee2e2" : "#fef3c7",
                          color: a.estado_vs_master === "COINCIDE" ? "#15803d" : a.estado_vs_master === "PLACA_FANTASMA" ? "#991b1b" : "#92400e" }}>
                          {a.estado_vs_master}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Lista de viajes */}
        <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
            <div className="form-title" style={{ marginBottom: 4 }}>
              {tipo === "driver" ? "Historial de viajes ejecutados" : "Historial de viajes con esta placa"}
            </div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              {loadingExtra ? "Cargando..." : `${extra?.viajes?.length || 0} viajes (últimos 100)`}
            </div>
          </div>
          
          {!loadingExtra && extra && (
            <div style={{ overflowX: "auto", maxHeight: 500 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#f8fafc" }}>
                  <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Fecha</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>SC</th>
                    {tipo === "driver" ? (
                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Placa</th>
                    ) : (
                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Driver</th>
                    )}
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Vehículo</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Despach.</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Entreg.</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>% éxito</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>DPPH</th>
                  </tr>
                </thead>
                <tbody>
                  {(extra.viajes || []).map((v, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "7px 12px", fontFamily: "monospace" }}>{v.fecha}</td>
                      <td style={{ padding: "7px 12px", fontWeight: 600 }}>{v.service_center}</td>
                      <td style={{ padding: "7px 12px", fontFamily: "monospace" }}>{tipo === "driver" ? v.placa : v.nombre_transportista}</td>
                      <td style={{ padding: "7px 12px", color: "#64748b" }}>{v.vehiculo}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v.envios_despachados}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v.envios_entregados}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: v.entrega_exitosa >= 95 ? "#047857" : "#92400e", fontWeight: 600 }}>{v.entrega_exitosa?.toFixed?.(1)}%</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v.dpph?.toFixed?.(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default IndicadoresOperacionalesMX;
