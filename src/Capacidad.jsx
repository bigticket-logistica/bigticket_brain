// ═══════════════════════════════════════════════════════════════════════════
// Capacidad.jsx — Administración → Pagos → Capacidad.
//
// Réplica del reporte "Resumen de ejecución de rutas" de MELI con datos propios:
//   · fn_capacidad_resumen(desde, hasta, modelo, sc) → embudo, tarjetas y ranking por SC
//   · fn_capacidad_detalle(desde, hasta, modelo, sc) → una fila por pedido
// Fuentes: mx_pedidos_estado (pedidos de MELI) × vw_torre_control_dia (Torre)
//          × bitacora_no_salidas_mx (respuesta del supervisor).
// Reglas (cuadradas contra MELI el 3-nov SDD):
//   Solicitado  = pedidos, menos los cancelados por MELI que no salieron
//   Confirmado  = aceptados · Asignado = aceptados con chofer y placa
//   Ejecutado   = aceptados que salieron
//   Soft no show = solicitado no aceptado (Solicitado − Confirmado)
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, fechaOperativaOffset, sb } from "./shared";

const AZUL = "#1a3a6b";
const GRIS = "#64748b";
const BORDE = "#e4e7ec";
const POR_PAGINA = 10;

const BARRAS = [
  ["solicitado", "Solicitado", "#93c5fd"],
  ["confirmado", "Confirmado", "#3b82f6"],
  ["asignado", "Asignado", "#1d4ed8"],
  ["ejecutado", "Ejecutado", "#059669"],
];

const CATEGORIA = {
  ejecutado: ["Ejecutado", "#047857", "#d1fae5"],
  pendiente: ["Pendiente", "#7c3aed", "#f3e8ff"],
  no_show_soft: ["Soft no show", "#b45309", "#fef3c7"],
  cancelado_salio: ["Cancelado por MELI, salió", "#b45309", "#fef3c7"],
  no_show_hard: ["Hard no show", "#b91c1c", "#fee2e2"],
  cancelado_hard: ["Cancelación", "#b91c1c", "#fee2e2"],
  cancelado_soft: ["Cancelado por MELI", "#475569", "#f1f5f9"],
  sin_responder: ["Sin responder supervisor", "#9f1239", "#ffe4e6"],
  otro: ["Otro", "#475569", "#f1f5f9"],
};

const CONFIRMADO = {
  Aceptado: ["#047857", "#d1fae5"],
  Rechazado: ["#b91c1c", "#fee2e2"],
  "Cancelado por MELI": ["#475569", "#f1f5f9"],
  "Sin responder": ["#7c3aed", "#f3e8ff"],
};

const VER = [
  ["todos", "Todos"],
  ["ejecutado", "Ejecutados"],
  ["no_ejecutado", "No ejecutados"],
  ["soft", "Soft no show"],
  ["no_show_hard", "Hard no show"],
  ["cancelado_hard", "Cancelación"],
  ["sin_responder", "Sin responder supervisor"],
  ["cancelado_soft", "Cancelados por MELI"],
  ["pendiente", "Pendientes"],
];

const pasaVer = (f, v) => {
  if (v === "todos") return true;
  if (v === "no_ejecutado") return !f.ejecutado && f.categoria !== "cancelado_soft";
  if (v === "soft") return f.categoria === "no_show_soft" || f.categoria === "cancelado_salio";
  return f.categoria === v;
};

const pct = (a, b) => (b ? Math.round((a * 100) / b) + "%" : "—");
const fCorta = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "");

