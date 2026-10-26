// ═══════════════════════════════════════════════════════════════════════════
// REQUERIMIENTOS DE GENTE (México)
//
// El jefe de operaciones pide a Referidos que busque transportistas: SC,
// vehículos (tipo y cantidad), urgencia, para cuándo y un comentario. Cada
// solicitud tiene SLA de 24 h. El analista de Referidos aprieta "Crear
// campaña": se abre Oportunidades con el SC y los vehículos cargados, y al
// guardar la campaña el requerimiento queda realizado solo ("campaña creada").
//
// Un solo componente para las dos pestañas:
//   Pool      → <Requerimientos modo="jefe" />      crea y ve la tabla
//   Referidos → <Requerimientos modo="analista" />  atiende y ve la tabla
//
// Datos: ref_requerimientos (lectura) · fn_ref_req_crear · fn_ref_req_estado
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { sb } from "./shared";

const AZUL = "#1a3a6b", NARANJA = "#F47B20", GRIS = "#64748b", BORDE = "#e4e7ec";
const TIPOS = ["Small Van", "Large Van", "Auto", "Moto", "Camioneta pickup", "Camión 3.5 t"];
const URGENCIAS = { alta: ["Alta", "#b42318", "#fdecea"], media: ["Media", "#b45309", "#fff4e5"], baja: ["Baja", "#166534", "#e9f7ef"] };
const ESTADOS = {
  pendiente: ["Pendiente", "#b45309", "#fff4e5"],
  en_proceso: ["En proceso", AZUL, "#eef2f8"],
  campana_creada: ["Campaña creada", "#166534", "#e9f7ef"],
  cancelado: ["Cancelado", GRIS, "#f1f5f9"],
};
const abierto = (r) => r.estado === "pendiente" || r.estado === "en_proceso";
const fecha = (d) => (d ? new Date(d + (String(d).length === 10 ? "T12:00:00" : "")).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "—");
const fechaHora = (d) => (d ? new Date(d).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const lbl = { display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#344054", fontWeight: 600 };
const INP = { height: 40, border: "1px solid #d0d5dd", borderRadius: 8, padding: "0 10px", fontSize: 13.5, width: "100%", boxSizing: "border-box", background: "#fff", fontFamily: "inherit", color: "#101828" };
const AREA = { ...INP, height: "auto", minHeight: 64, padding: "8px 10px", resize: "vertical" };
const chip = ([t, c, bg]) => <span style={{ background: bg, color: c, borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>{t}</span>;

function Sla({ r, ahora }) {
  if (!abierto(r)) {
    if (r.estado !== "campana_creada" || !r.atendido_en) return <span style={{ color: GRIS, fontSize: 12 }}>—</span>;
    const h = (new Date(r.atendido_en) - new Date(r.creado_en)) / 3600000;
    const ok = new Date(r.atendido_en) <= new Date(r.vence_en);
    return <span style={{ fontSize: 12, fontWeight: 700, color: ok ? "#166534" : "#b42318" }}>{ok ? "✓ En plazo" : "Fuera de plazo"} · {h.toFixed(1)} h</span>;
  }
  const ms = new Date(r.vence_en).getTime() - ahora, v = ms <= 0, a = Math.abs(ms);
  const t = `${v ? "-" : ""}${String(Math.floor(a / 3600000)).padStart(2, "0")}:${String(Math.floor((a % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((a % 60000) / 1000)).padStart(2, "0")}`;
  const color = v ? "#b42318" : ms < 6 * 3600000 ? "#b45309" : AZUL;
  return <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, color, background: v ? "#fdecea" : "transparent", borderRadius: 6, padding: "2px 6px" }}>{t}</span>;
}

export default function Requerimientos({ usuario, modo = "jefe", onCrearCampana }) {
  const [lista, setLista] = useState(null);
  const [centros, setCentros] = useState([]);
  const [vista, setVista] = useState("abiertos");
  const [ahora, setAhora] = useState(Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const por = usuario?.email || usuario?.nombre || "brain";

  const cargar = async () => {
    const [r, c] = await Promise.all([
      sb.from("ref_requerimientos").select("*").order("creado_en", { ascending: false }).limit(500),
      sb.from("centros_mx").select("sc, nombre").eq("activo", true).order("nombre"),
    ]);
    if (r.error) { setError("No se pudieron cargar los requerimientos: " + r.error.message); return; }
    setError(""); setLista(r.data || []); setCentros(c.data || []);
  };
  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);

  const nombreSc = (sc) => (centros.find((c) => c.sc === sc) || {}).nombre || sc;
  const filas = useMemo(() => (lista || []).filter((r) => (vista === "abiertos" ? abierto(r) : !abierto(r)))
    .sort((a, b) => (vista === "abiertos" ? new Date(a.vence_en) - new Date(b.vence_en) : new Date(b.creado_en) - new Date(a.creado_en))), [lista, vista]);

  const cambiarEstado = async (r, estado, nota) => {
    setBusy(true);
    const { error: e } = await sb.rpc("fn_ref_req_estado", { p_id: r.id, p_estado: estado, p_nota: nota || null, p_por: por });
    setBusy(false);
    if (e) { alert("No se pudo guardar: " + e.message); return; }
    cargar();
  };

  const nAbiertos = (lista || []).filter(abierto).length;
  const nVencidos = (lista || []).filter((r) => abierto(r) && new Date(r.vence_en) < ahora).length;

  return (
    <div>
      {modo === "jefe" && <Formulario centros={centros} por={por} onCreado={cargar} />}

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 12px", flexWrap: "wrap" }}>
        {[["abiertos", `Abiertos (${nAbiertos})`], ["cerrados", "Cerrados"]].map(([k, t]) => (
          <button key={k} onClick={() => setVista(k)}
            style={{ border: `1px solid ${vista === k ? AZUL : BORDE}`, background: vista === k ? AZUL : "#fff", color: vista === k ? "#fff" : GRIS, borderRadius: 20, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t}</button>
        ))}
        {nVencidos > 0 && <span style={{ background: "#fdecea", color: "#b42318", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700 }}>⚠ {nVencidos} fuera de plazo</span>}
        <span style={{ marginLeft: "auto", fontSize: 12, color: GRIS }}>SLA de 24 h desde que se crea la solicitud</span>
      </div>

      {error && <div style={{ background: "#fdecea", color: "#b42318", borderRadius: 10, padding: 12, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {lista === null ? <div style={{ color: GRIS, fontSize: 13, padding: 20 }}>Cargando…</div> : filas.length === 0 ? (
        <div style={{ background: "#fff", border: `0.5px solid ${BORDE}`, borderRadius: 12, padding: 24, textAlign: "center", color: GRIS, fontSize: 13 }}>
          {vista === "abiertos" ? "No hay requerimientos abiertos." : "Todavía no hay requerimientos cerrados."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
          {filas.map((r) => (
            <Tarjeta key={r.id} r={r} ahora={ahora} modo={modo} busy={busy} nombreSc={nombreSc}
              onEstado={cambiarEstado} onCrearCampana={onCrearCampana} />
          ))}
        </div>
      )}
    </div>
  );
}

function Tarjeta({ r, ahora, modo, busy, nombreSc, onEstado, onCrearCampana }) {
  const vencido = abierto(r) && new Date(r.vence_en) < ahora;
  const fila = (t, v) => (
    <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.45 }}>
      <span style={{ width: 92, flexShrink: 0, color: GRIS }}>{t}</span><span style={{ color: "#101828", minWidth: 0 }}>{v}</span>
    </div>
  );
  return (
    <div style={{ background: "#fff", border: `1px solid ${vencido ? "#f4c7c3" : BORDE}`, borderLeft: `4px solid ${vencido ? "#b42318" : abierto(r) ? NARANJA : "#cbd5e1"}`,
      borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: GRIS, fontWeight: 600 }}>REQUERIMIENTO #{r.id}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: AZUL }}>{nombreSc(r.sc)} <span style={{ fontSize: 12, color: GRIS, fontWeight: 500 }}>{r.sc}</span></div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10.5, color: GRIS, fontWeight: 600, marginBottom: 2 }}>{abierto(r) ? "SLA 24 H" : "RESULTADO"}</div>
          <Sla r={r} ahora={ahora} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {chip(URGENCIAS[r.urgencia] || [r.urgencia, GRIS, "#f1f5f9"])}
        {chip(ESTADOS[r.estado] || [r.estado, GRIS, "#f1f5f9"])}
        {(r.vehiculos || []).map((v, i) => (
          <span key={i} style={{ background: "#eef2f8", color: AZUL, borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 700 }}>{v.cantidad} {v.tipo}</span>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: `1px solid ${BORDE}`, paddingTop: 10 }}>
        {fila("Para cuándo", fecha(r.fecha_requerida))}
        {fila("Comentario", <span style={{ whiteSpace: "pre-wrap" }}>{r.comentario}</span>)}
        {fila("Pidió", <>{r.solicitado_por} <span style={{ color: GRIS }}>· {fechaHora(r.creado_en)}</span></>)}
        {r.nota_analista && fila("Referidos", <span style={{ color: AZUL }}>{r.nota_analista}</span>)}
        {r.atendido_por && !abierto(r) && fila("Atendió", <>{r.atendido_por} <span style={{ color: GRIS }}>· {fechaHora(r.atendido_en)}</span></>)}
      </div>
      {abierto(r) && (modo === "analista" ? onCrearCampana && (
        <button disabled={busy} onClick={() => onCrearCampana(r)} style={{ ...btn(NARANJA), padding: "9px 0", fontSize: 13 }}>Crear campaña</button>
      ) : (
        <button disabled={busy} onClick={() => { if (window.confirm("¿Cancelar este requerimiento?")) onEstado(r, "cancelado"); }}
          style={{ ...btn("#b42318", true), alignSelf: "flex-end" }}>Cancelar</button>
      ))}
    </div>
  );
}

const btn = (c, borde) => ({ background: borde ? "#fff" : c, color: borde ? c : "#fff", border: `1px solid ${c}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" });

// ── Formulario del jefe: todos los campos obligatorios ─────────────────────
function Formulario({ centros, por, onCreado }) {
  const VACIO = { sc: "", vehiculos: [{ tipo: "", cantidad: "" }], urgencia: "", fecha: "", comentario: "" };
  const [f, setF] = useState(VACIO);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const setV = (i, k, v) => setF((x) => ({ ...x, vehiculos: x.vehiculos.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const hoy = new Date().toISOString().slice(0, 10);

  const crear = async () => {
    setMsg("");
    const vs = f.vehiculos.map((v) => ({ tipo: v.tipo.trim(), cantidad: Number(v.cantidad) }));
    if (!f.sc) return setMsg("Elige el Service Center.");
    if (vs.some((v) => !v.tipo || !(v.cantidad > 0))) return setMsg("Cada vehículo necesita tipo y cantidad.");
    if (!f.urgencia) return setMsg("Elige la urgencia.");
    if (!f.fecha) return setMsg("Indica para cuándo se necesita.");
    if (!f.comentario.trim()) return setMsg("Escribe un comentario: turno, horario, zona, lo que sirva a Referidos.");
    setBusy(true);
    const { error } = await sb.rpc("fn_ref_req_crear", { p_sc: f.sc, p_vehiculos: vs, p_urgencia: f.urgencia, p_fecha: f.fecha, p_comentario: f.comentario.trim(), p_por: por });
    setBusy(false);
    if (error) return setMsg("No se pudo crear: " + error.message);
    setF(VACIO); setMsg("✓ Requerimiento enviado a Referidos. El SLA de 24 h ya está corriendo.");
    onCreado();
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 12, padding: 18, marginBottom: 18 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: AZUL }}>Pedir transportistas a Referidos</div>
      <div style={{ fontSize: 12.5, color: GRIS, margin: "2px 0 14px" }}>Todos los campos son obligatorios. Referidos tiene 24 h para crear la campaña.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <label style={lbl}>Service Center
          <select style={INP} value={f.sc} onChange={(e) => setF({ ...f, sc: e.target.value })}>
            <option value="">Elige un SC</option>
            {centros.map((c) => <option key={c.sc} value={c.sc}>{c.nombre} ({c.sc})</option>)}
          </select>
        </label>
        <label style={lbl}>Urgencia
          <select style={INP} value={f.urgencia} onChange={(e) => setF({ ...f, urgencia: e.target.value })}>
            <option value="">Elige</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
          </select>
        </label>
        <label style={lbl}>¿Para cuándo?
          <input style={INP} type="date" min={hoy} value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
        </label>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: "#344054", fontWeight: 600 }}>Vehículos</div>
      {f.vehiculos.map((v, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) 40px", gap: 10, marginTop: 6 }}>
          {/* Lista de tipos conocidos; si no está, "Otro" deja escribirlo a mano. */}
          {v.otro ? (
            <div style={{ display: "flex", gap: 6 }}>
              <input style={INP} autoFocus value={v.tipo} placeholder="Escribe el tipo de vehículo" onChange={(e) => setV(i, "tipo", e.target.value)} />
              <button title="Volver a la lista" onClick={() => setF((x) => ({ ...x, vehiculos: x.vehiculos.map((r, j) => (j === i ? { ...r, otro: false, tipo: "" } : r)) }))}
                style={{ ...btn(GRIS, true), height: 40, padding: "0 10px", whiteSpace: "nowrap" }}>Lista</button>
            </div>
          ) : (
            <select style={INP} value={v.tipo} onChange={(e) => (e.target.value === "__otro"
              ? setF((x) => ({ ...x, vehiculos: x.vehiculos.map((r, j) => (j === i ? { ...r, otro: true, tipo: "" } : r)) }))
              : setV(i, "tipo", e.target.value))}>
              <option value="">Tipo de vehículo</option>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="__otro">Otro (escribir a mano)…</option>
            </select>
          )}
          <input style={INP} type="number" min="1" value={v.cantidad} placeholder="Cantidad" onChange={(e) => setV(i, "cantidad", e.target.value)} />
          {f.vehiculos.length > 1
            ? <button title="Quitar" onClick={() => setF((x) => ({ ...x, vehiculos: x.vehiculos.filter((_, j) => j !== i) }))} style={{ ...btn("#b42318", true), height: 40, padding: 0 }}>✕</button>
            : <span />}
        </div>
      ))}
      <button onClick={() => setF((x) => ({ ...x, vehiculos: [...x.vehiculos, { tipo: "", cantidad: "" }] }))}
        style={{ background: "none", border: "none", color: AZUL, fontWeight: 600, fontSize: 13, cursor: "pointer", padding: "8px 0 0" }}>＋ Otro tipo de vehículo</button>

      <label style={{ ...lbl, marginTop: 12 }}>Comentario
        <textarea style={AREA} value={f.comentario} onChange={(e) => setF({ ...f, comentario: e.target.value })} placeholder="Turno, horario, zona, por qué se necesita…" />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <button disabled={busy} onClick={crear} style={{ ...btn(NARANJA), padding: "11px 22px", fontSize: 13.5 }}>{busy ? "Enviando…" : "Enviar a Referidos"}</button>
        {msg && <span style={{ fontSize: 13, color: msg.startsWith("✓") ? "#166534" : "#b42318" }}>{msg}</span>}
      </div>
    </div>
  );
}
