// ═══════════════════════════════════════════════════════════════════════════
// POSVENTA · CANON  (sub-pestaña de Posventa en el Brain Chile)
//
// Casos de postventa de Canon copiados desde Pipefy por canon-cl.cjs (VPS de
// Chile), SOLO LECTURA, a bigticket-cl.canon_casos_cl:
//   formulario  reclamo del cliente final (pipe Cuidado al Cliente)
//   correo      lo que Canon escribe a postventa@bigticket.cl (pipe Postventa)
// Región, comuna y estado del pedido vienen de DispatchTrack.
//
// Plazo: el que definan los analistas por canal (48 h por defecto).
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, Fragment } from "react";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";

const C = {
  navy: "#1a3a6b", navyTenue: "#eef2f8",
  naranja: "#F47B20", naranjaTenue: "#fdf1e6",
  ladrillo: "#9e3b1b", ladrilloTenue: "#faece6",
  verde: "#1f7a5c", verdeTenue: "#e9f3ef",
  morado: "#6b4fa0", moradoTenue: "#f1edf8",
  gris: "#8a94a6", grisTenue: "#f4f6f9",
  borde: "#e4e7ec", texto: "#1f2937", suave: "#475569", tenue: "#94a3b8",
};
// Plazos por canal desde postventa_sla_cl (editables en "Plazos" de la bandeja).
let CFG = { formulario: { sla: 48, dom: false }, correo: { sla: 48, dom: false } };
const TZ = "America/Santiago";
const REFRESCO_MS = 60 * 1000;

async function api(path) {
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, { headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}` } });
  if (!r.ok) throw new Error(`La consulta falló (HTTP ${r.status}). ${(await r.text()).slice(0, 250)}`);
  return r.json();
}

const fechaCorta = (iso) => {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(",", "");
  } catch (e) { return "—"; }
};
const hhmm = (h) => `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
const diaSemana = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date(ms));

// Horas transcurridas sin contar domingos (hora de Chile), en tramos de 15 min.
function horasSinDomingo(desdeIso, hastaMs, descontar = true) {
  if (!desdeIso) return 0;
  if (!descontar) return Math.max(0, (hastaMs - new Date(desdeIso).getTime()) / 3600000);
  const PASO = 15 * 60000;
  let t = new Date(desdeIso).getTime(), total = 0;
  while (t < hastaMs) {
    const sig = Math.min(hastaMs, t + PASO);
    if (diaSemana(t) !== "Sun") total += sig - t;
    t = sig;
  }
  return total / 3600000;
}

const esCanon = (c) => /canontex/i.test(c.mandante || "") || /@canontex\.cl\s*$/i.test(c.correo || "");

// Estado del caso a partir de la fase de Pipefy y de si hay respuesta.
function estadoDe(c) {
  const f = String(c.fase || "").toLowerCase();
  if (f.includes("resuelt")) return "cerrado";
  if (c.canal === "formulario") {
    if (f.includes("pendiente")) return "por_clasificar";
    if (f.includes("mandante")) return "derivado";
    if (f.includes("postventa")) return c.respuesta ? "respondido" : "pendiente";
  }
  return c.respuesta ? "respondido" : "pendiente";
}
const ESTADOS = {
  por_clasificar: { etiqueta: "Por clasificar", nota: "formulario sin revisar", color: C.naranja, tinte: C.naranjaTenue, reloj: true },
  pendiente:      { etiqueta: "Pendiente supervisor", nota: "sin respuesta", color: C.ladrillo, tinte: C.ladrilloTenue, reloj: true },
  respondido:     { etiqueta: "Respondido", nota: "con respuesta, sin cerrar", color: C.navy, tinte: C.navyTenue },
  derivado:       { etiqueta: "Derivado a Canon", nota: "problema de producto", color: C.morado, tinte: C.moradoTenue },
  cerrado:        { etiqueta: "Cerrado", nota: "resuelto en Pipefy", color: C.verde, tinte: C.verdeTenue },
};
const ORDEN_ESTADOS = ["por_clasificar", "pendiente", "respondido", "derivado", "cerrado"];

