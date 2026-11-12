// ═══════════════════════════════════════════════════════════════════════════
// Salud.jsx — Salud del sistema.
// Paso 1: frescura de los datos. Un semáforo por fuente: hace cuánto llegó el
// último dato y cuánto se tolera sin novedades (tabla salud_fuentes).
//   · fn_salud_datos() → { ahora, fuentes: [{ grupo, nombre, robot, vps, ultimo,
//     edad_min, max_min, en_horario, estado, detalle }] }
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
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    const { data, error: err } = await sb.rpc("fn_salud_datos");
    if (err) setError(err.message); else { setDatos(data); setError(null); }
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

  const general = malas.length ? "rojo" : atrasadas.length ? "amarillo" : "verde";
  const [, colG, bgG, puntoG] = ESTADO[general];
  const caja = { background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, padding: 14 };

  return (
    <div>
      <div style={{ ...caja, background: bgG, borderColor: puntoG, display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <span style={{ width: 18, height: 18, borderRadius: "50%", background: puntoG, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: colG }}>
            {loading ? "Revisando…" : malas.length ? `${malas.length} ${malas.length === 1 ? "fuente detenida" : "fuentes detenidas"}: ${malas.map((f) => f.nombre).join(", ")}`
              : atrasadas.length ? `${atrasadas.length} ${atrasadas.length === 1 ? "fuente atrasada" : "fuentes atrasadas"}: ${atrasadas.map((f) => f.nombre).join(", ")}`
              : "Todos los datos están llegando"}
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
    </div>
  );
}
