import { useState, useEffect, useMemo } from "react";
import { sb, fechaHoyOperativa, fechaOperativaOffset, Input, KpiCardMaestro, BadgeEstadoMaestro } from "./shared";

const VistaViajesMaestro = ({ fecha, fechaFin, pais, onFechaChange }) => {
  const [viajes, setViajes]     = useState([]);
  const [ayudantesMap, setAyudantesMap] = useState({});  // {id_ruta: has_helper}
  const [loading, setLoading]   = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina]     = useState(1);
  const resetPagina = () => setPagina(1);
  const [orden, setOrden]       = useState({ col: "fecha_salida", asc: false });
  const POR_PAGINA = 20;

  // ─── Refresh desde MELI (NUEVO) ───────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [refreshMensaje, setRefreshMensaje] = useState(null);

  // Calcular fecha D-1 MX (formato YYYY-MM-DD)
  // MX es UTC-6, así que tomamos ahora UTC y restamos 6h, luego 24h más
  const calcularFechaD1MX = () => {
    const ahora = new Date();
    const ahoraMX = new Date(ahora.getTime() - 6 * 60 * 60 * 1000);
    const ayerMX = new Date(ahoraMX.getTime() - 24 * 60 * 60 * 1000);
    return ayerMX.toISOString().slice(0, 10);
  };
  const fechaD1MX = calcularFechaD1MX();

  const refrescarDesdeMELI = async () => {
    setShowConfirm(false);
    setRefreshing(true);
    setRefreshMensaje(null);
    // Guardamos la fecha que vamos a refrescar (la del calendario actual)
    const fechaARefrescar = fecha;
    try {
      // Llamar al webhook n8n con la fecha del calendario
      // n8n pasa esa fecha al VPS, que descarga ese día específico desde MELI
      const r = await fetch("https://bigticket2026.app.n8n.cloud/webhook/refresh-maestros-meli", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-secret": "bigticket-secret-2025",
        },
        body: JSON.stringify({ fecha: fechaARefrescar }),
      });

      if (!r.ok) {
        throw new Error(`n8n respondió HTTP ${r.status}`);
      }

      const resultado = await r.json();

      if (!resultado.ok) {
        const motivos = {
          no_autorizado: "Header de autenticación inválido",
          sesion_expirada: "Sesión MELI expirada. Renová la sesión antes de refrescar.",
          timeout: "El scrape no terminó a tiempo. Reintentá en un momento.",
        };
        throw new Error(resultado.mensaje || motivos[resultado.motivo] || "Error desconocido");
      }

      // Éxito: mantenemos la fecha refrescada en el calendario y recargamos
      // (si el padre tiene onFechaChange, lo llamamos para asegurar la sincronización)
      if (onFechaChange) onFechaChange(fechaARefrescar);
      const kb = resultado.resultado?.kb ? ` (${resultado.resultado.kb} KB)` : "";
      setRefreshMensaje({ tipo: "ok", texto: `✅ Datos del ${fechaARefrescar} actualizados desde MELI${kb}` });
      setTimeout(() => setRefreshMensaje(null), 5000);
    } catch (err) {
      console.error("Error en refresh MELI:", err);
      setRefreshMensaje({ tipo: "error", texto: `❌ ${err.message || String(err)}` });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { cargarViajes(); }, [fecha, fechaFin]);

  const cargarViajes = async () => {
    setLoading(true);
    let q = sb.from("viajes")
      .select("*, drivers(nombre, rut), rutas(nombre, zona)")
      .order("fecha_salida", { ascending: false })
      .limit(500);
    if (fecha) {
      const fechaStr = fecha.substring(0, 10);
      const finStr   = (fechaFin || fecha).substring(0, 10);
      q = q.gte("fecha_salida", fechaStr + "T00:00:00Z").lte("fecha_salida", finStr + "T23:59:59Z");
    }
    if (pais) q = q.eq("pais", pais);
    const { data } = await q;
    setViajes(data || []);
    
    // Cargar info de ayudantes desde logistic_ayudantes_snapshots (solo para MX)
    if (pais === "MX" && fecha) {
      try {
        const fechaStr = fecha.substring(0, 10);
        const finStr   = (fechaFin || fecha).substring(0, 10);
        const { data: ayudData } = await sb
          .from("logistic_ayudantes_snapshots")
          .select("id_ruta, has_helper, hora_snapshot, momento_dia")
          .gte("fecha", fechaStr)
          .lte("fecha", finStr);
        // Tomar el ÚLTIMO snapshot del día por id_ruta (el que tiene info más completa)
        const map = {};
        (ayudData || []).forEach(r => {
          const prev = map[r.id_ruta];
          // Si no hay previo o el actual es más reciente → guardar
          if (!prev || (r.hora_snapshot || "") > (prev.hora_snapshot || "")) {
            map[r.id_ruta] = { has_helper: r.has_helper, hora_snapshot: r.hora_snapshot };
          }
        });
        // Extraer solo has_helper para mapa final
        const finalMap = {};
        Object.keys(map).forEach(k => { finalMap[k] = map[k].has_helper; });
        setAyudantesMap(finalMap);
      } catch (e) {
        console.error("Error cargando ayudantes:", e);
        setAyudantesMap({});
      }
    } else {
      setAyudantesMap({});
    }
    setLoading(false);
  };

  const filtrados = viajes.filter(v => {
    if (!busqueda) return true;
    const b = busqueda.toLowerCase();
    const raw = v.tms_raw || {};
    return (
      (v.tms_id || "").toLowerCase().includes(b) ||
      (raw["Nombre del transportista"] || v.observaciones || "").toLowerCase().includes(b) ||
      (raw["Patente"] || "").toLowerCase().includes(b) ||
      (raw["Service center"] || "").toLowerCase().includes(b) ||
      (v.estado || "").toLowerCase().includes(b)
    );
  });

  // Ordenamiento
  const ordenados = [...filtrados].sort((a, b) => {
    const rawA = a.tms_raw || {}, rawB = b.tms_raw || {};
    let va, vb;
    if (orden.col === "fecha_salida")       { va = a.fecha_salida; vb = b.fecha_salida; }
    else if (orden.col === "driver")        { va = rawA["Nombre del transportista"] || ""; vb = rawB["Nombre del transportista"] || ""; }
    else if (orden.col === "entregados")    { va = a.paquetes_entregados || 0; vb = b.paquetes_entregados || 0; }
    else if (orden.col === "eficiencia")    { va = rawA["Entrega exitosa"] || 0; vb = rawB["Entrega exitosa"] || 0; }
    else if (orden.col === "km")            { va = a.km_recorridos || 0; vb = b.km_recorridos || 0; }
    else { va = a[orden.col] || ""; vb = b[orden.col] || ""; }
    if (va < vb) return orden.asc ? -1 : 1;
    if (va > vb) return orden.asc ? 1 : -1;
    return 0;
  });

  const totalPaginas = Math.ceil(ordenados.length / POR_PAGINA);
  const paginados    = ordenados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  const toggleOrden = (col) => {
    setPagina(1);
    setOrden(prev => ({ col, asc: prev.col === col ? !prev.asc : true }));
  };

  const totalCargados   = filtrados.reduce((s, v) => s + (v.paquetes_asignados || 0), 0);
  const totalEntregados = filtrados.reduce((s, v) => s + (v.paquetes_entregados || 0), 0);
  const totalDevueltos  = filtrados.reduce((s, v) => s + (v.paquetes_devueltos || 0), 0);
  const efTotal         = totalCargados > 0 ? totalEntregados / totalCargados : null;
  const kmTotal         = filtrados.reduce((s, v) => s + (v.km_recorridos || 0), 0);
  const noVisitadosTotal = filtrados.reduce((s, v) => s + (v.tms_raw?.["No visitado"] || 0), 0);

  if (loading) return (
    <div style={{ textAlign: "center", padding: 48, color: "#888", fontSize: 13 }}>
      Cargando viajes...
    </div>
  );

  return (
    <div>
      {/* ─── Botón Refrescar desde MELI ─── */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginBottom: 12 }}>
        {refreshMensaje && (
          <span style={{
            fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 6,
            background: refreshMensaje.tipo === "ok" ? "#dcfce7" : "#fef2f2",
            color: refreshMensaje.tipo === "ok" ? "#166534" : "#991b1b",
            border: `1px solid ${refreshMensaje.tipo === "ok" ? "#86efac" : "#fca5a5"}`,
          }}>
            {refreshMensaje.texto}
          </span>
        )}
        <button onClick={() => setShowConfirm(true)} disabled={refreshing || pais !== "MX"}
          title={pais !== "MX" ? "Solo disponible para México" : "Descarga el reporte del cierre del día anterior MX"}
          style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid #3B82F6",
            background: refreshing ? "#9ca3af" : (pais !== "MX" ? "#cbd5e1" : "#3B82F6"),
            color: "#fff", fontSize: 12, fontWeight: 700,
            cursor: (refreshing || pais !== "MX") ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 6 }}>
          {refreshing ? "⏳ Descargando..." : "🔄 Refrescar desde MELI"}
        </button>
      </div>

      {/* ─── Dialog de confirmación ─── */}
      {showConfirm && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000,
        }} onClick={() => setShowConfirm(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 12, padding: 24, maxWidth: 480, width: "90%",
            boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
              🔄 Refrescar datos desde MELI
            </div>
            <div style={{ fontSize: 13, color: "#444", lineHeight: 1.55, marginBottom: 14 }}>
              Vas a refrescar los datos del <strong>{fecha}</strong> desde el portal MELI.
              <br /><br />
              Tarda aproximadamente <strong>~40 segundos</strong>. Mientras corre, no podés cerrar esta pestaña.
              {fecha === fechaD1MX && (
                <div style={{ marginTop: 10, padding: 10, background: "#dbeafe", border: "1px solid #60a5fa", borderRadius: 6, fontSize: 12 }}>
                  ℹ️ Estás refrescando el día anterior MX (cierre operativo más reciente).
                </div>
              )}
              {fecha !== fechaD1MX && (
                <div style={{ marginTop: 10, padding: 10, background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 6, fontSize: 12 }}>
                  ℹ️ Estás refrescando una fecha pasada. MELI debería tener el reporte histórico disponible.
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowConfirm(false)}
                style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #e4e7ec",
                  background: "#fff", color: "#555", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Cancelar
              </button>
              <button onClick={refrescarDesdeMELI}
                style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #3B82F6",
                  background: "#3B82F6", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Sí, refrescar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* KPIs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <KpiCardMaestro label="Viajes" valor={fmtNumMaestro(filtrados.length)} />
        <KpiCardMaestro label="Cargados" valor={fmtNumMaestro(totalCargados)} color="#3B82F6" />
        <KpiCardMaestro label="Entregados" valor={fmtNumMaestro(totalEntregados)} color="#16a34a" />
        <KpiCardMaestro label="Devueltos" valor={fmtNumMaestro(totalDevueltos)} color="#dc2626" />
        <KpiCardMaestro
          label="Eficiencia"
          valor={efTotal != null ? fmtPctMaestro(efTotal) : "—"}
          color={colorEfMaestro(efTotal)}
          sub={`${Math.round(kmTotal)} km recorridos`} />
      </div>

      {/* Buscador */}
      <div style={{ marginBottom: 12 }}>
        <Input value={busqueda} onChange={e => { setBusqueda(e.target.value); setPagina(1); }}
          placeholder="Buscar por driver, patente, service center..." />
      </div>

      {/* Tabla con DOBLE SCROLL HORIZONTAL — arriba y abajo, sincronizados */}
      <div style={{ position: "relative" }}>
        {/* Scroll superior (sticky, sigue al usuario al hacer scroll vertical) */}
        <div 
          id="maestro-scroll-top"
          onScroll={(e) => {
            const bottom = document.getElementById("maestro-scroll-bottom");
            if (bottom && bottom.scrollLeft !== e.target.scrollLeft) {
              bottom.scrollLeft = e.target.scrollLeft;
            }
          }}
          style={{ 
            overflowX: "auto", 
            overflowY: "hidden",
            borderRadius: "10px 10px 0 0",
            border: "1px solid #e4e7ec",
            borderBottom: "none",
            background: "#fff",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}>
          <div style={{ height: 1, minWidth: "1900px" }}/>
        </div>
        
        {/* Tabla real con scroll inferior */}
        <div 
          id="maestro-scroll-bottom"
          onScroll={(e) => {
            const top = document.getElementById("maestro-scroll-top");
            if (top && top.scrollLeft !== e.target.scrollLeft) {
              top.scrollLeft = e.target.scrollLeft;
            }
          }}
          style={{ 
            overflowX: "auto", 
            borderRadius: "0 0 10px 10px",
            border: "1px solid #e4e7ec",
            borderTop: "none",
            background: "#fff",
            WebkitOverflowScrolling: "touch" 
          }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: "1900px" }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e4e7ec" }}>
              {[
                { label: "ID Ruta",        col: null },
                { label: "Fecha",          col: "fecha_salida" },
                { label: "Driver",         col: "driver" },
                { label: "Ayudante",       col: null },
                { label: "Patente",        col: null },
                { label: "Vehículo",       col: null },
                { label: "Ciclo",          col: null },
                { label: "Despachados",    col: null },
                { label: "Entregados",     col: "entregados" },
                { label: "No visitados",   col: null },
                { label: "Eficiencia %",   col: "eficiencia" },
                { label: "KM",             col: "km" },
                { label: "Municipio",      col: null },
                { label: "Service center", col: null },
                { label: "ORH",            col: null },
                { label: "SPORH",          col: null },
                { label: "DPPH",           col: null },
                { label: "Estado",         col: null },
              ].map(({ label, col }) => (
                <th key={label}
                  onClick={col ? () => toggleOrden(col) : undefined}
                  style={{ padding: "10px 12px", textAlign: "left",
                    fontWeight: 800, fontSize: 10, textTransform: "uppercase",
                    letterSpacing: 0.5, color: col ? "#3B82F6" : "#555",
                    whiteSpace: "nowrap", cursor: col ? "pointer" : "default",
                    userSelect: "none" }}>
                  {label}{col && orden.col === col ? (orden.asc ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr><td colSpan={18} style={{ padding: 40, textAlign: "center",
                color: "#888", fontSize: 13 }}>
                {busqueda ? "Sin resultados para esa búsqueda" : "Sin viajes para esta fecha. Sincroniza el TMS."}
              </td></tr>
            )}
            {filtrados.map((v, i) => {
              const raw = v.tms_raw || {};
              const ef  = v.paquetes_asignados > 0
                ? v.paquetes_entregados / v.paquetes_asignados : null;
              const orh   = raw["ORH (Horas en ruta)"] != null
                ? Number(raw["ORH (Horas en ruta)"]).toFixed(2) : "—";
              const sporh = raw["SPORH (Número de paquetes despachados por hora)"] != null
                ? Number(raw["SPORH (Número de paquetes despachados por hora)"]).toFixed(1) : "—";
              const dpph  = raw["DPPH (Número de paquetes entregados por hora)"] != null
                ? Number(raw["DPPH (Número de paquetes entregados por hora)"]).toFixed(1) : "—";
              return (
                <tr key={v.id} style={{ borderBottom: "1px solid #f1f5f9",
                  background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ padding: "9px 12px", fontWeight: 700,
                    color: "#3B82F6", fontFamily: "monospace", fontSize: 11 }}>
                    {raw["Id de la ruta"] || v.tms_id}</td>
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap", fontSize: 11 }}>
                    {fmtFechaMaestro(v.fecha_salida)}</td>
                  <td style={{ padding: "9px 12px", fontWeight: 600 }}>
                    {raw["Nombre del transportista"] || v.observaciones || "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", fontSize: 11 }}>
                    {(() => {
                      const idRuta = raw["Id de la ruta"];
                      if (!idRuta || !(idRuta in ayudantesMap)) {
                        return <span style={{ color: "#cbd5e1" }}>—</span>;
                      }
                      const helper = ayudantesMap[idRuta];
                      return helper 
                        ? <span style={{ color: "#16a34a", fontWeight: 700 }}>Sí</span>
                        : <span style={{ color: "#94a3b8" }}>No</span>;
                    })()}
                  </td>
                  <td style={{ padding: "9px 12px", fontFamily: "monospace",
                    fontSize: 11, color: "#555" }}>
                    {raw["Patente"] || raw["Placa"] || "—"}</td>
                  <td style={{ padding: "9px 12px", fontSize: 11, color: "#555" }}>
                    {raw["Vehículo"] || "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", fontSize: 11 }}>
                    {raw["Ciclo"] || "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right" }}>
                    {fmtNumMaestro(v.paquetes_asignados)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right",
                    color: "#16a34a", fontWeight: 700 }}>
                    {fmtNumMaestro(v.paquetes_entregados)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right",
                    color: (raw["No visitado"] || 0) > 0 ? "#dc2626" : "#888" }}>
                    {raw["No visitado"] ?? "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right",
                    fontWeight: 800, color: colorEfMaestro(raw["Entrega exitosa"] != null ? raw["Entrega exitosa"] / 100 : null) }}>
                    {raw["Entrega exitosa"] != null
                      ? Number(raw["Entrega exitosa"]).toFixed(1) + "%" : "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11 }}>
                    {v.km_recorridos ? `${Number(v.km_recorridos).toFixed(1)} km` : "—"}</td>
                  <td style={{ padding: "9px 12px", fontSize: 11, color: "#555" }}>
                    {raw["Municipio visitado"] || "—"}</td>
                  <td style={{ padding: "9px 12px", fontSize: 11, color: "#555" }}>
                    {raw["Service center"] || "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11 }}>
                    {orh}h</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11 }}>
                    {sporh}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11 }}>
                    {dpph}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <BadgeEstadoMaestro estado={v.estado} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#888" }}>
            Mostrando {((pagina-1)*POR_PAGINA)+1}–{Math.min(pagina*POR_PAGINA, ordenados.length)} de {ordenados.length} viajes
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setPagina(1)} disabled={pagina === 1}
              style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #e4e7ec",
                background: pagina === 1 ? "#f8fafc" : "#fff", cursor: pagina === 1 ? "not-allowed" : "pointer",
                fontSize: 12, color: pagina === 1 ? "#ccc" : "#555" }}>«</button>
            <button onClick={() => setPagina(p => Math.max(1, p-1))} disabled={pagina === 1}
              style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #e4e7ec",
                background: pagina === 1 ? "#f8fafc" : "#fff", cursor: pagina === 1 ? "not-allowed" : "pointer",
                fontSize: 12, color: pagina === 1 ? "#ccc" : "#555" }}>‹</button>
            {Array.from({ length: Math.min(5, totalPaginas) }, (_, i) => {
              let p;
              if (totalPaginas <= 5) p = i + 1;
              else if (pagina <= 3) p = i + 1;
              else if (pagina >= totalPaginas - 2) p = totalPaginas - 4 + i;
              else p = pagina - 2 + i;
              return (
                <button key={p} onClick={() => setPagina(p)}
                  style={{ padding: "5px 10px", borderRadius: 6,
                    border: `1px solid ${pagina === p ? "#3B82F6" : "#e4e7ec"}`,
                    background: pagina === p ? "#3B82F6" : "#fff",
                    color: pagina === p ? "#fff" : "#555",
                    cursor: "pointer", fontSize: 12, fontWeight: pagina === p ? 700 : 400 }}>
                  {p}
                </button>
              );
            })}
            <button onClick={() => setPagina(p => Math.min(totalPaginas, p+1))} disabled={pagina === totalPaginas}
              style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #e4e7ec",
                background: pagina === totalPaginas ? "#f8fafc" : "#fff",
                cursor: pagina === totalPaginas ? "not-allowed" : "pointer",
                fontSize: 12, color: pagina === totalPaginas ? "#ccc" : "#555" }}>›</button>
            <button onClick={() => setPagina(totalPaginas)} disabled={pagina === totalPaginas}
              style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #e4e7ec",
                background: pagina === totalPaginas ? "#f8fafc" : "#fff",
                cursor: pagina === totalPaginas ? "not-allowed" : "pointer",
                fontSize: 12, color: pagina === totalPaginas ? "#ccc" : "#555" }}>»</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── MÓDULO MAESTRO PRINCIPAL ──────────────────────────────────────────────────
