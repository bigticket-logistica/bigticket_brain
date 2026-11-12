// ═══════════════════════════════════════════════════════════════════════════
// Salud.jsx — Salud del sistema.
// 1) Frescura de los datos: un semáforo por fuente (tabla salud_fuentes).
//    fn_salud_datos() → { ahora, fuentes: [{ grupo, nombre, robot, vps, ultimo, edad_min, max_min, estado }] }
// 2) Servidores: lo que reporta salud-watch.cjs desde cada VPS cada 5 minutos.
//    fn_salud_vps() → { vps: [{ vps, edad_min, servidor, procesos, meli }], eventos: [...] }
// Se actualiza sola cada minuto.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "./shared";

const AZUL = "#002E5D";
const GRIS = "#64748b";
const BORDE = "#e4e7ec";

const ESTADO = {
  verde: ["Al día", "#047857", "#d1fae5", "#10b981"],
  amarillo: ["Atrasado", "#b45309", "#fef3c7", "#f59e0b"],
  rojo: ["Detenido", "#b91c1c", "#fee2e2", "#ef4444"],
  error: ["No se pudo revisar", "#b91c1c", "#fee2e2", "#ef4444"],
  fuera_horario: ["Fuera de horario", "#475569", "#f1f5f9", "#94a3b8"],
};
const ORDEN_ESTADO = { rojo: 0, error: 0, amarillo: 1, verde: 2, fuera_horario: 3 };