function Plazo({ c, ahora }) {
  const e = ESTADOS[estadoDe(c)];
  if (!e.reloj) return <span style={{ fontSize: 11, color: C.gris }}>—</span>;
  const cf = CFG[c.canal] || CFG.formulario;
  const SLA_H = cf.sla;
  const usado = horasSinDomingo(c.creado_en, ahora, cf.dom);
  const resta = SLA_H - usado;
  const vencido = resta <= 0;
  const color = vencido ? C.ladrillo : resta < 4 ? C.ladrillo : resta < 8 ? C.naranja : C.navy;
  const ancho = Math.max(0, Math.min(100, (usado / SLA_H) * 100));
  return (
    <span style={{ display: "block" }} title={`Plazo de ${SLA_H} h${cf.dom ? " sin contar domingos" : ""}`}>
      <span style={{ fontSize: 12, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
        {vencido ? `vencido +${hhmm(-resta)}` : hhmm(resta)}
      </span>
      <span style={{ fontSize: 8.5, color: C.tenue }}> /{SLA_H}</span>
      <span style={{ display: "block", height: 3, borderRadius: 2, background: "#e6eaf1", marginTop: 2 }}>
        <span style={{ display: "block", height: 3, borderRadius: 2, width: `${ancho}%`, background: color }} />
      </span>
    </span>
  );
}

function Chip({ estado }) {
  const e = ESTADOS[estado];
  return (
    <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600, color: e.color, border: `1px solid ${e.color}`,
      borderRadius: 20, padding: "1px 8px", whiteSpace: "nowrap" }}>{e.etiqueta}</span>
  );
}

function Dato({ etiqueta, valor }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 9.5, color: C.tenue, textTransform: "uppercase", letterSpacing: .3, fontWeight: 600 }}>{etiqueta}</div>
      <div style={{ fontSize: 12.5, color: C.texto, marginTop: 1, wordBreak: "break-word" }}>{valor || "—"}</div>
    </div>
  );
}