// ─── VISTA SNAPSHOT SUPERVISORES (NUEVO) ─────────────────────────────────
// Pestaña dentro de Maestro de Operaciones que replica las 4 pestañas operativas
// del Excel `Macro_Maestros_Mexico.xlsm` con datos automáticos de MELI.
// 4 sub-pestañas: Ingreso Maestro, Rutas Citadas, No Show, Devoluciones.
// Solo aplica a México (las vistas SQL son MX-only).
const VistaSnapshotSupervisores = ({ fecha, pais }) => {
  const [subTab, setSubTab] = useState("ingreso");
  const [scSel, setScSel]   = useState("TODOS");
  const [filas, setFilas]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  const [descargando, setDescargando] = useState(false);
  // Rango de fechas para la descarga Excel (por defecto = la fecha que se ve).
  // El componente se remonta al cambiar `fecha`, así que se resetea solo a la fecha vista.
  const [excelDesde, setExcelDesde] = useState(fecha);
  const [excelHasta, setExcelHasta] = useState(fecha);

  // Mapeo sub-pestaña → vista SQL
  const VISTAS = {
    ingreso:      { tabla: "vw_maestro_supervisores_auto", label: "Ingreso Maestro" },
    rutas:        { tabla: "vw_rutas_citadas_auto",        label: "Rutas Citadas"  },
    noshow:       { tabla: "vw_rostering_vs_operativo",    label: "No Show"        },
    devoluciones: { tabla: "vw_devoluciones_auto",         label: "Devoluciones"   },
  };

  // Cargar datos cuando cambia fecha o subTab
  useEffect(() => {
    if (pais !== "MX") { setFilas([]); return; }

    let cancelado = false;
    const cargar = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await sb
          .from(VISTAS[subTab].tabla)
          .select("*")
          .eq("fecha", fecha)
          .limit(5000);
        if (cancelado) return;
        if (err) {
          setError(err.message);
          setFilas([]);
        } else {
          setFilas(data || []);
        }
      } catch (e) {
        if (!cancelado) {
          setError(e.message || String(e));
          setFilas([]);
        }
      } finally {
        if (!cancelado) setLoading(false);
      }
    };
    cargar();
    return () => { cancelado = true; };
  }, [fecha, subTab, pais]);

  // SCs disponibles dinámicos (extraídos de los datos)
  const scsDisponibles = useMemo(() => {
    const set = new Set();
    filas.forEach(f => {
      const sc = f.service_center_id || f.sc;
      if (sc) set.add(sc);
    });
    return ["TODOS", ...Array.from(set).sort()];
  }, [filas]);

  // Aplicar filtro SC
  const filasFiltradas = useMemo(() => {
    if (scSel === "TODOS") return filas;
    return filas.filter(f => (f.service_center_id || f.sc) === scSel);
  }, [filas, scSel]);

  // ═══════════════════════════════════════════════════════════════════════
  // DESCARGA EXCEL — Genera archivo con 4 hojas matching el Macro original
  // SIEMPRE exporta TODOS los SCs (ignora filtro scSel) y descarga las 4 hojas
  // independiente de la sub-pestaña activa.
  // ═══════════════════════════════════════════════════════════════════════
  const descargarExcel = async () => {
    if (pais !== "MX") return;
    if (!excelDesde || !excelHasta) { alert("Elegí el rango de fechas para el Excel."); return; }
    setDescargando(true);
    try {
      // Cargar SheetJS dinámicamente desde CDN
      if (!window.XLSX) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      // Normalizar el rango por si lo invierten (desde > hasta)
      const desde = excelDesde <= excelHasta ? excelDesde : excelHasta;
      const hasta = excelHasta >= excelDesde ? excelHasta : excelDesde;

      // Cargar las 4 vistas en paralelo POR RANGO (siempre todas, sin filtro SC)
      const [
        { data: dIng, error: eIng },
        { data: dRut, error: eRut },
        { data: dNS,  error: eNS  },
        { data: dDev, error: eDev },
      ] = await Promise.all([
        sb.from("vw_maestro_supervisores_auto").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha").limit(100000),
        sb.from("vw_rutas_citadas_auto").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha").limit(100000),
        sb.from("vw_rostering_vs_operativo").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha").limit(100000),
        sb.from("vw_devoluciones_auto").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha").limit(100000),
      ]);

      if (eIng || eRut || eNS || eDev) {
        alert("Error al cargar datos: " + (eIng?.message || eRut?.message || eNS?.message || eDev?.message));
        setDescargando(false);
        return;
      }

      const wb = window.XLSX.utils.book_new();

      // ─── Hoja 1: Ingreso Maestro ───
      // Columnas EXACTAS del Excel original
      const hojaIngreso = (dIng || []).map(f => ({
        "SERVICIO":           f.servicio || "UM",
        "CECOS":              f.cecos,
        "FECHA":              f.fecha,
        "IDVIAJE":            f.idviaje,
        "PATENTES":           f.patentes,
        "TIPO DE VEHICULO":   f.tipo_vehiculo,
        "CARGADOS":           f.cargados,
        "ENTREGADOS":         f.entregados,
        "DEVUELTOS":          f.devueltos,
        "RANGO KILOMETRAJE":  f.rango_kilometraje,
        "KM REAL MELI":       f.km_recorridos_meli != null ? f.km_recorridos_meli : "",
        "TIPO DE RUTA":       f.tipo_ruta,
        "¿CON AYUDANTE?":     f.con_ayudante,
        "NOMBRE DE AYUDANTE": f.nombre_ayudante || "",
        "% HELPER":           f.pct_helper != null ? f.pct_helper : "",
        "% POR PERSONA":      f.pct_por_persona || "",
        "IDs PERSONAS":       f.ids_personas || "",
        "ALERTAS HELPER":     (f.alertas_helper || []).join(" · "),
        "% VISITADO":         f.pct_visitado,
        "% NO VISITADO REAL": f.pct_no_visitado_real != null ? f.pct_no_visitado_real : "",
        "NO VISITADOS REAL":  f.no_visitados_real != null ? f.no_visitados_real : "",
        "OBSERVACIONES":      f.observaciones_auto || "",
      }));
      const wsIng = window.XLSX.utils.json_to_sheet(hojaIngreso);
      window.XLSX.utils.book_append_sheet(wb, wsIng, "Ingreso Maestro");

      // ─── Hoja 2: Rutas citadas ───
      const hojaRutas = (dRut || []).map(f => ({
        "FECHA":                  f.fecha,
        "CECOS":                  f.cecos,
        "RUTAS PLANEADAS":        f.rutas_planeadas,
        "RUTAS_SMALL_PLANEADAS":  f.small_planeadas,
        "RUTAS_LARGE_PLANEADAS":  f.large_planeadas,
        "RUTAS EJECUTADAS":       f.rutas_ejecutadas,
        "CANT SMALL":             f.cant_small,
        "CANT LARGE":             f.cant_large,
      }));
      const wsRut = window.XLSX.utils.json_to_sheet(hojaRutas);
      window.XLSX.utils.book_append_sheet(wb, wsRut, "Rutas citadas");

      // ─── Hoja 3: No Show · Rostering vs Operativo ───
      // 1 fila por driver+fecha con su diagnóstico (NO SHOW / PARCIAL / CAMBIO PLACA / OK)
      // Orden: NO_SHOW > CAMBIO_PLACA > PARCIAL > OK, después SC + driver
      const ordenCat = { NO_SHOW: 1, CAMBIO_PLACA: 2, PARCIAL: 3, OK: 4, OTRO: 5 };
      const labelCat = {
        NO_SHOW:      "🚨 NO SHOW",
        CAMBIO_PLACA: "🔄 CAMBIO PLACA",
        PARCIAL:      "⚠️ PARCIAL",
        OK:           "✅ OK",
      };
      const hojaNS = [...(dNS || [])]
        .sort((a, b) => {
          const oa = ordenCat[a.categoria] || 9;
          const ob = ordenCat[b.categoria] || 9;
          if (oa !== ob) return oa - ob;
          if (a.facility !== b.facility) return (a.facility || "").localeCompare(b.facility || "");
          return (a.driver_name || "").localeCompare(b.driver_name || "");
        })
        .map(f => ({
          "FECHA":                f.fecha,
          "SC":                   f.facility,
          "DRIVER":               f.driver_name || "",
          "DRIVER_ID":            f.driver_id || "",
          "CURP":                 f.driver_curp || "",
          "ESTADO":               labelCat[f.categoria] || f.categoria || "",
          "PLACAS_PLANIFICADAS":  f.placas_planificadas_detalle || "",
          "PLACAS_OPERADAS":      f.placas_operadas_detalle || "— sin operar —",
          "CARGADOS":             f.total_cargados || 0,
          "ENTREGADOS":           f.total_entregados || 0,
          "DEVUELTOS":            f.total_devueltos || 0,
          "PCT_ENTREGA":          f.pct_entregado != null ? Number(f.pct_entregado) : null,
          "SERVICIOS":            f.servicios_detalle || "",
          "PRIMER_ETA":           f.primer_eta || "",
          "ULTIMO_ETA":           f.ultimo_eta || "",
          "DIAGNOSTICO":          f.diagnostico || "",
        }));
      const wsNS = window.XLSX.utils.json_to_sheet(hojaNS.length > 0 ? hojaNS :
        [{ "FECHA": "", "SC": "", "DRIVER": "", "DRIVER_ID": "", "CURP": "", "ESTADO": "",
           "PLACAS_PLANIFICADAS": "", "PLACAS_OPERADAS": "", "CARGADOS": "", "ENTREGADOS": "",
           "DEVUELTOS": "", "PCT_ENTREGA": "", "SERVICIOS": "", "PRIMER_ETA": "", "ULTIMO_ETA": "",
           "DIAGNOSTICO": "" }]);
      window.XLSX.utils.book_append_sheet(wb, wsNS, "Rostering vs Operativo");

      // ─── Hoja 4: Ingreso de devoluciones ───
      const hojaDev = (dDev || []).map(f => ({
        "FECHA":       f.fecha,
        "SC":          f.service_center_id || "",
        "ID_VIAJE":    f.id_viaje,
        "FOLIO_GUIAS": f.folio_guias,
        "PATENTE":     f.patente,
        "MOTIVO":      f.motivo,
        "DRIVER":      f.driver_name || "",
        "RECEPTOR":    f.receiver_name || "",
        "CP":          f.zip_code || "",
        "CIUDAD":      f.city || "",
        "ESTADO":      f.state || "",
        "COMENTARIOS": f.comentarios || "",
      }));
      const wsDev = window.XLSX.utils.json_to_sheet(hojaDev.length > 0 ? hojaDev :
        [{ "FECHA": "", "SC": "", "ID_VIAJE": "", "FOLIO_GUIAS": "", "PATENTE": "", "MOTIVO": "",
           "DRIVER": "", "RECEPTOR": "", "CP": "", "CIUDAD": "", "ESTADO": "", "COMENTARIOS": "" }]);
      window.XLSX.utils.book_append_sheet(wb, wsDev, "Ingreso de devoluciones");

      // Ajustar anchos de columnas (estimado)
      const anchosIng = [10, 14, 12, 24, 12, 18, 10, 12, 10, 18, 14, 14, 22, 12, 40];
      wsIng["!cols"] = anchosIng.map(w => ({ wch: w }));
      const anchosRut = [12, 14, 18, 22, 22, 18, 12, 12];
      wsRut["!cols"] = anchosRut.map(w => ({ wch: w }));
      const anchosNS  = [12, 14, 12, 18, 14, 24];
      wsNS["!cols"]  = anchosNS.map(w => ({ wch: w }));
      const anchosDev = [12, 8, 22, 22, 12, 24, 18, 18, 8, 16, 10, 30];
      wsDev["!cols"] = anchosDev.map(w => ({ wch: w }));

      // Generar archivo y disparar descarga
      const nombreArchivo = `Macro_Maestros_Mexico_${desde === hasta ? desde : desde + "_a_" + hasta}.xlsx`;
      window.XLSX.writeFile(wb, nombreArchivo);
    } catch (err) {
      console.error("Error descargando Excel:", err);
      alert("Error al generar el Excel: " + (err.message || err));
    } finally {
      setDescargando(false);
    }
  };

  // País CL: mostrar mensaje
  if (pais !== "MX") {
    return (
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🇲🇽</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", marginBottom: 6 }}>
          Esta vista solo está disponible para México
        </div>
        <div style={{ fontSize: 13, color: "#888" }}>
          El Maestro Supervisores Snapshot se alimenta de scrapers MELI MX (Logistic + Travel Requests).
          <br />Para ver datos, cambiá el selector de país a 🇲🇽 México.
        </div>
      </div>
    );
  }

  const subTabs = [
    { id: "ingreso",      label: "Ingreso Maestro" },
    { id: "rutas",        label: "Rutas Citadas"  },
    { id: "noshow",       label: "No Show"        },
    { id: "devoluciones", label: "Devoluciones"   },
  ];

  return (
    <div>
      {/* Header: sub-tabs + botón descargar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16, borderBottom: "1px solid #e4e7ec", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 0 }}>
          {subTabs.map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              style={{ padding: "8px 18px", background: "none", border: "none",
                borderBottom: subTab === t.id ? "2px solid #3B82F6" : "2px solid transparent",
                color: subTab === t.id ? "#3B82F6" : "#666",
                fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Excel · rango:</span>
          <input type="date" value={excelDesde} onChange={e => setExcelDesde(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid #e4e7ec", fontSize: 12, color: "#1a1a1a" }} />
          <span style={{ fontSize: 11, color: "#888" }}>a</span>
          <input type="date" value={excelHasta} onChange={e => setExcelHasta(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid #e4e7ec", fontSize: 12, color: "#1a1a1a" }} />
          <button onClick={descargarExcel} disabled={descargando}
            style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid #16a34a",
              background: descargando ? "#9ca3af" : "#16a34a", color: "#fff",
              fontSize: 12, fontWeight: 700, cursor: descargando ? "wait" : "pointer",
              display: "flex", alignItems: "center", gap: 6 }}>
            {descargando ? "⏳ Generando..." : "📥 Descargar Excel"}
          </button>
        </div>
      </div>

      {/* Filtro SC */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Filtrar SC:
        </span>
        <select value={scSel} onChange={e => setScSel(e.target.value)}
          style={{ padding: "5px 10px", borderRadius: 4, border: "1px solid #e4e7ec",
            fontSize: 12, fontWeight: 600, color: "#1a1a1a", background: "#fff",
            cursor: "pointer", minWidth: 140 }}>
          {scsDisponibles.map(sc => (
            <option key={sc} value={sc}>{sc === "TODOS" ? "Todos los SCs" : sc}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: "#888", marginLeft: 4 }}>
          {loading ? "Cargando..." : `${filasFiltradas.length} filas`}
        </span>
        <span style={{ fontSize: 10, color: "#888", marginLeft: "auto", fontStyle: "italic" }}>
          (El Excel descargado siempre incluye TODOS los SCs)
        </span>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b",
          padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
          Error: {error}
        </div>
      )}

      {/* Sub-componente activo */}
      {subTab === "ingreso"      && <SnapIngresoMaestro filas={filasFiltradas} loading={loading} />}
      {subTab === "rutas"        && <SnapRutasCitadas   filas={filasFiltradas} loading={loading} />}
      {subTab === "noshow"       && <SnapNoShow         filas={filasFiltradas} loading={loading} />}
      {subTab === "devoluciones" && <SnapDevoluciones   filas={filasFiltradas} loading={loading} />}
    </div>
  );
};