const fHora = (v) => (v ? new Date(v).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
function hace(min) {
  if (min == null) return "sin datos";
  if (min < 1) return "hace menos de 1 min";
  if (min < 60) return `hace ${Math.round(min)} min`;
  if (min < 48 * 60) return `hace ${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
  return `hace ${Math.round(min / 1440)} días`;
}
const cada = (min) => (min < 120 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} días`);

export default function Salud() {
  const [datos, setDatos] = useState(null);
  const [srv, setSrv] = useState({ vps: [], eventos: [] });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    const [{ data, error: err }, v] = await Promise.all([sb.rpc("fn_salud_datos"), sb.rpc("fn_salud_vps")]);
    if (err) setError(err.message); else { setDatos(data); setError(null); }
    if (v?.data) setSrv({ vps: v.data.vps || [], eventos: v.data.eventos || [] });
    setLoading(false);
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, [cargar]);

  const fuentes = datos?.fuentes || [];
  const malas = fuentes.filter((f) => f.estado === "rojo" || f.estado === "error");
  const atrasadas = fuentes.filter((f) => f.estado === "amarillo");
  const grupos = useMemo(() => {
    const g = {};
    for (const f of fuentes) (g[f.grupo] = g[f.grupo] || []).push(f);
    return Object.entries(g);
  }, [fuentes]);

  // Problemas de servidores: VPS que dejó de reportar, proceso caído, disco lleno o pausa por MELI
  const problemasSrv = [];
  for (const v of srv.vps) {
    if (v.edad_min > 15) problemasSrv.push(`VPS ${v.vps} no reporta hace ${hace(v.edad_min).replace("hace ", "")}`);
    for (const p of v.procesos || []) if (p.estado !== "online" && p.estado !== "stopped") problemasSrv.push(`${p.nombre} caído (VPS ${v.vps})`);
    if ((v.servidor?.disco_pct || 0) >= 85) problemasSrv.push(`disco del VPS ${v.vps} al ${v.servidor.disco_pct}%`);
    if (v.meli?.enfriado) problemasSrv.push(`VPS ${v.vps} en pausa por freno de MELI`);
  }
  const general = malas.length || problemasSrv.length ? "rojo" : atrasadas.length ? "amarillo" : "verde";
  const [, colG, bgG, puntoG] = ESTADO[general];
  const caja = { background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, padding: 14 };

  return (
    <div>
      <div style={{ ...caja, background: bgG, borderColor: puntoG, display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <span style={{ width: 18, height: 18, borderRadius: "50%", background: puntoG, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: colG }}>
            {loading ? "Revisando…" : malas.length || problemasSrv.length ? [...malas.map((f) => `${f.nombre} detenido`), ...problemasSrv].join(" · ")
              : atrasadas.length ? `${atrasadas.length} ${atrasadas.length === 1 ? "fuente atrasada" : "fuentes atrasadas"}: ${atrasadas.map((f) => f.nombre).join(", ")}`
              : "Todo funciona: los datos llegan y los servidores responden"}
          </div>
          <div style={{ fontSize: 12, color: GRIS }}>Revisado {fHora(datos?.ahora)} (hora de México) · se actualiza sola cada minuto</div>
        </div>
        <button type="button" onClick={cargar} style={{ border: `1px solid ${BORDE}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, background: "#fff", cursor: "pointer" }}>↻ Revisar ahora</button>
      </div>
      {error && <div style={{ background: "#fee2e2", color: "#b91c1c", padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>No se pudo consultar la salud: {error}</div>}

      {grupos.map(([grupo, lista]) => (
        <div key={grupo} style={{ ...caja, marginBottom: 12, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", fontWeight: 700, color: AZUL, fontSize: 13, borderBottom: `1px solid ${BORDE}`, background: "#f8fafc" }}>{grupo}</div>
          {[...lista].sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]).map((f) => {
            const [texto, col, bg, punto] = ESTADO[f.estado] || ESTADO.fuera_horario;
            return (
              <div key={f.nombre} style={{ display: "grid", gridTemplateColumns: "20px 1.4fr 1fr 1fr 150px", gap: 12, alignItems: "center", padding: "10px 14px", borderTop: `1px solid ${BORDE}`, fontSize: 12.5 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: punto }} />
                <span><b style={{ color: "#1e293b" }}>{f.nombre}</b><div style={{ fontSize: 11, color: GRIS }}>{f.robot} · VPS {f.vps}</div></span>
                <span style={{ color: f.estado === "verde" ? "#334155" : col, fontWeight: f.estado === "verde" ? 400 : 700 }}>{hace(f.edad_min)}<div style={{ fontSize: 11, color: GRIS, fontWeight: 400 }}>{fHora(f.ultimo)}</div></span>
                <span style={{ color: GRIS, fontSize: 11.5 }}>se espera cada {cada(f.max_min)}{(f.hora_desde > 0 || f.hora_hasta < 24) && <div>de {String(f.hora_desde).padStart(2, "0")}:00 a {String(f.hora_hasta).padStart(2, "0")}:00</div>}</span>
                <span style={{ textAlign: "right" }}><span style={{ background: bg, color: col, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10 }}>{texto}</span>
                  {f.detalle && <div style={{ fontSize: 10.5, color: "#b91c1c", marginTop: 3 }} title={f.detalle}>{String(f.detalle).slice(0, 40)}</div>}</span>
              </div>
            );
          })}
        </div>
      ))}

      {srv.vps.map((v) => {
        const sv = v.servidor || {}, sinReporte = v.edad_min > 15;
        const chip = (t, malo) => <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 10, background: malo ? "#fee2e2" : "#f1f5f9", color: malo ? "#b91c1c" : "#334155", fontWeight: 600 }}>{t}</span>;
        return (
          <div key={v.vps} style={{ ...caja, marginBottom: 12, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${BORDE}`, background: "#f8fafc", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: sinReporte ? "#ef4444" : "#10b981" }} />
              <b style={{ color: AZUL, fontSize: 13 }}>VPS {v.vps}</b>
              <span style={{ fontSize: 11.5, color: sinReporte ? "#b91c1c" : GRIS, fontWeight: sinReporte ? 700 : 400 }}>reportó {hace(v.edad_min)}</span>
              <span style={{ flex: 1 }} />
              {chip(`memoria ${sv.mem_usada_pct ?? "?"}%`, (sv.mem_usada_pct || 0) >= 90)}
              {chip(`disco ${sv.disco_pct ?? "?"}%`, (sv.disco_pct || 0) >= 85)}
              {chip(`carga ${(sv.carga || [])[0] ?? "?"} · ${sv.nucleos ?? "?"} núcleos`, (sv.carga || [])[0] > (sv.nucleos || 1) * 2)}
              {chip(`${sv.encendido_dias ?? "?"} días encendido`, false)}
              {sv.reinicio_pendiente && <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 10, background: "#fef3c7", color: "#b45309", fontWeight: 600 }}>reinicio pendiente</span>}
            </div>
            {v.meli && (
              <div style={{ padding: "8px 14px", borderBottom: `1px solid ${BORDE}`, fontSize: 12, color: "#334155", display: "flex", gap: 18, flexWrap: "wrap" }}>
                <b style={{ color: AZUL }}>Consultas a MELI · última hora</b>
                <span>{v.meli.llamadas_1h} consultas</span>
                <span>máximo {v.meli.max_por_minuto} por minuto</span>
                <span style={{ color: v.meli.n429_1h ? "#b91c1c" : "#047857", fontWeight: 700 }}>{v.meli.n429_1h} frenos (429)</span>
                {v.meli.enfriado && <span style={{ color: "#b91c1c", fontWeight: 700 }}>en pausa hasta {fHora(v.meli.enfriado_hasta)}</span>}
                <span style={{ color: GRIS }}>{Object.entries(v.meli.por_robot || {}).map(([k, n]) => `${k} ${n}`).join(" · ")}</span>
              </div>
            )}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Proceso", "Estado", "Última actividad", "Errores (1 h)", "Reinicios", "Arriba", "Memoria"].map((t) => <th key={t} style={{ padding: "7px 14px", fontSize: 10.5, color: GRIS, fontWeight: 600, textAlign: "left" }}>{t}</th>)}</tr></thead>
              <tbody>
                {[...(v.procesos || [])].sort((a, b) => (a.estado === "online" ? 1 : 0) - (b.estado === "online" ? 1 : 0) || b.errores_1h - a.errores_1h || a.nombre.localeCompare(b.nombre)).map((p) => {
                  const est = p.estado === "online" ? ["En línea", "#047857", "#d1fae5"] : p.estado === "stopped" ? ["Detenido", "#475569", "#f1f5f9"] : ["Caído", "#b91c1c", "#fee2e2"];
                  const sinAct = p.ultima_actividad ? (Date.now() - new Date(p.ultima_actividad).getTime()) / 60000 : null;
                  const tdp = { padding: "6px 14px", fontSize: 12, borderTop: `1px solid ${BORDE}` };
                  return (
                    <tr key={p.nombre}>
                      <td style={{ ...tdp, fontWeight: 700, color: "#1e293b" }}>{p.nombre}</td>
                      <td style={tdp}><span style={{ background: est[2], color: est[1], fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 10 }}>{est[0]}</span></td>
                      <td style={{ ...tdp, color: GRIS }}>{sinAct == null ? "—" : hace(sinAct)}</td>
                      <td style={{ ...tdp, color: p.errores_1h ? "#b45309" : "#94a3b8", fontWeight: p.errores_1h ? 700 : 400 }} title={p.ultimo_error || ""}>{p.errores_1h || 0}{p.ultimo_error ? <div style={{ fontSize: 10.5, fontWeight: 400, color: GRIS, maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.ultimo_error}</div> : null}</td>
                      <td style={tdp}>{p.reinicios}</td>
                      <td style={{ ...tdp, color: GRIS }}>{p.estado === "online" ? (p.arriba_h >= 48 ? `${Math.round(p.arriba_h / 24)} días` : `${p.arriba_h} h`) : "—"}</td>
                      <td style={{ ...tdp, color: GRIS }}>{p.mem_mb ? `${p.mem_mb} MB` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {srv.eventos.length > 0 && (
        <div style={{ ...caja, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", fontWeight: 700, color: AZUL, fontSize: 13, borderBottom: `1px solid ${BORDE}`, background: "#f8fafc" }}>Eventos de las últimas 48 horas</div>
          {srv.eventos.slice(0, 60).map((e) => {
            const tipo = { reinicio: ["Reinicio", "#b45309"], caido: ["Caída", "#b91c1c"], recuperado: ["Recuperado", "#047857"], freno_meli: ["Freno de MELI", "#b91c1c"], enfriamiento: ["Pausa por MELI", "#b91c1c"] }[e.tipo] || [e.tipo, GRIS];
            return (
              <div key={e.id} style={{ display: "grid", gridTemplateColumns: "120px 110px 130px 1fr", gap: 12, padding: "7px 14px", borderTop: `1px solid ${BORDE}`, fontSize: 12 }}>
                <span style={{ color: GRIS }}>{fHora(e.creado_at)}</span>
                <span style={{ color: tipo[1], fontWeight: 700 }}>{tipo[0]}</span>
                <span style={{ color: "#334155" }}>{e.proceso || `VPS ${e.vps}`}</span>
                <span style={{ color: GRIS }}>{e.proceso ? `VPS ${e.vps} · ` : ""}{e.detalle}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