function Pill({ t, c, bg }) {
  return <span style={{ background: bg, color: c, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>{t}</span>;
}

function Check({ v }) {
  return v ? <span style={{ color: "#047857", fontWeight: 800 }}>✓</span> : <span style={{ color: "#cbd5e1" }}>—</span>;
}

function Tarjeta({ titulo, total, filas }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, padding: "12px 14px", minWidth: 210 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: AZUL, fontSize: 13 }}>
        <span>{titulo}</span><span>{total}</span>
      </div>
      <div style={{ borderTop: `1px solid ${BORDE}`, margin: "8px 0 4px" }} />
      {filas.map(([t, v, ayuda]) => (
        <div key={t} title={ayuda} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: GRIS, padding: "3px 0" }}>
          <span>{t}</span><span style={{ fontWeight: 700, color: "#334155" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// PostgREST corta en 1.000 filas: se pide por páginas.
async function traerDetalle(desde, hasta, modelo, sc) {
  const out = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await sb.rpc("fn_capacidad_detalle", { p_desde: desde, p_hasta: hasta, p_modelo: modelo || null, p_sc: sc || null })
      .range(i * 1000, i * 1000 + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default function Capacidad() {
  const ayer = fechaOperativaOffset(-1);
  const [desde, setDesde] = useState(ayer);
  const [hasta, setHasta] = useState(ayer);
  const [modelo, setModelo] = useState("");
  const [sc, setSc] = useState("");
  const [resumen, setResumen] = useState(null);
  const [filas, setFilas] = useState([]);
  const [ver, setVer] = useState("todos");
  const [buscar, setBuscar] = useState("");
  const [pagina, setPagina] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const d1 = desde <= hasta ? desde : hasta;
  const d2 = hasta >= desde ? hasta : desde;

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // El resumen se pide sin SC para tener el ranking y la lista de SC completos.
      const [r, f] = await Promise.all([
        sb.rpc("fn_capacidad_resumen", { p_desde: d1, p_hasta: d2, p_modelo: modelo || null, p_sc: null }),
        traerDetalle(d1, d2, modelo, sc),
      ]);
      if (r.error) throw r.error;
      setResumen(r.data);
      setFilas(f);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [d1, d2, modelo, sc]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPagina(1); }, [ver, buscar, filas]);

  const porSc = resumen?.por_sc || [];
  const listaSc = useMemo(() => porSc.map((x) => x.sc).sort(), [porSc]);
  const tot = useMemo(() => (sc ? porSc.find((x) => x.sc === sc) || {} : resumen?.totales || {}), [resumen, sc, porSc]);
  const maxBarra = Math.max(1, ...BARRAS.map(([k]) => tot[k] || 0));

  const filtradas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return filas.filter((f) => pasaVer(f, ver) && (!q || [f.sc, f.placa, f.chofer, f.driver_id, f.id_ruta, f.travel_id, f.vehiculo]
      .some((x) => x && String(x).toLowerCase().includes(q))));
  }, [filas, ver, buscar]);
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const visibles = filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  const descargarExcel = async () => {
    setExcelBusy(true);
    try {
      const det = [["FECHA", "SC", "MODELO", "REQUEST ID", "TRAVEL ID", "VEHICULO", "PLACA", "CHOFER", "DRIVER ID", "ID RUTA",
        "CONFIRMADO", "ASIGNADO", "EJECUTADO", "ESTADO TORRE", "CATEGORIA", "RESPUESTA SUPERVISOR", "PRUEBAS"]];
      for (const f of filtradas) det.push([f.fecha, f.sc, f.modelo, f.request_id ?? "", f.travel_id || "", f.vehiculo || "", f.placa || "",
        f.chofer || "", f.driver_id || "", f.id_ruta || "", f.confirmado || "", f.asignado ? "SI" : "NO", f.ejecutado ? "SI" : "NO",
        f.estado_torre || "", (CATEGORIA[f.categoria] || [f.categoria])[0], f.resultado_supervisor || "", f.pruebas || 0]);
      const res = [["SC", "SOLICITADO", "CONFIRMADO", "ASIGNADO", "EJECUTADO", "% EJECUTADO / CONFIRMADO", "SOFT NO SHOW",
        "HARD NO SHOW", "CANCELACION", "SIN RESPONDER SUPERVISOR", "CANCELADO POR MELI", "PENDIENTE"]];
      for (const x of porSc) {
        if (sc && x.sc !== sc) continue;
        res.push([x.sc, x.solicitado, x.confirmado, x.asignado, x.ejecutado, pct(x.ejecutado, x.confirmado), x.no_show_soft,
          x.no_show_hard, x.cancelado_hard, x.sin_responder, x.cancelado_soft, x.pendiente]);
      }
      await descargarExcelMultihoja([{ nombre: "Por SC", datos: res }, { nombre: "Detalle", datos: det }],
        `capacidad_${d1 === d2 ? d1 : d1 + "_a_" + d2}${modelo ? "_" + modelo : ""}${sc ? "_" + sc : ""}`);
    } catch (e) {
      alert("No se pudo generar el Excel: " + (e.message || e));
    } finally {
      setExcelBusy(false);
    }
  };

  const th = { padding: "8px 8px", fontSize: 10.5, color: GRIS, fontWeight: 600, textAlign: "left", whiteSpace: "nowrap", background: "#f8fafc" };
  const thC = { ...th, textAlign: "center" };
  const td = { padding: "7px 8px", fontSize: 11.5, verticalAlign: "middle", borderTop: `1px solid ${BORDE}` };
  const tdC = { ...td, textAlign: "center" };
  const input = { border: `1px solid ${BORDE}`, borderRadius: 8, padding: "6px 8px", fontSize: 12 };
  const caja = { background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, padding: 14 };

  return (
    <div className="pg">
      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: GRIS }}>Desde<br /><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={input} /></label>
        <label style={{ fontSize: 11, color: GRIS }}>Hasta<br /><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={input} /></label>
        <label style={{ fontSize: 11, color: GRIS }}>Modelo de contratación<br />
          <select value={modelo} onChange={(e) => setModelo(e.target.value)} style={input}>
            <option value="">Todos</option><option value="SDD">SDD</option><option value="SPOT">Spot</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: GRIS }}>Service Center<br />
          <select value={sc} onChange={(e) => setSc(e.target.value)} style={input}>
            <option value="">Todos</option>
            {listaSc.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button onClick={cargar} disabled={loading} style={{ ...input, background: "#fff", cursor: "pointer" }}>↻ Actualizar</button>
        <button onClick={descargarExcel} disabled={excelBusy || loading}
          style={{ ...input, background: AZUL, color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>
          {excelBusy ? "Generando…" : "⬇ Descargar Excel"}
        </button>
      </div>

      {error && <div style={{ background: "#fee2e2", color: "#b91c1c", padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>Error: {error}</div>}
      {loading && <div style={{ color: GRIS, fontSize: 12, marginBottom: 12 }}>Cargando…</div>}

      {/* Embudo + tarjetas */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ ...caja, flex: "1 1 520px" }}>
          <div style={{ fontWeight: 700, color: AZUL, fontSize: 14, marginBottom: 10 }}>Resumen de ejecución de rutas</div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: 180, borderBottom: `1px solid ${BORDE}` }}>
            {BARRAS.map(([k, t, color]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", width: 70 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>{tot[k] || 0}</div>
                <div style={{ width: 28, height: `${((tot[k] || 0) / maxBarra) * 150}px`, background: color, borderRadius: "4px 4px 0 0", minHeight: 2 }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-around", marginTop: 6 }}>
            {BARRAS.map(([k, t]) => (
              <div key={k} style={{ width: 70, textAlign: "center", fontSize: 11, color: GRIS }}>
                {t}<br /><b style={{ color: "#334155", fontSize: 12 }}>{tot[k] || 0}</b>
                {k !== "solicitado" && <div style={{ fontSize: 10 }}>{pct(tot[k] || 0, tot.solicitado || 0)}</div>}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Tarjeta titulo="No show" total={(tot.no_show_hard || 0) + (tot.no_show_soft || 0)} filas={[
            ["Hard no show", tot.no_show_hard || 0, "Aceptado, no salió y el supervisor marcó No Show"],
            ["Soft no show", tot.no_show_soft || 0, "Solicitado que Bigticket no aceptó (rechazado, vencido o cancelado por MELI que salió)"],
          ]} />
          <Tarjeta titulo="Cancelado" total={tot.cancelado_hard || 0} filas={[
            ["Hard cancelado", tot.cancelado_hard || 0, "Aceptado, no salió y el supervisor marcó Cancelación"],
            ["Por MELI (fuera del embudo)", tot.cancelado_soft || 0, "MELI canceló el pedido antes de que saliera"],
          ]} />
          <Tarjeta titulo="Por revisar" total={(tot.sin_responder || 0) + (tot.pendiente || 0)} filas={[
            ["Sin responder supervisor", tot.sin_responder || 0, "Aceptado, no salió y el supervisor no ha respondido en la Bitácora"],
            ["Pendiente de hoy", tot.pendiente || 0, "Todavía puede salir"],
          ]} />
        </div>
      </div>

      {/* Ranking por SC */}
      {!sc && porSc.length > 0 && (
        <div style={{ ...caja, marginBottom: 14, overflowX: "auto" }}>
          <div style={{ fontWeight: 700, color: AZUL, fontSize: 14, marginBottom: 8 }}>Ranking por Service Center</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>SC</th><th style={thC}>Solicitado</th><th style={thC}>Confirmado</th><th style={thC}>Asignado</th>
              <th style={thC}>Ejecutado</th><th style={thC}>% Ejecutado</th><th style={thC}>Soft no show</th><th style={thC}>Hard no show</th>
              <th style={thC}>Cancelación</th><th style={thC}>Sin responder</th>
            </tr></thead>
            <tbody>
              {[...porSc].sort((a, b) => (b.no_show_hard + b.no_show_soft + b.cancelado_hard + b.sin_responder)
                - (a.no_show_hard + a.no_show_soft + a.cancelado_hard + a.sin_responder) || a.sc.localeCompare(b.sc)).map((x) => (
                <tr key={x.sc} onClick={() => setSc(x.sc)} style={{ cursor: "pointer" }} title="Ver solo este SC">
                  <td style={{ ...td, fontWeight: 700 }}>{x.sc}</td>
                  <td style={tdC}>{x.solicitado}</td><td style={tdC}>{x.confirmado}</td><td style={tdC}>{x.asignado}</td>
                  <td style={tdC}>{x.ejecutado}</td>
                  <td style={{ ...tdC, fontWeight: 700, color: x.confirmado && x.ejecutado < x.confirmado ? "#b45309" : "#047857" }}>{pct(x.ejecutado, x.confirmado)}</td>
                  <td style={tdC}>{x.no_show_soft || ""}</td>
                  <td style={{ ...tdC, color: "#b91c1c", fontWeight: 700 }}>{x.no_show_hard || ""}</td>
                  <td style={{ ...tdC, color: "#b91c1c", fontWeight: 700 }}>{x.cancelado_hard || ""}</td>
                  <td style={{ ...tdC, color: "#9f1239", fontWeight: 700 }}>{x.sin_responder || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detalle por estado */}
      <div style={{ ...caja, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, color: AZUL, fontSize: 14 }}>Detalle por estado {sc && <span style={{ color: GRIS, fontWeight: 400 }}>· {sc} <a href="#" onClick={(e) => { e.preventDefault(); setSc(""); }}>(ver todos)</a></span>}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Filtrar: placa, chofer, ruta…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ ...input, width: 200 }} />
            <select value={ver} onChange={(e) => setVer(e.target.value)} style={input}>
              {VER.map(([k, t]) => <option key={k} value={k}>Ver servicios: {t} ({filas.filter((f) => pasaVer(f, k)).length})</option>)}
            </select>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Fecha</th><th style={th}>Service Center</th><th style={th}>Vehículo</th><th style={th}>Transportista</th>
            <th style={th}>ID de Ruta</th><th style={thC}>Confirmado</th><th style={thC}>Asignado</th><th style={thC}>Ejecutado</th><th style={th}>Resultado</th>
          </tr></thead>
          <tbody>
            {visibles.map((f, i) => {
              const conf = CONFIRMADO[f.confirmado] || ["#475569", "#f1f5f9"];
              const cat = CATEGORIA[f.categoria] || CATEGORIA.otro;
              return (
                <tr key={`${f.request_id}-${f.travel_id}-${i}`}>
                  <td style={{ ...td, color: GRIS }}>{fCorta(f.fecha)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{f.sc}</td>
                  <td style={td}>{f.vehiculo || "—"} <span style={{ color: GRIS }}>{f.modelo}</span><br /><b>{f.placa || ""}</b></td>
                  <td style={td}>{f.chofer || ""}<br /><b>{f.driver_id || ""}</b></td>
                  <td style={td}>{f.id_ruta || ""}</td>
                  <td style={tdC}>{f.confirmado ? <Pill t={f.confirmado} c={conf[0]} bg={conf[1]} /> : "—"}</td>
                  <td style={tdC}><Check v={f.asignado} /></td>
                  <td style={tdC}><Check v={f.ejecutado} /></td>
                  <td style={td}><Pill t={cat[0]} c={cat[1]} bg={cat[2]} /></td>
                </tr>
              );
            })}
            {!loading && visibles.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: GRIS }}>Sin servicios para este filtro.</td></tr>}
          </tbody>
        </table>
        {paginas > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12 }}>
            <button disabled={pagina === 1} onClick={() => setPagina(pagina - 1)} style={{ ...input, cursor: "pointer" }}>‹ Anterior</button>
            <span style={{ color: GRIS }}>Página {pagina} de {paginas} · {filtradas.length} servicios</span>
            <button disabled={pagina === paginas} onClick={() => setPagina(pagina + 1)} style={{ ...input, cursor: "pointer" }}>Siguiente ›</button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 10.5, color: GRIS, marginTop: 10 }}>
        Fuente: fn_capacidad_resumen / fn_capacidad_detalle · mx_pedidos_estado (pedidos de MELI) + vw_torre_control_dia (Torre, últimos 30 días)
        + bitacora_no_salidas_mx (respuesta del supervisor). Acordado y Escaneado no se muestran todavía.
      </div>
    </div>
  );
}