// ─── Helpers Snapshot ─────────────────────────────────────────
const fmtNumSnap = (v) => (v == null ? "—" : Number(v).toLocaleString("es-MX"));
const fmtPctSnap = (v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const KpiSnap = ({ label, valor, color = "#1a1a1a", sub }) => (
  <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10,
    padding: "12px 14px", flex: 1, minWidth: 120 }}>
    <div style={{ fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
      {label}
    </div>
    <div style={{ fontSize: 20, fontWeight: 800, color }}>{valor}</div>
    {sub && <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{sub}</div>}
  </div>
);

// ─── Sub-componente 1: Ingreso Maestro (1 fila por viaje) ───
const SnapIngresoMaestro = ({ filas, loading }) => {
  const kpis = useMemo(() => {
    const total = filas.length;
    const cargados = filas.reduce((acc, f) => acc + (f.cargados || 0), 0);
    const entregados = filas.reduce((acc, f) => acc + (f.entregados || 0), 0);
    const devueltos = filas.reduce((acc, f) => acc + (f.devueltos || 0), 0);
    const pct = cargados > 0 ? (entregados / cargados) * 100 : null;
    const sdds = filas.filter(f => f.es_sdd === "SI").length;
    return { total, cargados, entregados, devueltos, pct, sdds };
  }, [filas]);

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <KpiSnap label="Viajes" valor={fmtNumSnap(kpis.total)} sub={`${kpis.sdds} SDD`} />
        <KpiSnap label="Cargados"   valor={fmtNumSnap(kpis.cargados)}   color="#3B82F6" />
        <KpiSnap label="Entregados" valor={fmtNumSnap(kpis.entregados)} color="#16a34a" />
        <KpiSnap label="Devueltos"  valor={fmtNumSnap(kpis.devueltos)}  color="#dc2626" />
        <KpiSnap label="% Entrega"  valor={fmtPctSnap(kpis.pct)}
          color={kpis.pct >= 95 ? "#16a34a" : kpis.pct >= 90 ? "#ca8a04" : "#dc2626"} />
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto", maxHeight: 600 }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 13 }}>Cargando...</div>
        ) : filas.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 13 }}>Sin datos para esta fecha</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
              <tr>
                {["Fecha","ID Viaje","CECOS","Patente","Tipo Veh.","SDD","Tipo Ruta","Driver","Helper","Nombre Helper","% Helper","% por Persona","IDs Personas","Alertas","Cargados","Entregados","Devueltos","KM Plan","KM Real","Rango KM","%","% No Vis. Real","Status","Obs"].map(h => (
                  <th key={h} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 700, color: "#666", borderBottom: "1px solid #e4e7ec", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px" }}>{f.fecha}</td>
                  <td style={{ padding: "6px", fontFamily: "monospace" }}>{f.idviaje}</td>
                  <td style={{ padding: "6px" }}>{f.cecos}</td>
                  <td style={{ padding: "6px", fontFamily: "monospace" }}>{f.patentes}</td>
                  <td style={{ padding: "6px" }}>{f.tipo_vehiculo}</td>
                  <td style={{ padding: "6px", fontWeight: 700,
                    color: f.es_sdd === "SI" ? "#16a34a" : "#888" }}>{f.es_sdd}</td>
                  <td style={{ padding: "6px" }}>{f.tipo_ruta}</td>
                  <td style={{ padding: "6px" }}>{f.driver_name || "—"}</td>
                  <td style={{ padding: "6px", fontWeight: 700,
                    color: f.con_ayudante === "SI" ? "#16a34a" : "#888" }}>{f.con_ayudante || "—"}</td>
                  <td style={{ padding: "6px", fontSize: 10, maxWidth: 280, color: "#1a1a1a" }}>
                    {(() => {
                      const nh = f.nombre_ayudante || "—";
                      if (nh === "—") return "—";
                      if (nh.startsWith("📵")) return <span style={{ color: "#475569", fontStyle: "italic" }}>{nh}</span>;
                      if (nh.startsWith("⚪")) return <span style={{ color: "#94a3b8", fontStyle: "italic" }}>{nh}</span>;
                      if (nh.includes("⚠️ Chofer")) return <span style={{ color: "#dc2626" }}>{nh}</span>;
                      if (nh.includes("⚠️ Investigar")) return <span style={{ color: "#b45309" }}>{nh}</span>;
                      return nh;
                    })()}
                  </td>
                  <td style={{ padding: "6px", textAlign: "right", fontWeight: 700 }}>
                    {f.con_ayudante === "SI" && f.pct_helper != null ? (
                      <span style={{
                        background: f.pct_helper >= 90 ? "#fee2e2" : f.pct_helper >= 60 ? "#fef3c7" : f.pct_helper > 0 ? "#dcfce7" : "#f1f5f9",
                        color: f.pct_helper >= 90 ? "#dc2626" : f.pct_helper >= 60 ? "#b45309" : f.pct_helper > 0 ? "#15803d" : "#64748b",
                        padding: "2px 8px", borderRadius: 6, fontSize: 10, display: "inline-block", minWidth: 36, textAlign: "center"
                      }}>{f.pct_helper}%</span>
                    ) : (
                      <span style={{ color: "#cbd5e1" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "6px", fontSize: 10, fontFamily: "monospace", color: "#1a1a1a", whiteSpace: "nowrap" }}>
                    {f.pct_por_persona ? f.pct_por_persona : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={{ padding: "6px", fontSize: 9, fontFamily: "monospace", color: "#64748b", maxWidth: 200, wordBreak: "break-all" }}>
                    {f.ids_personas ? f.ids_personas : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={{ padding: "6px", fontSize: 10 }}>
                    {f.alertas_helper && f.alertas_helper.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {f.alertas_helper.map((a, idx) => {
                          const isRojo = a.includes("Helper >90") || a.includes("Multi-ID");
                          const isNaranja = a.includes("Investigar") || a.includes("3+ personas");
                          const isGris = a.includes("invisible");
                          return (
                            <span key={idx} style={{
                              background: isRojo ? "#fee2e2" : isNaranja ? "#fef3c7" : isGris ? "#f1f5f9" : "#e0e7ff",
                              color: isRojo ? "#dc2626" : isNaranja ? "#b45309" : isGris ? "#475569" : "#4338ca",
                              padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600, whiteSpace: "nowrap"
                            }}>{a}</span>
                          );
                        })}
                      </div>
                    ) : (
                      <span style={{ color: "#cbd5e1" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{fmtNumSnap(f.cargados)}</td>
                  <td style={{ padding: "6px", textAlign: "right", color: "#16a34a", fontWeight: 600 }}>{fmtNumSnap(f.entregados)}</td>
                  <td style={{ padding: "6px", textAlign: "right", color: "#dc2626" }}>{fmtNumSnap(f.devueltos)}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{fmtNumSnap(f.km_planificados)}</td>
                  <td style={{ padding: "6px", textAlign: "right", color: "#0369a1", fontWeight: 600 }}>
                    {f.km_recorridos_meli != null ? fmtNumSnap(f.km_recorridos_meli) : "—"}
                  </td>
                  <td style={{ padding: "6px" }}>{f.rango_kilometraje}</td>
                  <td style={{ padding: "6px", textAlign: "right", fontWeight: 600,
                    color: f.pct_visitado >= 95 ? "#16a34a" : f.pct_visitado >= 90 ? "#ca8a04" : "#dc2626" }}>
                    {fmtPctSnap(f.pct_visitado)}
                  </td>
                  <td style={{ padding: "6px", textAlign: "right", fontWeight: 700,
                    color: f.pct_no_visitado_real == null ? "#cbd5e1" : f.pct_no_visitado_real <= 0.5 ? "#16a34a" : f.pct_no_visitado_real <= 5 ? "#ca8a04" : "#dc2626" }}>
                    {f.pct_no_visitado_real != null ? fmtPctSnap(f.pct_no_visitado_real) : "—"}
                  </td>
                  <td style={{ padding: "6px" }}>{f.status_final}</td>
                  <td style={{ padding: "6px", fontSize: 10, color: "#888", maxWidth: 200 }}>{f.observaciones_auto || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ─── Sub-componente 2: Rutas Citadas (SC × día) ───
const SnapRutasCitadas = ({ filas, loading }) => {
  const kpis = useMemo(() => {
    const planeadas  = filas.reduce((acc, f) => acc + (f.rutas_planeadas  || 0), 0);
    const ejecutadas = filas.reduce((acc, f) => acc + (f.rutas_ejecutadas || 0), 0);
    const sinCerrar  = filas.reduce((acc, f) => acc + (f.rutas_sin_cerrar || 0), 0);
    const zombis     = filas.reduce((acc, f) => acc + (f.rutas_zombi_descartadas || 0), 0);
    return { planeadas, ejecutadas, sinCerrar, zombis, scs: filas.length };
  }, [filas]);

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <KpiSnap label="SCs"        valor={fmtNumSnap(kpis.scs)} />
        <KpiSnap label="Planeadas"  valor={fmtNumSnap(kpis.planeadas)}  color="#3B82F6" />
        <KpiSnap label="Ejecutadas" valor={fmtNumSnap(kpis.ejecutadas)} color="#16a34a" />
        <KpiSnap label="Sin cerrar" valor={fmtNumSnap(kpis.sinCerrar)}  color="#ca8a04" />
        <KpiSnap label="Zombis"     valor={fmtNumSnap(kpis.zombis)}     color="#dc2626" sub="descartadas" />
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto", maxHeight: 600 }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 13 }}>Cargando...</div>
        ) : filas.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 13 }}>Sin datos para esta fecha</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
              <tr>
                {["Fecha","CECO","Planeadas","Small","Large","Ejecutadas","S.Plan","L.Plan","Small SDD","Large SDD","Sin Cerrar","Zombis"].map(h => (
                  <th key={h} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 700, color: "#666", borderBottom: "1px solid #e4e7ec", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px" }}>{f.fecha}</td>
                  <td style={{ padding: "6px", fontWeight: 600 }}>{f.cecos}</td>
                  <td style={{ padding: "6px", textAlign: "right", fontWeight: 700, color: "#3B82F6" }}>{fmtNumSnap(f.rutas_planeadas)}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{fmtNumSnap(f.small_planeadas)}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{fmtNumSnap(f.large_planeadas)}</td>
                  <td style={{ padding: "6px", textAlign: "right", fontWeight: 700, color: "#16a34a" }}>{fmtNumSnap(f.rutas_ejecutadas)}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{fmtNumSnap(f.cant_small)}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{fmtNumSnap(f.cant_large)}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{fmtNumSnap(f.small_sdd_planeadas)}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{fmtNumSnap(f.large_sdd_planeadas)}</td>
                  <td style={{ padding: "6px", textAlign: "right", color: "#ca8a04" }}>{fmtNumSnap(f.rutas_sin_cerrar)}</td>
                  <td style={{ padding: "6px", textAlign: "right", color: "#dc2626" }}>{fmtNumSnap(f.rutas_zombi_descartadas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ─── Sub-componente 3: No Show · Rostering vs Operativo ───
// Fuente: vw_rostering_vs_operativo (1 fila por driver+fecha)
// Detecta: NO SHOW · PARCIAL · CAMBIO PLACA · OK
const SnapNoShow = ({ filas, loading }) => {
  const [filtroCat, setFiltroCat] = useState("INCIDENTES");

  // ─── KPIs agregados ───
  const kpis = useMemo(() => {
    const total = filas.length;
    const ok = filas.filter(f => f.categoria === "OK").length;
    const noShow = filas.filter(f => f.categoria === "NO_SHOW").length;
    const parcial = filas.filter(f => f.categoria === "PARCIAL").length;
    const cambio = filas.filter(f => f.categoria === "CAMBIO_PLACA").length;
    const scs = new Set(filas.map(f => f.facility)).size;
    const totalCargados = filas.reduce((a, f) => a + (f.total_cargados || 0), 0);
    const totalEntregados = filas.reduce((a, f) => a + (f.total_entregados || 0), 0);
    const pctEntregado = totalCargados > 0 ? (totalEntregados / totalCargados * 100) : 0;
    return { total, ok, noShow, parcial, cambio, scs, totalCargados, totalEntregados, pctEntregado };
  }, [filas]);

  // ─── Resumen por SC ───
  const porSC = useMemo(() => {
    const mp = {};
    filas.forEach(f => {
      const sc = f.facility;
      if (!mp[sc]) mp[sc] = { sc, total: 0, ok: 0, noShow: 0, parcial: 0, cambio: 0 };
      mp[sc].total++;
      if (f.categoria === "OK") mp[sc].ok++;
      else if (f.categoria === "NO_SHOW") mp[sc].noShow++;
      else if (f.categoria === "PARCIAL") mp[sc].parcial++;
      else if (f.categoria === "CAMBIO_PLACA") mp[sc].cambio++;
    });
    return Object.values(mp)
      .map(r => ({ ...r, pctOk: r.total > 0 ? r.ok / r.total * 100 : 0 }))
      .sort((a, b) => (b.noShow + b.parcial + b.cambio) - (a.noShow + a.parcial + a.cambio) || a.sc.localeCompare(b.sc));
  }, [filas]);

  // ─── Filas filtradas por categoría ───
  const filasFiltradas = useMemo(() => {
    if (filtroCat === "TODOS") return filas;
    if (filtroCat === "INCIDENTES") return filas.filter(f => f.categoria !== "OK");
    return filas.filter(f => f.categoria === filtroCat);
  }, [filas, filtroCat]);

  // ─── Orden: NO_SHOW > CAMBIO_PLACA > PARCIAL > OK, después SC + driver ───
  const filasOrdenadas = useMemo(() => {
    const orden = { NO_SHOW: 1, CAMBIO_PLACA: 2, PARCIAL: 3, OK: 4, OTRO: 5 };
    return [...filasFiltradas].sort((a, b) => {
      const oa = orden[a.categoria] || 9;
      const ob = orden[b.categoria] || 9;
      if (oa !== ob) return oa - ob;
      if (a.facility !== b.facility) return a.facility.localeCompare(b.facility);
      return (a.driver_name || "").localeCompare(b.driver_name || "");
    });
  }, [filasFiltradas]);

  const tdCenter = { padding: "6px", textAlign: "center" };
  const tdLeft = { padding: "6px 10px", textAlign: "left" };

  const colorCategoria = (cat) => {
    if (cat === "OK") return { bg: "#dcfce7", text: "#15803d", label: "✅ OK" };
    if (cat === "NO_SHOW") return { bg: "#fee2e2", text: "#dc2626", label: "🚨 NO SHOW" };
    if (cat === "PARCIAL") return { bg: "#fef3c7", text: "#b45309", label: "⚠️ PARCIAL" };
    if (cat === "CAMBIO_PLACA") return { bg: "#dbeafe", text: "#1d4ed8", label: "🔄 CAMBIO PLACA" };
    return { bg: "#f1f5f9", text: "#475569", label: cat };
  };

  return (
    <div>
      {/* ─── KPIs ─── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <KpiSnap label="Drivers planif." valor={fmtNumSnap(kpis.total)} sub={`${kpis.scs} SCs`} />
        <KpiSnap label="✅ Operó OK" valor={fmtNumSnap(kpis.ok)} color="#15803d"
          sub={kpis.total > 0 ? `${(kpis.ok / kpis.total * 100).toFixed(0)}%` : "—"} />
        <KpiSnap label="🚨 NO SHOW" valor={fmtNumSnap(kpis.noShow)} color="#dc2626"
          sub={kpis.total > 0 ? `${(kpis.noShow / kpis.total * 100).toFixed(0)}%` : "—"} />
        <KpiSnap label="⚠️ Parcial" valor={fmtNumSnap(kpis.parcial)} color="#b45309"
          sub="Operó 1 de N placas" />
        <KpiSnap label="🔄 Cambio placa" valor={fmtNumSnap(kpis.cambio)} color="#1d4ed8"
          sub="Otra placa" />
        <KpiSnap label="% Entrega" valor={`${kpis.pctEntregado.toFixed(1)}%`} color="#3B82F6"
          sub={`${fmtNumSnap(kpis.totalEntregados)}/${fmtNumSnap(kpis.totalCargados)}`} />
      </div>

      {/* ─── Mini-grid por SC ─── */}
      {porSC.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase",
            letterSpacing: 0.5, marginBottom: 8 }}>
            Cumplimiento por Service Center
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
            {porSC.map(sc => {
              const incidentes = sc.noShow + sc.parcial + sc.cambio;
              const borderColor = incidentes > 0 ? "#fecaca" : "#bbf7d0";
              const bgColor = incidentes > 0 ? "#fef2f2" : "#f0fdf4";
              return (
                <div key={sc.sc} style={{
                  background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 8,
                  padding: 8, fontSize: 11
                }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#1a3a6b", marginBottom: 4 }}>
                    {sc.sc}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 10 }}>
                    <span style={{ color: "#15803d" }}>✅ {sc.ok}</span>
                    {sc.noShow > 0 && <span style={{ color: "#dc2626", fontWeight: 700 }}>🚨 {sc.noShow}</span>}
                    {sc.parcial > 0 && <span style={{ color: "#b45309", fontWeight: 700 }}>⚠️ {sc.parcial}</span>}
                    {sc.cambio > 0 && <span style={{ color: "#1d4ed8", fontWeight: 700 }}>🔄 {sc.cambio}</span>}
                    <span style={{ color: "#64748b", marginLeft: "auto" }}>{sc.pctOk.toFixed(0)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Filtros por categoría ─── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {[
          { id: "INCIDENTES", label: "Solo incidentes", color: "#dc2626" },
          { id: "NO_SHOW", label: `🚨 NO SHOW (${kpis.noShow})`, color: "#dc2626" },
          { id: "PARCIAL", label: `⚠️ Parcial (${kpis.parcial})`, color: "#b45309" },
          { id: "CAMBIO_PLACA", label: `🔄 Cambio placa (${kpis.cambio})`, color: "#1d4ed8" },
          { id: "OK", label: `✅ OK (${kpis.ok})`, color: "#15803d" },
          { id: "TODOS", label: `Todos (${kpis.total})`, color: "#1a3a6b" },
        ].map(b => (
          <button key={b.id} onClick={() => setFiltroCat(b.id)} style={{
            padding: "6px 12px",
            background: filtroCat === b.id ? b.color : "#fff",
            color: filtroCat === b.id ? "#fff" : b.color,
            border: `1px solid ${b.color}`,
            borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer"
          }}>
            {b.label}
          </button>
        ))}
      </div>

      {/* ─── Tabla principal ─── */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto", maxHeight: 600 }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 13 }}>Cargando...</div>
        ) : filasOrdenadas.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center",
            color: filtroCat === "INCIDENTES" || filtroCat === "TODOS" ? "#16a34a" : "#888",
            fontSize: 13, fontWeight: 600 }}>
            {filtroCat === "INCIDENTES" || filtroCat === "TODOS"
              ? "✅ Sin incidentes en esta fecha"
              : "Sin registros con ese filtro"}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "#f8fafc", position: "sticky", top: 0, zIndex: 1 }}>
              <tr>
                {[
                  { l: "SC", t: "Service Center" },
                  { l: "Driver", t: "Nombre del conductor (padrón MELI)" },
                  { l: "Driver ID", t: "ID interno MELI" },
                  { l: "Placas planificadas", t: "Placas asignadas en el rostering" },
                  { l: "Placas operadas", t: "Placas que efectivamente operaron (del snapshot)" },
                  { l: "Cargados", t: "Paquetes cargados al vehículo" },
                  { l: "Entregados", t: "Paquetes entregados" },
                  { l: "% Entrega", t: "% de paquetes entregados sobre cargados" },
                  { l: "Estado", t: "Diagnóstico del cumplimiento" },
                ].map(h => (
                  <th key={h.l} title={h.t}
                    style={{ padding: "8px 6px", textAlign: "center", fontWeight: 700, color: "#666",
                      borderBottom: "1px solid #e4e7ec", fontSize: 10, textTransform: "uppercase",
                      letterSpacing: 0.3, cursor: "help" }}>
                    {h.l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filasOrdenadas.map((f, i) => {
                const c = colorCategoria(f.categoria);
                return (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9",
                    background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                    <td style={{ ...tdCenter, fontWeight: 700, color: "#1a3a6b" }}>{f.facility}</td>
                    <td style={tdLeft}>{f.driver_name || "—"}</td>
                    <td style={{ ...tdCenter, color: "#94a3b8", fontSize: 10, fontFamily: "monospace" }}>
                      {f.driver_id || "—"}
                    </td>
                    <td style={{ ...tdLeft, fontFamily: "monospace", fontSize: 10 }}>
                      {f.placas_planificadas_detalle || "—"}
                    </td>
                    <td style={{ ...tdLeft, fontFamily: "monospace", fontSize: 10,
                      color: f.categoria === "NO_SHOW" ? "#dc2626" : "#1a1a1a" }}>
                      {f.placas_operadas_detalle || (
                        <span style={{ color: "#dc2626", fontWeight: 700 }}>— sin operar —</span>
                      )}
                    </td>
                    <td style={{ ...tdCenter, fontWeight: 600 }}>{fmtNumSnap(f.total_cargados)}</td>
                    <td style={{ ...tdCenter, color: "#16a34a", fontWeight: 600 }}>
                      {fmtNumSnap(f.total_entregados)}
                    </td>
                    <td style={{ ...tdCenter, fontWeight: 700,
                      color: f.pct_entregado >= 95 ? "#16a34a" :
                             f.pct_entregado >= 80 ? "#ca8a04" :
                             f.pct_entregado != null ? "#dc2626" : "#cbd5e1" }}>
                      {f.pct_entregado != null ? `${Number(f.pct_entregado).toFixed(1)}%` : "—"}
                    </td>
                    <td style={tdCenter}>
                      <span style={{
                        background: c.bg, color: c.text,
                        padding: "3px 8px", borderRadius: 4,
                        fontSize: 10, fontWeight: 700, whiteSpace: "nowrap"
                      }}>
                        {c.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Pie informativo ─── */}
      <div style={{ marginTop: 8, fontSize: 10, color: "#94a3b8", textAlign: "right" }}>
        Fuente: vw_rostering_vs_operativo · Rostering MELI (capturas AM 06:00 + PM 23:30) × Snapshot operativo 23:59
      </div>
    </div>
  );
};

// ─── Sub-componente 4: Devoluciones (1 fila por paquete) ───
const SnapDevoluciones = ({ filas, loading }) => {
  // Conteo por motivo
  const conteoMotivos = useMemo(() => {
    const m = {};
    filas.forEach(f => {
      const k = f.motivo || "(sin mapear)";
      m[k] = (m[k] || 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [filas]);

  // Conteo por SC (NUEVO)
  const conteoSCs = useMemo(() => {
    const m = {};
    filas.forEach(f => {
      const sc = f.service_center_id || "—";
      m[sc] = (m[sc] || 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [filas]);

  const totalDev = filas.length;
  const sinMapear = filas.filter(f => !f.motivo).length;
  const scsConDev = conteoSCs.length;

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <KpiSnap label="Total devoluciones" valor={fmtNumSnap(totalDev)} color="#dc2626" />
        <KpiSnap label="SCs con devoluc." valor={fmtNumSnap(scsConDev)} color="#3B82F6" />
        <KpiSnap label="Motivos distintos"  valor={fmtNumSnap(conteoMotivos.length)} />
        <KpiSnap label="Sin mapear"         valor={fmtNumSnap(sinMapear)}
          color={sinMapear > 0 ? "#ca8a04" : "#16a34a"}
          sub={sinMapear > 0 ? "⚠️ revisar" : "✅ OK"} />
        <KpiSnap label="Top SC"
          valor={conteoSCs[0] ? conteoSCs[0][0] : "—"}
          color="#dc2626"
          sub={conteoSCs[0] ? `${conteoSCs[0][1]} devoluc.` : ""} />
        <KpiSnap label="Top motivo"
          valor={conteoMotivos[0] ? conteoMotivos[0][0].slice(0, 16) : "—"}
          sub={conteoMotivos[0] ? `${conteoMotivos[0][1]} pkts` : ""} />
      </div>

      {/* Distribución por SC (NUEVO) */}
      {conteoSCs.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            Distribución por Service Center
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {conteoSCs.map(([sc, cant]) => (
              <div key={sc} style={{ background: "#fef2f2", border: "1px solid #fca5a5",
                borderRadius: 6, padding: "4px 10px", fontSize: 11 }}>
                <span style={{ fontWeight: 700, color: "#991b1b" }}>{sc}</span>
                <span style={{ marginLeft: 6, color: "#666" }}>{cant}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Distribución por motivo */}
      {conteoMotivos.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            Distribución por motivo
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {conteoMotivos.map(([motivo, cant]) => (
              <div key={motivo} style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 6, padding: "4px 10px", fontSize: 11 }}>
                <span style={{ fontWeight: 700, color: "#1a1a1a" }}>{motivo}</span>
                <span style={{ marginLeft: 6, color: "#888" }}>{cant}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla — SC ahora va después de Fecha (2da columna) y resaltado */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto", maxHeight: 600 }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 13 }}>Cargando...</div>
        ) : filas.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#16a34a", fontSize: 13, fontWeight: 600 }}>
            ✅ Sin devoluciones en esta fecha
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
              <tr>
                {["Fecha","SC","Ruta","Folio","Patente","Motivo","Driver","Receptor","CP","Ciudad","Estado"].map(h => (
                  <th key={h} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 700, color: "#666", borderBottom: "1px solid #e4e7ec", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px" }}>{f.fecha}</td>
                  <td style={{ padding: "6px" }}>
                    <span style={{ background: "#fef2f2", color: "#991b1b", padding: "2px 8px",
                      borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                      {f.service_center_id || "—"}
                    </span>
                  </td>
                  <td style={{ padding: "6px", fontFamily: "monospace", fontSize: 10 }}>{f.id_viaje}</td>
                  <td style={{ padding: "6px", fontFamily: "monospace", fontSize: 10 }}>{f.folio_guias}</td>
                  <td style={{ padding: "6px", fontFamily: "monospace" }}>{f.patente}</td>
                  <td style={{ padding: "6px", fontWeight: 600, color: f.motivo ? "#1a1a1a" : "#ca8a04" }}>
                    {f.motivo || "(sin mapear)"}
                  </td>
                  <td style={{ padding: "6px" }}>{f.driver_name || "—"}</td>
                  <td style={{ padding: "6px" }}>{f.receiver_name || "—"}</td>
                  <td style={{ padding: "6px" }}>{f.zip_code || "—"}</td>
                  <td style={{ padding: "6px" }}>{f.city || "—"}</td>
                  <td style={{ padding: "6px" }}>{f.state || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ─── MÓDULO MAESTRO DE OPERACIONES (MODIFICADO) ─────────────────────────
// Simplificado: 2 tabs (Reporte MELI + Snapshot Supervisores)
// Selector de día único (no rango), default = D-1 (ayer)
// Las pestañas Penalizaciones, Premios, Ayudantes se eliminaron de esta vista
const ModuloMaestro = ({ usuario }) => {
  const [vista, setVista]       = useState("snapshot");
  // Fecha única (no rango); default = D-1 en zona México
  const [fecha, setFecha]       = useState(fechaOperativaOffset(-1));
  const [reloadKey, setReloadKey] = useState(0);
  const [pais, setPais]         = useState("MX"); // default MX para que Snapshot funcione

  const tabs = [
    { id: "snapshot", label: "Maestro Supervisores Snapshot" },
  ];

  return (
    <div className="pg" style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Maestro de Operaciones</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Última milla · MercadoLibre</div>
          </div>
          {/* Selector de país */}
          <div style={{ display: "flex", gap: 6 }}>
            {[{ id: "CL", label: "🇨🇱 Chile" }, { id: "MX", label: "🇲🇽 México" }].map(p => (
              <button key={p.id} onClick={() => { setPais(p.id); setReloadKey(k => k + 1); }}
                style={{ padding: "6px 16px", borderRadius: 20,
                  border: `1px solid ${pais === p.id ? "#3B82F6" : "#e4e7ec"}`,
                  background: pais === p.id ? "#3B82F6" : "#fff",
                  color: pais === p.id ? "#fff" : "#555",
                  fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filtro de fecha único */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 10, color: "#888", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Día</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {[
              { label: "Hoy",       fn: () => setFecha(fechaHoyOperativa())            },
              { label: "Ayer",      fn: () => setFecha(fechaOperativaOffset(-1))       },
              { label: "Anteayer",  fn: () => setFecha(fechaOperativaOffset(-2))       },
              { label: "Hace 7 d", fn: () => setFecha(fechaOperativaOffset(-7))       },
            ].map(({ label, fn }) => (
              <button key={label} onClick={fn}
                style={{ padding: "5px 14px", borderRadius: 4, border: "1px solid #e4e7ec",
                  background: "#f8fafc", color: "#555", fontSize: 11, fontWeight: 700,
                  cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              max={fechaHoyOperativa()}
              style={{ background: "#f0f2f5", border: "1px solid #e4e7ec", borderRadius: 4,
                padding: "6px 10px", fontSize: 12, flex: 1, maxWidth: 200 }} />
            <span style={{ fontSize: 11, color: "#888" }}>
              {fecha === fechaHoyOperativa() ? "(hoy)" :
               fecha === fechaOperativaOffset(-1) ? "(ayer)" :
               fecha === fechaOperativaOffset(-2) ? "(anteayer)" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid #e4e7ec" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setVista(t.id)}
            style={{ padding: "10px 22px", background: "none", border: "none",
              borderBottom: vista === t.id ? "2px solid #1a3a6b" : "2px solid transparent",
              color: vista === t.id ? "#1a3a6b" : "#555",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
              marginBottom: -2 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {vista === "viajes"   && <VistaViajesMaestro key={`v-${fecha}-${pais}-${reloadKey}`} fecha={fecha} fechaFin={fecha} pais={pais} onFechaChange={setFecha} />}
      {vista === "snapshot" && <VistaSnapshotSupervisores key={`s-${fecha}-${pais}-${reloadKey}`} fecha={fecha} pais={pais} />}
    </div>
  );
};

export default ModuloMaestro;