function Detalle({ c }) {
  const sup = c._sup ? `${c._sup}${c._sugerido ? " (sugerido por el CECO; en Pipefy todavía no está asignado)" : ""}` : null;
  return (
    <div style={{ padding: "12px 16px 14px 44px", background: C.grisTenue, borderTop: `1px solid ${C.borde}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(240px,1fr)", gap: 12 }}>
        <div>
          <div style={{ border: `1px solid ${C.borde}`, borderRadius: 10, background: "#fff", padding: "9px 11px", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.suave, marginBottom: 6 }}>
              {c.canal === "formulario" ? "Lo que escribió el cliente" : "Correo de Canon"}
            </div>
            {c.canal === "correo" && <div style={{ fontSize: 12, fontWeight: 600, color: C.texto, marginBottom: 4 }}>{c.titulo}</div>}
            <div style={{ fontSize: 12.5, color: C.texto, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto", lineHeight: 1.5 }}>
              {c.texto || "—"}
            </div>
          </div>
          <div style={{ border: `1px solid ${C.borde}`, borderRadius: 10, background: "#fff", padding: "9px 11px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.suave, marginBottom: 6 }}>Respuesta</div>
            <div style={{ fontSize: 12.5, color: c.respuesta ? C.texto : C.tenue, whiteSpace: "pre-wrap" }}>{c.respuesta || "Todavía sin respuesta."}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ border: `1px solid ${C.borde}`, borderRadius: 10, background: "#fff", padding: "9px 11px",
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
            <Dato etiqueta="Pedido" valor={c.pedido} />
            <Dato etiqueta="Canal" valor={c.canal === "formulario" ? "Formulario cliente" : "Correo de Canon"} />
            <Dato etiqueta={c.canal === "formulario" ? "Cliente" : "Remitente"} valor={c.remitente} />
            <Dato etiqueta="Correo" valor={c.correo} />
            <Dato etiqueta="Motivo marcado" valor={c.motivo} />
            <Dato etiqueta="Mandante en Pipefy" valor={c.mandante} />
            <Dato etiqueta="Región" valor={c.region} />
            <Dato etiqueta="Comuna" valor={c.comuna} />
            <Dato etiqueta="Estado del pedido" valor={c.estado_pedido} />
            <Dato etiqueta="CECO" valor={c.ceco} />
            <Dato etiqueta="Supervisor" valor={sup} />
            <Dato etiqueta="Fase en Pipefy" valor={c.fase} />
            <Dato etiqueta="Fecha límite Pipefy" valor={c.fecha_limite} />
            <Dato etiqueta="Creado" valor={fechaCorta(c.creado_en)} />
          </div>
          <a href={`https://app.pipefy.com/open-cards/${c.card_id}`} target="_blank" rel="noreferrer"
            style={{ fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 9, textAlign: "center",
              border: `1px solid ${C.navy}`, background: "#fff", color: C.navy, textDecoration: "none" }}>
            Abrir tarjeta en Pipefy
          </a>
        </div>
      </div>
    </div>
  );
}

const GRID = "14px 96px 92px 110px minmax(150px,1fr) 92px 150px 140px 96px";

export default function ModuloCanonCL() {
  const [casos, setCasos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [estado, setEstado] = useState("abiertos");
  const [canal, setCanal] = useState("todos");
  const [ceco, setCeco] = useState("todos");
  const [supervisor, setSupervisor] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [abiertas, setAbiertas] = useState(new Set());
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    try {
      const filas = await api("canon_casos_cl?select=card_id,canal,creado_en,fase,titulo,mandante,pedido,remitente,correo,motivo,texto,ceco,supervisor,fecha_limite,respuesta,region,comuna,estado_pedido&order=creado_en.desc&limit=3000");
      try {
        const sla = await api("postventa_sla_cl?origen=in.(canon_formulario,canon_correo)&select=origen,sla_horas,sin_domingos");
        for (const x of sla || []) CFG[x.origen === "canon_correo" ? "correo" : "formulario"] = { sla: Number(x.sla_horas) || 48, dom: !!x.sin_domingos };
      } catch (e) {}
      setCasos((filas || []).filter(esCanon));
      setError("");
    } catch (e) { setError(e.message); } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t); }, []);

  // Supervisor sugerido por CECO: el más frecuente entre los casos que ya
  // tienen supervisor asignado en Pipefy. Se ajusta solo si cambia la asignación.
  const supervisorPorCeco = useMemo(() => {
    const cuenta = {};
    for (const c of casos) {
      if (!c.ceco || !c.supervisor) continue;
      cuenta[c.ceco] = cuenta[c.ceco] || {};
      cuenta[c.ceco][c.supervisor] = (cuenta[c.ceco][c.supervisor] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(cuenta).map(([k, v]) => [k, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]));
  }, [casos]);

  const conEstado = useMemo(() => casos.map((c) => {
    const _estado = estadoDe(c);
    // Solo se sugiere donde corresponde un supervisor: casos de entrega abiertos o respondidos.
    const aplica = ["pendiente", "respondido"].includes(_estado);
    const sugerido = !c.supervisor && aplica && c.ceco ? supervisorPorCeco[c.ceco] || null : null;
    return { ...c, _estado, _sup: c.supervisor || sugerido, _sugerido: !!sugerido };
  }), [casos, supervisorPorCeco]);
  const conteo = useMemo(() => {
    const t = Object.fromEntries(ORDEN_ESTADOS.map((k) => [k, 0]));
    for (const c of conEstado) t[c._estado]++;
    return t;
  }, [conEstado]);

  const cecos = [...new Set(conEstado.map((c) => c.ceco).filter(Boolean))].sort();
  const supervisores = [...new Set(conEstado.map((c) => c._sup).filter(Boolean))].sort();

  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return conEstado
      .filter((c) => estado === "todos" ? true : estado === "abiertos" ? !!ESTADOS[c._estado].reloj : c._estado === estado)
      .filter((c) => canal === "todos" || c.canal === canal)
      .filter((c) => ceco === "todos" || (ceco === "__sin" ? !c.ceco : c.ceco === ceco))
      .filter((c) => supervisor === "todos" || (supervisor === "__sin" ? !c._sup : c._sup === supervisor))
      .filter((c) => !q || [c.pedido, c.remitente, c.correo, c.titulo, c.texto, c.card_id].some((v) => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => {
        const ra = ESTADOS[a._estado].reloj ? 0 : 1, rb = ESTADOS[b._estado].reloj ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return ra === 0 ? new Date(a.creado_en) - new Date(b.creado_en) : new Date(b.creado_en) - new Date(a.creado_en);
      });
  }, [conEstado, estado, canal, ceco, supervisor, busqueda]);

  // Vista por supervisor: abiertos y vencidos de cada uno.
  const porSupervisor = useMemo(() => {
    const m = {};
    for (const c of conEstado) {
      if (!ESTADOS[c._estado].reloj) continue;
      const k = c._sup || "Sin supervisor";
      m[k] = m[k] || { abiertos: 0, vencidos: 0, sugeridos: 0 };
      m[k].abiertos++;
      if (c._sugerido) m[k].sugeridos++;
      const cf = CFG[c.canal] || CFG.formulario;
      if (horasSinDomingo(c.creado_en, ahora, cf.dom) >= cf.sla) m[k].vencidos++;
    }
    return Object.entries(m).sort((a, b) => b[1].vencidos - a[1].vencidos || b[1].abiertos - a[1].abiertos);
  }, [conEstado, ahora]);

  const sel = { fontSize: 12, padding: "5px 9px", borderRadius: 8, border: `1px solid ${C.borde}`, fontFamily: "inherit", background: "#fff" };
  const abiertosTotal = conteo.por_clasificar + conteo.pendiente;

  return (
    <div>
      {error && (
        <div style={{ background: C.ladrilloTenue, border: `1px solid ${C.ladrillo}55`, color: C.ladrillo, borderRadius: 10,
          padding: "10px 14px", fontSize: 12.5, marginBottom: 12 }}>{error}</div>
      )}

      {/* Tarjetas por estado: son el filtro */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        {ORDEN_ESTADOS.map((k) => {
          const e = ESTADOS[k];
          const activa = estado === k;
          return (
            <button key={k} onClick={() => setEstado(activa ? "abiertos" : k)}
              style={{ flex: 1, minWidth: 150, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                background: activa ? e.tinte : "#fff", border: `1px solid ${activa ? e.color : C.borde}`,
                borderTop: `3px solid ${e.color}`, borderRadius: 12, padding: "10px 14px" }}>
              <div style={{ fontSize: 10.5, color: activa ? e.color : C.suave, textTransform: "uppercase", letterSpacing: .3, fontWeight: activa ? 700 : 500 }}>{e.etiqueta}</div>
              <div style={{ fontSize: 23, fontWeight: 600, color: C.texto, lineHeight: 1.3 }}>{conteo[k]}</div>
              <div style={{ fontSize: 11, color: C.tenue }}>{e.nota}</div>
            </button>
          );
        })}
      </div>

      {/* Vista por supervisor */}
      {porSupervisor.length > 0 && (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "9px 14px", marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.texto, marginBottom: 6 }}>
            Abiertos por supervisor <span style={{ color: C.tenue, fontWeight: 400 }}>· {abiertosTotal} en total</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {porSupervisor.map(([s, v]) => {
              const activo = supervisor === s || (s === "Sin supervisor" && supervisor === "__sin");
              return (
                <span key={s} onClick={() => { setSupervisor(activo ? "todos" : s === "Sin supervisor" ? "__sin" : s); setEstado("abiertos"); }}
                  style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                    border: `1px solid ${activo ? C.navy : v.vencidos ? C.ladrillo + "88" : C.borde}`,
                    background: activo ? C.navyTenue : "#fff", color: C.texto }}>
                  <strong>{s}</strong> {v.abiertos}
                  {v.vencidos > 0 && <span style={{ color: C.ladrillo, fontWeight: 700 }}> · {v.vencidos} vencidos</span>}
                  {v.sugeridos > 0 && <span style={{ color: C.naranja }}> · {v.sugeridos} sin asignar en Pipefy</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Lista */}
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.texto }}>
            {estado === "abiertos" ? "Abiertos" : estado === "todos" ? "Todos" : ESTADOS[estado].etiqueta}
          </span>
          {estado !== "abiertos" && (
            <button onClick={() => setEstado("abiertos")} style={{ ...sel, borderRadius: 20, cursor: "pointer", color: C.suave }}>← abiertos</button>
          )}
          <button onClick={() => setEstado("todos")} style={{ ...sel, borderRadius: 20, cursor: "pointer",
            color: estado === "todos" ? C.navy : C.suave, borderColor: estado === "todos" ? C.navy : C.borde }}>Todos</button>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar pedido, cliente o texto" style={{ ...sel, minWidth: 200 }} />
          <select value={canal} onChange={(e) => setCanal(e.target.value)} style={sel}>
            <option value="todos">Los dos canales</option>
            <option value="formulario">Formulario cliente</option>
            <option value="correo">Correo de Canon</option>
          </select>
          <select value={ceco} onChange={(e) => setCeco(e.target.value)} style={sel}>
            <option value="todos">Todos los CECO</option>
            {cecos.map((x) => <option key={x}>{x}</option>)}
            <option value="__sin">Sin CECO</option>
          </select>
          <select value={supervisor} onChange={(e) => setSupervisor(e.target.value)} style={sel}>
            <option value="todos">Todos los supervisores</option>
            {supervisores.map((x) => <option key={x}>{x}</option>)}
            <option value="__sin">Sin supervisor</option>
          </select>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.tenue }}>{lista.length} en pantalla</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 1000 }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "6px 16px", borderTop: `1px solid ${C.borde}`,
              background: C.grisTenue, fontSize: 9.5, letterSpacing: .3, textTransform: "uppercase", color: C.tenue, fontWeight: 600 }}>
              <span /><span>Creado</span><span>Canal</span><span>Pedido</span><span>Cliente / asunto</span>
              <span>CECO</span><span>Supervisor</span><span>Estado</span><span>Plazo</span>
            </div>
            {cargando ? (
              <div style={{ padding: 28, textAlign: "center", color: C.suave, fontSize: 13, borderTop: `1px solid ${C.borde}` }}>Cargando casos…</div>
            ) : !lista.length ? (
              <div style={{ padding: 28, textAlign: "center", color: C.suave, fontSize: 13, borderTop: `1px solid ${C.borde}` }}>Nada con estos filtros.</div>
            ) : lista.map((c) => {
              const abierta = abiertas.has(c.card_id);
              return (
                <Fragment key={c.card_id}>
                  <div onClick={() => setAbiertas((p) => { const n = new Set(p); n.has(c.card_id) ? n.delete(c.card_id) : n.add(c.card_id); return n; })}
                    style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "8px 16px", borderTop: `1px solid ${C.borde}`,
                      cursor: "pointer", alignItems: "center", background: abierta ? C.grisTenue : "#fff" }}>
                    <span style={{ color: C.tenue, fontSize: 10 }}>{abierta ? "▾" : "▸"}</span>
                    <span style={{ fontSize: 11.5, color: C.suave, fontVariantNumeric: "tabular-nums" }}>{fechaCorta(c.creado_en)}</span>
                    <span style={{ fontSize: 11, color: c.canal === "formulario" ? C.naranja : C.navy, fontWeight: 600 }}>
                      {c.canal === "formulario" ? "Formulario" : "Correo"}
                    </span>
                    <span style={{ fontSize: 12, color: C.navy, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.pedido || "—"}</span>
                    <span style={{ minWidth: 0, lineHeight: 1.25 }}>
                      <span style={{ display: "block", fontSize: 12.5, color: C.texto, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.canal === "formulario" ? c.remitente : c.titulo}
                      </span>
                      <span style={{ display: "block", fontSize: 10.5, color: C.tenue, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.canal === "formulario" ? c.motivo : c.remitente}
                      </span>
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: c.ceco ? C.texto : C.tenue }}>{c.ceco || "—"}</span>
                    <span style={{ minWidth: 0, lineHeight: 1.2 }} title={c._sugerido ? "Sugerido por el CECO: en Pipefy todavía no está asignado" : ""}>
                      <span style={{ display: "block", fontSize: 12, color: c._sup ? C.texto : C.tenue, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c._sup || "—"}</span>
                      {c._sugerido && <span style={{ display: "block", fontSize: 9.5, color: C.naranja, fontWeight: 700 }}>sugerido · sin asignar en Pipefy</span>}
                    </span>
                    <span><Chip estado={c._estado} /></span>
                    <Plazo c={c} ahora={ahora} />
                  </div>
                  {abierta && <Detalle c={c} />}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
