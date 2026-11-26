// ═══════════════════════════════════════════════════════════════════════════
// MANTENEDOR · CHILE
// Todo lo que define quién está a cargo de qué, en un solo lugar:
//   • Reemplazos           → quién cubre un CECO entre dos fechas (vacaciones,
//                            licencia, feriado…). En esas fechas el reemplazante
//                            ve el CECO en su bitácora con sus tareas obligatorias,
//                            el titular deja de verlo, y el Maestro le asigna los
//                            viajes de esos días (supervisor_reemplazos_cl).
//   • Supervisores y CECO  → los supervisores del Maestro (supervisores_cl) y los
//                            CECO que cada uno ve en la bitácora (supervisores_bt).
//                            Antes estaba en Maestro → Vehículos BT.
//   • Centros de colecta   → a qué CECO va cada centro de first mile de MELI
//                            (centros_colecta_cl: CLRM03 y CLRM04 → ML_RM_SRM1).
//   • Justificación de     → qué motivos de devolución se justifican solos: suben
//     devoluciones           el NS de la ruta y su pago (motivos_justificacion_cl).
//   • Pago de hitos        → montos de los hitos.
// CUIDADO DE ACTIVO (grupo aparte, 19-11-2026): TODOS sus mantenedores viven aquí,
//   ordenados por tema (General, Mantenciones, Auditorías, GPS y bitácora, WhatsApp).
//   La lista sale de CA_MANTENEDORES de CuidadoActivo.jsx; cada uno se dibuja allí.
//   Antes estaban repartidos en Cuidado de Activo (Mantenedores, Configuración y
//   Mantenciones); esas pestañas ahora avisan que se movieron aquí.
//
// Habla con la API REST del proyecto de Chile por fetch, igual que el Maestro.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { CalendarioRango, fechaCorta, difDias } from "./Maestro";
import CuidadoActivoCL, { CA_MANTENEDORES } from "./CuidadoActivo";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";
const NAVY = "#002E5D";
const AMBAR = "#a16207";
const VERDE = "#0d8043";
const ROJO = "#b42318";

async function api(path, opciones) {
  const o = opciones || {};
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    method: o.method || "GET",
    headers: Object.assign({ apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" }, o.headers || {}),
    body: o.body,
  });
  const texto = await r.text();
  if (!r.ok) {
    let m = texto;
    try { const j = JSON.parse(texto); m = j.message || j.hint || texto; } catch (e) { /* texto plano */ }
    throw new Error(String(m).slice(0, 300));
  }
  if (!texto || !texto.trim()) return true;
  try { return JSON.parse(texto); } catch (e) { return true; }
}
const apiSuave = async (path, porDefecto) => { try { return await api(path); } catch (e) { return porDefecto; } };
const rpc = (fn, args) => api(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args || {}) });

const hoyCL = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sumar = (s, k) => { const [y, m, d] = s.split("-").map(Number); const x = new Date(y, m - 1, d + k);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const listaCecos = (t) => [...new Set(String(t || "").split(",").map(x => x.trim().toUpperCase().replace(/\s+/g, " ")).filter(Boolean))];
const arr = (v) => (Array.isArray(v) ? v : []);
const MOTIVOS = ["Vacaciones", "Licencia médica", "Feriado", "Capacitación", "Permiso", "Otro"];

const CSS = `
.mt-wrap{font-family:inherit;color:#1f2937;}
.mt-card{background:#fff;border:1px solid #e6e9ef;border-radius:12px;padding:14px 16px;margin-bottom:14px;}
.mt-tit{font-size:14px;font-weight:800;color:${NAVY};}
.mt-sub{font-size:12px;color:#64748b;line-height:1.6;margin:3px 0 10px;max-width:980px;}
.mt-btn{border:1px solid ${NAVY};background:#fff;color:${NAVY};border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;}
.mt-btn:hover{background:${NAVY};color:#fff;}
.mt-btn:disabled{opacity:.55;cursor:default;}
.mt-btn.pri{background:${NAVY};color:#fff;}
.mt-btn.rojo{border-color:${ROJO};color:${ROJO};}
.mt-btn.rojo:hover{background:${ROJO};color:#fff;}
.mt-chip{border:1px solid #dfe4ec;background:#fff;border-radius:20px;padding:5px 12px;font-size:12.5px;cursor:pointer;font-family:inherit;color:#334155;}
.mt-chip.on{background:${NAVY};border-color:${NAVY};color:#fff;}
.mt-in{border:1px solid #dfe4ec;border-radius:8px;padding:6px 10px;font-size:12.5px;font-family:inherit;color:#1f2937;background:#fff;}
.mt-lbl{display:flex;flex-direction:column;gap:3px;font-size:10.5px;color:#64748b;font-weight:600;}
.mt-tabla{width:100%;border-collapse:collapse;font-size:12px;background:#fff;}
.mt-tabla th{background:${NAVY};color:#fff;font-size:10.5px;text-align:left;padding:7px 9px;letter-spacing:.3px;}
.mt-tabla td{padding:7px 9px;border-bottom:1px solid #eef1f5;vertical-align:middle;}
.mt-tabla tr:hover td{background:#f7faff;}
.mt-msg{font-size:12.5px;margin:6px 0;}
/* El calendario usa las clases del Maestro */
.mj-btn{border:1px solid ${NAVY};background:#fff;color:${NAVY};border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;}
.mj-btn:hover{background:${NAVY};color:#fff;}
.mj-chip{border:1px solid #dfe4ec;background:#fff;border-radius:20px;padding:4px 11px;font-size:12px;cursor:pointer;font-family:inherit;color:#334155;}
.mj-chip:hover{border-color:${NAVY};color:${NAVY};}
`;

const MAESTRO_MANT = [["glosario", "📖 Glosario del Maestro"], ["cecos", "🏢 CECO y centros MELI"], ["dt", "🚚 Clientes DispatchTrack"], ["reemplazos", "↺ Reemplazos"], ["supervisores", "👤 Supervisores y CECO"], ["lideres", "👥 Líderes y supervisores"], ["colectas", "📦 Centros de colecta"],
  ["justif", "⚖️ Justificación de devoluciones"], ["hitos", "💲 Pago de hitos"], ["categorias", "🏷️ Categorías de observación"]];

export default function ModuloMantenedorCL({ usuario } = {}) {
  const [vista, setVista] = useState("reemplazos");
  const quien = (usuario && (usuario.nombre || usuario.email)) || "brain";
  const grupos = [...new Set(CA_MANTENEDORES.map((x) => x[2]))];
  const esCA = vista.startsWith("ca:");
  const titulo = (t, c) => <div style={{ fontSize: 11, fontWeight: 800, color: c || NAVY, letterSpacing: ".4px", textTransform: "uppercase", margin: "2px 0 6px" }}>{t}</div>;
  return (
    <div className="mt-wrap">
      <style>{CSS}</style>
      <div className="mt-card" style={{ padding: "10px 14px" }}>
        {titulo("Maestro y operación")}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {MAESTRO_MANT.map(([k, t]) => <button key={k} className={`mt-chip ${vista === k ? "on" : ""}`} onClick={() => setVista(k)}>{t}</button>)}
        </div>
      </div>
      <div className="mt-card" style={{ padding: "10px 14px", borderColor: esCA ? "#FF6600" : undefined }}>
        {titulo("🛠️ Cuidado de Activo", "#c2410c")}
        {grupos.map((g) => (
          <div key={g} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, minWidth: 110 }}>{g}</span>
            {CA_MANTENEDORES.filter((x) => x[2] === g).map(([k, t]) => (
              <button key={k} className={`mt-chip ${vista === "ca:" + k ? "on" : ""}`} onClick={() => setVista("ca:" + k)}>{t}</button>
            ))}
          </div>
        ))}
      </div>
      {vista === "glosario" && <Glosario />}
      {vista === "cecos" && <CecosCentros quien={quien} />}
      {vista === "dt" && <ClientesDT quien={quien} />}
      {vista === "reemplazos" && <Reemplazos quien={quien} />}
      {vista === "supervisores" && <Supervisores quien={quien} />}
      {vista === "colectas" && <CentrosColecta quien={quien} />}
      {vista === "justif" && <JustificacionDevoluciones quien={quien} />}
      {vista === "hitos" && <PagoHitos quien={quien} />}
      {vista === "lideres" && <Lideres quien={quien} />}
      {vista === "categorias" && <CategoriasObs quien={quien} />}
      {esCA && (
        <div>
          <div className="mt-sub">Cuidado de Activo › {(CA_MANTENEDORES.find((x) => "ca:" + x[0] === vista) || [])[2]} › <b>{(CA_MANTENEDORES.find((x) => "ca:" + x[0] === vista) || [])[1]}</b></div>
          <CuidadoActivoCL usuario={usuario} sub={"ca_mant:" + vista.slice(3)} />
        </div>
      )}
    </div>
  );
}

// ── Reemplazos ─────────────────────────────────────────────────────────────
function Reemplazos({ quien }) {
  const hoy = hoyCL();
  const [lista, setLista] = useState(null);
  const [supBit, setSupBit] = useState([]);
  const [cecos, setCecos] = useState([]);
  const [f, setF] = useState({ ceco: "", reemplazante: "", desde: hoy, hasta: sumar(hoy, 6), motivo: "Vacaciones", nota: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [verHist, setVerHist] = useState(false);

  const cargar = async () => {
    const [r, sb, ca] = await Promise.all([
      apiSuave("vw_reemplazos_cl?select=*&order=desde.desc&limit=300", null),
      apiSuave("supervisores_bt?select=email,nombre,scs_asignados,activo,es_prueba&activo=eq.true&order=nombre", []),
      apiSuave("cecos_admin?select=nombre&activo=eq.true&order=nombre", []),
    ]);
    setLista(r); setSupBit(sb || []);
    setCecos([...new Set([...(ca || []).map(x => x.nombre), ...(sb || []).flatMap(b => arr(b.scs_asignados))].filter(c => /^ML_/.test(c)))].sort());
  };
  useEffect(() => { cargar(); }, []);

  const titulares = (ceco) => supBit.filter(b => !b.es_prueba && arr(b.scs_asignados).includes(ceco)).map(b => b.nombre);
  const guardar = async () => {
    setBusy(true); setMsg("");
    try {
      await rpc("fn_reemplazo_guardar", { p_ceco: f.ceco, p_reemplazante: f.reemplazante, p_desde: f.desde, p_hasta: f.hasta,
        p_motivo: f.motivo, p_nota: f.nota || null, p_por: quien });
      const nom = supBit.find(b => b.email === f.reemplazante)?.nombre || f.reemplazante;
      setMsg(`✓ Guardado: ${nom} queda a cargo de ${f.ceco} del ${fechaCorta(f.desde)} al ${fechaCorta(f.hasta)}.`);
      setF({ ...f, ceco: "", reemplazante: "", nota: "" });
      await cargar();
    } catch (e) { setMsg("No se pudo guardar: " + e.message); }
    finally { setBusy(false); }
  };
  const cambiar = async (x, accion) => {
    const txt = accion === "terminar"
      ? `¿Terminar hoy el reemplazo de ${x.reemplazante_nombre} en ${x.ceco}? Desde hoy ${x.ceco} vuelve a su titular.`
      : `¿Anular el reemplazo de ${x.reemplazante_nombre} en ${x.ceco} (${fechaCorta(x.desde)} al ${fechaCorta(x.hasta)})? Queda en el historial como anulado.`;
    if (!window.confirm(txt)) return;
    try { const r = await rpc("fn_reemplazo_cambiar", { p_id: x.id, p_accion: accion, p_por: quien });
      setMsg(r === "terminado" ? `✓ Reemplazo terminado: ${x.ceco} vuelve a su titular desde hoy.` : "✓ Reemplazo anulado."); await cargar(); }
    catch (e) { setMsg("No se pudo cambiar: " + e.message); }
  };

  if (lista === null) return (
    <div className="mt-card"><div className="mt-tit">Reemplazos</div>
      <div className="mt-sub" style={{ color: AMBAR }}>No se pudo leer la tabla de reemplazos: faltan los SQL de esta pasada (vw_reemplazos_cl).</div></div>
  );

  const activos = lista.filter(x => x.activo);
  const grupos = {
    vigentes: activos.filter(x => x.desde <= hoy && hoy <= x.hasta),
    proximos: activos.filter(x => x.desde > hoy).sort((a, b) => a.desde.localeCompare(b.desde)),
    historial: lista.filter(x => !x.activo || x.hasta < hoy),
  };
  const choque = f.ceco && activos.find(x => x.ceco === f.ceco && x.desde <= f.hasta && x.hasta >= f.desde);
  const esTitular = f.ceco && f.reemplazante && arr(supBit.find(b => b.email === f.reemplazante)?.scs_asignados).includes(f.ceco);
  const valido = f.ceco && f.reemplazante && f.desde && f.hasta && f.motivo && !choque && !esTitular && (f.motivo !== "Otro" || f.nota.trim());

  const fila = (x, acciones) => (
    <tr key={x.id} style={!x.activo ? { opacity: 0.5 } : {}}>
      <td style={{ fontWeight: 700, color: NAVY }}>{x.ceco}</td>
      <td>{x.titular || <span style={{ color: "#94a3b8" }}>—</span>}</td>
      <td style={{ fontWeight: 700 }}>{x.reemplazante_nombre}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fechaCorta(x.desde)} → {fechaCorta(x.hasta)}
        <span style={{ color: "#94a3b8" }}> · {difDias(x.desde, x.hasta) + 1} días</span></td>
      <td>{x.motivo}{x.nota ? <div style={{ color: "#64748b", fontSize: 11 }}>{x.nota}</div> : null}</td>
      <td style={{ fontSize: 11, color: "#64748b" }}>{x.creado_por || "—"}
        {!x.activo && <div style={{ color: ROJO }}>Anulado por {x.cambiado_por || "—"}</div>}</td>
      <td style={{ whiteSpace: "nowrap" }}>{acciones}</td>
    </tr>
  );
  const tabla = (filas, acciones) => (
    <div style={{ overflowX: "auto" }}>
      <table className="mt-tabla">
        <thead><tr><th>CECO</th><th>Titular</th><th>Reemplaza</th><th>Fechas</th><th>Motivo</th><th>Registró</th><th></th></tr></thead>
        <tbody>{filas.map(x => fila(x, acciones(x)))}</tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="mt-card">
        <div className="mt-tit">Nuevo reemplazo</div>
        <div className="mt-sub">
          Durante las fechas marcadas, el reemplazante ve el CECO en su bitácora con todas sus tareas obligatorias (colectas,
          PNR, viajes…) y el titular deja de verlo. En el Maestro, los viajes de ese CECO en esas fechas quedan a nombre del
          reemplazante. El día siguiente al término, todo vuelve solo al titular.
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 260, flex: "1 1 260px", maxWidth: 360 }}>
            <label className="mt-lbl">CECO
              <select className="mt-in" value={f.ceco} onChange={e => setF({ ...f, ceco: e.target.value })}>
                <option value="">Elige el CECO</option>
                {cecos.map(c => <option key={c} value={c}>{c}</option>)}
              </select></label>
            {f.ceco && (
              <div style={{ fontSize: 12, color: "#475569" }}>
                Titular hoy: <b>{titulares(f.ceco).join(", ") || "nadie tiene este CECO en la bitácora"}</b>
              </div>
            )}
            <label className="mt-lbl">Quién reemplaza
              <select className="mt-in" value={f.reemplazante} onChange={e => setF({ ...f, reemplazante: e.target.value })}>
                <option value="">Elige al supervisor</option>
                {supBit.map(b => <option key={b.email} value={b.email}>{b.nombre}{b.es_prueba ? " (prueba)" : ""}</option>)}
              </select></label>
            {esTitular && <div className="mt-msg" style={{ color: AMBAR }}>Esa persona ya tiene {f.ceco} en su bitácora: no es un reemplazo.</div>}
            <label className="mt-lbl">Motivo
              <select className="mt-in" value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })}>
                {MOTIVOS.map(m => <option key={m}>{m}</option>)}
              </select></label>
            <label className="mt-lbl">Nota {f.motivo === "Otro" ? "(obligatoria)" : "(opcional)"}
              <input className="mt-in" value={f.nota} onChange={e => setF({ ...f, nota: e.target.value })} placeholder="Ej.: vacaciones de verano" /></label>
            <div style={{ padding: "8px 10px", background: "#f6f8fb", borderRadius: 8, fontSize: 12.5 }}>
              <b style={{ color: NAVY }}>{fechaCorta(f.desde)}</b> al <b style={{ color: NAVY }}>{fechaCorta(f.hasta)}</b>
              <span style={{ color: "#64748b" }}> · {difDias(f.desde, f.hasta) + 1} días, ambos incluidos</span>
            </div>
            {choque && <div className="mt-msg" style={{ color: ROJO }}>
              Ya hay un reemplazo en {f.ceco} que se cruza con esas fechas ({choque.reemplazante_nombre}, {fechaCorta(choque.desde)} al {fechaCorta(choque.hasta)}).</div>}
            <button className="mt-btn pri" disabled={!valido || busy} onClick={guardar}>{busy ? "Guardando…" : "Guardar reemplazo"}</button>
            {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
          </div>
          <div style={{ flex: "1 1 520px" }}>
            <CalendarioRango futuro desde={f.desde} hasta={f.hasta} min={sumar(hoy, -30)}
                             onCambio={(a, b) => setF(v => ({ ...v, desde: a, hasta: b }))} />
          </div>
        </div>
      </div>

      <div className="mt-card">
        <div className="mt-tit">Vigentes hoy ({grupos.vigentes.length})</div>
        {grupos.vigentes.length ? tabla(grupos.vigentes, x => (
          <span style={{ display: "flex", gap: 6 }}>
            <button className="mt-btn" onClick={() => cambiar(x, "terminar")} title="El titular vuelve a cargo desde hoy">Terminar hoy</button>
            <button className="mt-btn rojo" onClick={() => cambiar(x, "anular")} title="Como si no hubiera existido">Anular</button>
          </span>
        )) : <div className="mt-sub">No hay reemplazos vigentes.</div>}
      </div>

      <div className="mt-card">
        <div className="mt-tit">Próximos ({grupos.proximos.length})</div>
        {grupos.proximos.length ? tabla(grupos.proximos, x => (
          <button className="mt-btn rojo" onClick={() => cambiar(x, "anular")}>Anular</button>
        )) : <div className="mt-sub">No hay reemplazos programados.</div>}
      </div>

      <div className="mt-card">
        <button className="mt-btn" onClick={() => setVerHist(v => !v)}>{verHist ? "▾" : "▸"} Historial ({grupos.historial.length})</button>
        {verHist && <div style={{ marginTop: 10 }}>{grupos.historial.length ? tabla(grupos.historial, () => null) : <div className="mt-sub">Sin historial.</div>}</div>}
      </div>
    </div>
  );
}

// ── Supervisores y CECO (antes en Maestro → Vehículos BT) ──────────────────
function Supervisores({ quien }) {
  const [sup, setSup] = useState(null);       // supervisores_cl (Maestro)
  const [supBit, setSupBit] = useState([]);   // supervisores_bt (bitácora)
  const [cecos, setCecos] = useState([]);
  const [nVeh, setNVeh] = useState({});
  const [nuevo, setNuevo] = useState({ nombre: "", correo: "", telefono: "", cecos: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(null);

  const cargar = async () => {
    const [sp, sb, ca, vo] = await Promise.all([
      apiSuave("supervisores_cl?order=nombre", []),
      apiSuave("supervisores_bt?select=email,nombre,scs_asignados,activo,es_prueba&order=nombre", []),
      apiSuave("cecos_admin?select=nombre&order=nombre", []),
      apiSuave("vw_vehiculos_bt?select=supervisor_id&supervisor_id=not.is.null&limit=5000", []),
    ]);
    setSup(sp || []); setSupBit(sb || []);
    setCecos([...new Set((ca || []).map(x => x.nombre))]);
    setNVeh((vo || []).reduce((m, x) => { m[x.supervisor_id] = (m[x.supervisor_id] || 0) + 1; return m; }, {}));
  };
  useEffect(() => { cargar(); }, []);

  const errorSup = (e) => {
    const m = String((e && e.message) || e || "");
    if (m.includes("supervisores_cl_nombre_uq") || m.includes("23505")) return "Ya existe un supervisor con ese nombre.";
    if (m.includes("supervisores_cl_nombre_chk")) return "El nombre del supervisor debe tener al menos 3 letras.";
    return m;
  };
  const avisar = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3500); };
  const actualizar = async (id, campos) => {
    setBusy(id);
    try { await api(`supervisores_cl?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ ...campos, actualizado_at: new Date().toISOString(), actualizado_por: quien }) });
          await cargar(); avisar("✓ Guardado"); }
    catch (e) { avisar(errorSup(e)); } finally { setBusy(null); }
  };
  const agregar = async () => {
    const nombre = nuevo.nombre.trim().replace(/\s+/g, " ");
    if (nombre.length < 3) { avisar("El nombre del supervisor debe tener al menos 3 letras."); return; }
    setBusy("__nuevo__");
    try { await api("supervisores_cl", { method: "POST", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ nombre, correo: nuevo.correo.trim() || null, telefono: nuevo.telefono.trim() || null,
                                   cecos_a_cargo: listaCecos(nuevo.cecos), actualizado_por: quien }) });
          setNuevo({ nombre: "", correo: "", telefono: "", cecos: "" }); await cargar(); avisar(`✓ Supervisor ${nombre} agregado`); }
    catch (e) { avisar(errorSup(e)); } finally { setBusy(null); }
  };
  const actualizarBit = async (email, campos) => {
    try { await api(`supervisores_bt?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify(campos) }); await cargar(); avisar("✓ Guardado en la bitácora"); }
    catch (e) { avisar(e.message); }
  };

  if (sup === null) return <div className="mt-card mt-sub">Cargando…</div>;
  const norm = (c) => String(c || "").toUpperCase().replace(/[_ ]/g, "");
  const cubiertos = new Set([
    ...supBit.filter(b => b.activo && !b.es_prueba).flatMap(b => arr(b.scs_asignados).map(norm)),
    ...sup.filter(x => x.activo).flatMap(x => arr(x.cecos_a_cargo).map(norm))]);
  const sinSup = cecos.filter(c => /^ML_/.test(c) && !cubiertos.has(norm(c)));

  return (
    <div>
      {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
      <div className="mt-card">
        <div className="mt-tit">CECO que ve cada supervisor en la bitácora</div>
        <div className="mt-sub">
          Es el titular de cada CECO: lo ve en su bitácora con sus tareas, y en el Maestro un viaje sin supervisor por patente
          toma al titular de su CECO. Para una ausencia con fechas usa <b>Reemplazos</b> en vez de cambiar esto.
          Los usuarios de prueba siguen en la bitácora, pero no cuentan como titulares.
        </div>
        {sinSup.length > 0 && <div className="mt-msg" style={{ color: AMBAR }}>⚠ CECO sin supervisor: <b>{sinSup.join(", ")}</b></div>}
        <div style={{ overflowX: "auto" }}>
          <table className="mt-tabla">
            <thead><tr><th>Supervisor</th><th>Correo</th><th>CECO a cargo (separados por coma)</th><th>Prueba</th></tr></thead>
            <tbody>
              {supBit.filter(b => b.activo).map(b => (
                <tr key={b.email} style={b.es_prueba ? { opacity: 0.55 } : {}}>
                  <td style={{ fontWeight: 600 }}>{b.nombre}</td>
                  <td style={{ fontSize: 11.5, color: "#64748b" }}>{b.email}</td>
                  <td><input className="mt-in" defaultValue={arr(b.scs_asignados).join(", ")} style={{ minWidth: 300 }}
                             onBlur={e => { const l = listaCecos(e.target.value);
                               if (l.join(",") !== arr(b.scs_asignados).join(",")) actualizarBit(b.email, { scs_asignados: l }); }} /></td>
                  <td><label style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={!!b.es_prueba} onChange={e => actualizarBit(b.email, { es_prueba: e.target.checked })} />
                    {" "}{b.es_prueba ? "de prueba" : "oficial"}</label></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-sub" style={{ marginTop: 8 }}>Las cuentas nuevas de la bitácora se crean con la invitación de siempre; aquí se ajustan sus CECO.</div>
      </div>

      <div className="mt-card">
        <div className="mt-tit">Supervisores del Maestro</div>
        <div className="mt-sub">
          Cambiar un nombre se refleja en todos sus vehículos y en el Maestro. Un supervisor que deja la operación se
          desactiva (no se borra): sus vehículos conservan el historial.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="mt-tabla" style={{ marginBottom: 10 }}>
            <thead><tr><th>Nombre completo</th><th title="Como aparece en el Maestro y en el export">Nombre en el maestro</th>
              <th>Correo</th><th>Teléfono</th><th title="CECO que supervisa, aunque no use la bitácora">CECO a cargo</th>
              <th>Vehículos</th><th>Estado</th></tr></thead>
            <tbody>
              {sup.map(sp => (
                <tr key={sp.id} style={!sp.activo ? { opacity: 0.55 } : {}}>
                  <td><input className="mt-in" defaultValue={sp.nombre} style={{ minWidth: 220 }}
                             onBlur={e => { const v = e.target.value.trim().replace(/\s+/g, " "); if (v && v !== sp.nombre) actualizar(sp.id, { nombre: v }); }} /></td>
                  <td><input className="mt-in" defaultValue={sp.nombre_corto || ""} placeholder="NOMBRE APELLIDO" style={{ minWidth: 150, fontWeight: 700 }}
                             onBlur={e => { const v = e.target.value.trim().replace(/\s+/g, " ").toUpperCase(); if (v && v !== (sp.nombre_corto || "")) actualizar(sp.id, { nombre_corto: v }); }} /></td>
                  <td><input className="mt-in" defaultValue={sp.correo || ""} placeholder="correo" style={{ minWidth: 190 }}
                             onBlur={e => { const v = e.target.value.trim(); if (v !== (sp.correo || "")) actualizar(sp.id, { correo: v || null }); }} /></td>
                  <td><input className="mt-in" defaultValue={sp.telefono || ""} placeholder="teléfono" style={{ width: 120 }}
                             onBlur={e => { const v = e.target.value.trim(); if (v !== (sp.telefono || "")) actualizar(sp.id, { telefono: v || null }); }} /></td>
                  <td><input className="mt-in" defaultValue={arr(sp.cecos_a_cargo).join(", ")} placeholder="ej. ML_MELIPILLA" style={{ minWidth: 170 }}
                             onBlur={e => { const v = listaCecos(e.target.value); if (v.join(",") !== arr(sp.cecos_a_cargo).join(",")) actualizar(sp.id, { cecos_a_cargo: v }); }} /></td>
                  <td style={{ textAlign: "right" }}>{nVeh[sp.id] || 0}</td>
                  <td><label style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={!!sp.activo} disabled={busy === sp.id} onChange={e => actualizar(sp.id, { activo: e.target.checked })} />
                    {" "}{sp.activo ? "activo" : "inactivo"}</label></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="mt-lbl">Nombre<input className="mt-in" value={nuevo.nombre} placeholder="NOMBRE APELLIDO APELLIDO" style={{ width: 230 }}
                 onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} /></label>
          <label className="mt-lbl">Correo<input className="mt-in" value={nuevo.correo} placeholder="nombre@bigticket.cl" style={{ width: 200 }}
                 onChange={e => setNuevo({ ...nuevo, correo: e.target.value })} /></label>
          <label className="mt-lbl">Teléfono<input className="mt-in" value={nuevo.telefono} placeholder="+56 9…" style={{ width: 120 }}
                 onChange={e => setNuevo({ ...nuevo, telefono: e.target.value })} /></label>
          <label className="mt-lbl">CECO a cargo<input className="mt-in" value={nuevo.cecos} placeholder="ML_MELIPILLA"
                 onChange={e => setNuevo({ ...nuevo, cecos: e.target.value })} /></label>
          <button className="mt-btn pri" disabled={busy === "__nuevo__" || !nuevo.nombre.trim()} onClick={agregar}>
            {busy === "__nuevo__" ? "Agregando…" : "➕ Agregar supervisor"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Centros de colecta (first mile) ────────────────────────────────────────
function CentrosColecta({ quien }) {
  const [filas, setFilas] = useState(null);
  const [cecos, setCecos] = useState([]);
  const [nuevo, setNuevo] = useState({ centro: "", ceco: "" });
  const [msg, setMsg] = useState("");
  const cargar = async () => {
    const [c, ca] = await Promise.all([
      apiSuave("centros_colecta_cl?select=centro,ceco&order=centro", []),
      apiSuave("cecos_admin?select=nombre&activo=eq.true&order=nombre", []),
    ]);
    setFilas(c || []); setCecos([...new Set((ca || []).map(x => x.nombre))].filter(x => /^ML_/.test(x)));
  };
  useEffect(() => { cargar(); }, []);
  const guardar = async (centro, ceco) => {
    setMsg("");
    try { await rpc("fn_centro_colecta_guardar", { p_centro: centro, p_ceco: ceco, p_por: quien });
          setMsg(ceco ? `✓ ${centro.toUpperCase()} → ${ceco}` : `✓ ${centro} quitado`); setNuevo({ centro: "", ceco: "" }); await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); }
  };
  if (filas === null) return <div className="mt-card mt-sub">Cargando…</div>;
  return (
    <div className="mt-card">
      <div className="mt-tit">Centros de colecta</div>
      <div className="mt-sub">
        MELI informa las colectas de first mile con su centro (CLRM03, CLRM04…). Aquí se define a qué CECO pertenece cada
        centro: ese CECO queda en el Maestro y en el pago, y su supervisor (o quien lo reemplace) confirma las colectas en
        su bitácora. Un cambio rige para las colectas que se recalculen desde ahora.
      </div>
      {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
      <table className="mt-tabla" style={{ maxWidth: 640 }}>
        <thead><tr><th>Centro MELI</th><th>CECO</th><th></th></tr></thead>
        <tbody>
          {filas.map(x => (
            <tr key={x.centro}>
              <td style={{ fontWeight: 700, color: NAVY }}>{x.centro}</td>
              <td><select className="mt-in" value={x.ceco || ""} onChange={e => e.target.value && guardar(x.centro, e.target.value)}>
                {[...new Set([x.ceco, ...cecos].filter(Boolean))].map(c => <option key={c}>{c}</option>)}
              </select></td>
              <td><button className="mt-btn rojo" onClick={() => window.confirm(`¿Quitar ${x.centro}? Sus colectas quedarán sin CECO en el Maestro hasta asignarlo de nuevo.`) && guardar(x.centro, null)}>Quitar</button></td>
            </tr>
          ))}
          <tr>
            <td><input className="mt-in" value={nuevo.centro} placeholder="CLRM05" style={{ width: 110 }}
                       onChange={e => setNuevo({ ...nuevo, centro: e.target.value.toUpperCase().trim() })} /></td>
            <td><select className="mt-in" value={nuevo.ceco} onChange={e => setNuevo({ ...nuevo, ceco: e.target.value })}>
              <option value="">Elige el CECO</option>{cecos.map(c => <option key={c}>{c}</option>)}</select></td>
            <td><button className="mt-btn pri" disabled={!nuevo.centro || !nuevo.ceco} onClick={() => guardar(nuevo.centro, nuevo.ceco)}>Agregar</button></td>
          </tr>
        </tbody>
      </table>
      <div className="mt-sub" style={{ marginTop: 8, color: "#94a3b8" }}>
        Ojo: la colecta de un centro que no está aquí queda sin CECO y con alerta en Revisión zonas. Esta regla rige
        solo para las colectas de los lunes; los otros días las rutas de entrega y retiro son de cada SC.
      </div>
      <RecolectaEnRuta quien={quien} cecos={cecos} />
    </div>
  );
}

// CECO donde la recolecta va dentro de la ruta UM (hoy Arica): su supervisor la
// marca en la bitácora y cada recolecta se paga como una guía más de la ruta.
function RecolectaEnRuta({ quien, cecos }) {
  const [hab, setHab] = useState(null);
  const [nuevo, setNuevo] = useState("");
  const [msg, setMsg] = useState("");
  const cargar = async () => setHab(await apiSuave("cecos_recolecta_ruta_cl?select=ceco,activo,actualizado_por&order=ceco", null));
  useEffect(() => { cargar(); }, []);
  const guardar = async (ceco, activo) => {
    setMsg("");
    try { await rpc("fn_ceco_recolecta_guardar", { p_ceco: ceco, p_activo: activo, p_por: quien });
          setMsg(`✓ ${ceco}: recolecta en ruta ${activo ? "activa" : "desactivada"}`); setNuevo(""); await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); }
  };
  if (hab === null) return <div className="mt-sub" style={{ marginTop: 16, color: AMBAR }}>Falta el SQL de recolectas en ruta (cecos_recolecta_ruta_cl).</div>;
  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #eef1f5" }}>
      <div className="mt-tit">Recolecta dentro de la ruta UM</div>
      <div className="mt-sub">
        En estos CECO la recolecta es un punto más de la ruta de última milla. Su supervisor marca en la bitácora
        (ítem "Recolectas en ruta") qué rutas recolectaron y cuántas veces; cada recolecta se paga como una guía más.
      </div>
      {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {hab.map(x => (
          <label key={x.ceco} className="mt-chip" style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={!!x.activo} onChange={e => guardar(x.ceco, e.target.checked)} />{x.ceco}
          </label>
        ))}
        <select className="mt-in" value={nuevo} onChange={e => setNuevo(e.target.value)}>
          <option value="">Agregar CECO…</option>
          {cecos.filter(c => !hab.some(x => x.ceco === c)).map(c => <option key={c}>{c}</option>)}
        </select>
        <button className="mt-btn pri" disabled={!nuevo} onClick={() => guardar(nuevo, true)}>Agregar</button>
      </div>
    </div>
  );
}

// ── Justificación automática de devoluciones ───────────────────────────────
// Cada motivo de devolución de MELI tiene un grupo y una regla Sí/No. Las
// devoluciones con un motivo que justifica cuentan como cumplidas en el NS de su
// ruta: (entregados + justificadas) ÷ cargados, y con eso en el pago.
const GRUPOS = { A: "Causa del comprador o la dirección", B: "Causa de MELI o la planificación",
                 C: "Causa operativa del conductor", D: "Fuerza mayor" };
function JustificacionDevoluciones({ quien }) {
  const [reglas, setReglas] = useState(null);
  const [sinRegla, setSinRegla] = useState([]);
  const [msg, setMsg] = useState("");
  const cargar = async () => {
    const desde = sumar(hoyCL(), -30);
    const [r, d] = await Promise.all([
      apiSuave("motivos_justificacion_cl?select=*&order=grupo,motivo", null),
      apiSuave(`vw_devoluciones_justif_cl?fecha=gte.${desde}&regla=is.null&select=motivo_codigo,motivo&limit=5000`, []),
    ]);
    setReglas(r);
    const cuenta = {};
    (d || []).forEach(x => { const k = x.motivo_codigo || x.motivo || "(sin motivo)";
      cuenta[k] = cuenta[k] || { clave: k, codigo: x.motivo_codigo || null, motivo: x.motivo || "", casos: 0 }; cuenta[k].casos++; });
    setSinRegla(Object.values(cuenta).sort((a, b) => b.casos - a.casos));
  };
  useEffect(() => { cargar(); }, []);
  const guardar = async (x, grupo, justifica) => {
    setMsg("");
    try { await rpc("fn_motivo_justif_guardar", { p_clave: x.clave, p_codigo: x.codigo || null, p_motivo: x.motivo || x.clave,
            p_grupo: grupo, p_justifica: justifica, p_por: quien });
          setMsg(`✓ ${x.motivo || x.clave}: ${justifica ? "justifica" : "no justifica"} (grupo ${grupo})`); await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); }
  };
  if (reglas === null) return (
    <div className="mt-card"><div className="mt-tit">Justificación de devoluciones</div>
      <div className="mt-sub" style={{ color: AMBAR }}>No se pudo leer la tabla de reglas: faltan los SQL de esta pasada (motivos_justificacion_cl).</div></div>
  );
  return (
    <div>
      <div className="mt-card">
        <div className="mt-tit">Motivos que se justifican solos</div>
        <div className="mt-sub">
          Si una devolución tiene un motivo marcado <b>Sí</b>, se justifica automáticamente: cuenta como cumplida en el NS
          de su ruta, (entregados + justificadas) ÷ cargados, y con eso en el pago. En el Maestro, la línea muestra
          <b style={{ color: "#FF6600" }}> J</b> con cuántas se justificaron, y cada devolución dice si quedó justificada.
          Un cambio aquí rige para todos los días que se vuelvan a consultar, incluidos los pasados.
        </div>
        {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
        <div style={{ overflowX: "auto" }}>
          <table className="mt-tabla">
            <thead><tr><th>Código MELI</th><th>Motivo</th><th>Grupo</th><th>¿Justifica?</th><th>Último cambio</th></tr></thead>
            <tbody>
              {reglas.map(x => (
                <tr key={x.clave}>
                  <td style={{ fontFamily: "monospace", fontSize: 11.5, color: "#475569" }}>{x.codigo || "(sin código)"}</td>
                  <td>{x.motivo}</td>
                  <td><select className="mt-in" value={x.grupo} onChange={e => guardar(x, e.target.value, x.justifica)}>
                    {Object.entries(GRUPOS).map(([g, t]) => <option key={g} value={g}>{g} · {t}</option>)}
                  </select></td>
                  <td>
                    <span style={{ display: "inline-flex", border: "1px solid #dfe4ec", borderRadius: 8, overflow: "hidden" }}>
                      {[[true, "Sí"], [false, "No"]].map(([v, t]) => (
                        <button key={t} onClick={() => x.justifica !== v && guardar(x, x.grupo, v)}
                                style={{ border: 0, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                                         background: x.justifica === v ? (v ? VERDE : ROJO) : "#fff", color: x.justifica === v ? "#fff" : "#64748b" }}>{t}</button>
                      ))}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: "#64748b" }}>{x.actualizado_por || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ExcepcionesCeco quien={quien} reglas={reglas} />
      <div className="mt-card">
        <div className="mt-tit">Motivos sin regla (últimos 30 días)</div>
        <div className="mt-sub">Si MELI empieza a usar un motivo nuevo, aparece aquí. Mientras no tenga regla, sus devoluciones no se justifican.</div>
        {sinRegla.length === 0 ? <div className="mt-sub" style={{ color: VERDE }}>✓ Todos los motivos tienen regla.</div> : (
          <table className="mt-tabla" style={{ maxWidth: 820 }}>
            <thead><tr><th>Código</th><th>Motivo</th><th>Casos</th><th>Definir</th></tr></thead>
            <tbody>
              {sinRegla.map(x => (
                <tr key={x.clave}>
                  <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{x.codigo || "(sin código)"}</td>
                  <td>{x.motivo}</td>
                  <td style={{ textAlign: "right" }}>{x.casos}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="mt-btn" onClick={() => guardar(x, "A", true)} style={{ marginRight: 6 }}>Justifica (A)</button>
                    <button className="mt-btn rojo" onClick={() => guardar(x, "C", false)}>No justifica (C)</button>
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

// ── Excepciones por CECO ───────────────────────────────────────────────────
// Un CECO puede tratar un motivo distinto a la regla general. "Con evidencia":
// la devolución le pide al supervisor de ese CECO, en su bitácora, la observación
// y la foto (p. ej. faltante o dañado detectado en la carga); administración la
// aprueba en el Maestro (Devoluciones) y recién ahí se justifica.
const MODOS = { si: ["Sí, automático", VERDE], evidencia: ["Con evidencia del supervisor", "#1d4ed8"], no: ["No justifica", ROJO] };
function ExcepcionesCeco({ quien, reglas }) {
  const [filas, setFilas] = useState(null);
  const [cecos, setCecos] = useState([]);
  const [f, setF] = useState({ ceco: "", clave: "", modo: "evidencia" });
  const [msg, setMsg] = useState("");
  const cargar = async () => {
    const [x, ca] = await Promise.all([
      apiSuave("justif_ceco_cl?select=*&order=ceco,clave", null),
      apiSuave("cecos_admin?select=nombre&activo=eq.true&order=nombre", []),
    ]);
    setFilas(x); setCecos([...new Set((ca || []).map(c => c.nombre))].filter(c => /^ML_/.test(c)));
  };
  useEffect(() => { cargar(); }, []);
  const guardar = async (ceco, clave, modo) => {
    setMsg("");
    try { await rpc("fn_justif_ceco_guardar", { p_ceco: ceco, p_clave: clave, p_modo: modo, p_por: quien });
          setMsg(modo ? `✓ ${ceco}: guardado` : `✓ ${ceco}: vuelve a la regla general`); setF({ ...f, clave: "" }); await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); }
  };
  const motivo = (clave) => (reglas || []).find(r => r.clave === clave)?.motivo || clave;
  const general = (clave) => { const r = (reglas || []).find(x => x.clave === clave); return r ? (r.justifica ? "Sí" : "No") : "sin regla"; };
  if (filas === null) return (
    <div className="mt-card"><div className="mt-tit">Excepciones por CECO</div>
      <div className="mt-sub" style={{ color: AMBAR }}>Faltan los SQL de esta pasada (justif_ceco_cl).</div></div>
  );
  return (
    <div className="mt-card">
      <div className="mt-tit">Excepciones por CECO</div>
      <div className="mt-sub">
        Un CECO puede justificar un motivo que en general no se justifica, o al revés. Con <b>"Con evidencia del supervisor"</b>,
        cada devolución con ese motivo le pide al supervisor del CECO, en su bitácora, la observación y la foto (por ejemplo,
        un faltante que no llegó a la bodega o un dañado detectado en la carga). Administración la aprueba en
        Maestro → Devoluciones, y recién ahí cuenta en el NS y en el pago. Rige para devoluciones desde el 20-nov-2026.
      </div>
      {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
      {filas.length > 0 && (
        <table className="mt-tabla" style={{ marginBottom: 12 }}>
          <thead><tr><th>CECO</th><th>Motivo</th><th>Regla general</th><th>En este CECO</th><th>Último cambio</th><th></th></tr></thead>
          <tbody>
            {filas.map(x => (
              <tr key={x.ceco + x.clave}>
                <td style={{ fontWeight: 700, color: NAVY }}>{x.ceco}</td>
                <td>{motivo(x.clave)}</td>
                <td style={{ color: "#64748b" }}>{general(x.clave)}</td>
                <td><select className="mt-in" value={x.modo} onChange={e => guardar(x.ceco, x.clave, e.target.value)}
                            style={{ color: MODOS[x.modo]?.[1], fontWeight: 700 }}>
                  {Object.entries(MODOS).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
                </select></td>
                <td style={{ fontSize: 11, color: "#64748b" }}>{x.actualizado_por || "—"}</td>
                <td><button className="mt-btn rojo" onClick={() => window.confirm(`¿Quitar la excepción de ${x.ceco}? Ese motivo vuelve a la regla general en ese CECO.`) && guardar(x.ceco, x.clave, null)}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="mt-lbl">CECO
          <select className="mt-in" value={f.ceco} onChange={e => setF({ ...f, ceco: e.target.value })}>
            <option value="">Elige el CECO</option>{cecos.map(c => <option key={c}>{c}</option>)}
          </select></label>
        <label className="mt-lbl">Motivo
          <select className="mt-in" value={f.clave} onChange={e => setF({ ...f, clave: e.target.value })}>
            <option value="">Elige el motivo</option>
            {(reglas || []).map(r => <option key={r.clave} value={r.clave}>{r.motivo}{r.codigo ? ` (${r.codigo})` : ""}</option>)}
          </select></label>
        <label className="mt-lbl">En este CECO
          <select className="mt-in" value={f.modo} onChange={e => setF({ ...f, modo: e.target.value })}>
            {Object.entries(MODOS).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
          </select></label>
        <button className="mt-btn pri" disabled={!f.ceco || !f.clave} onClick={() => guardar(f.ceco, f.clave, f.modo)}>Agregar excepción</button>
      </div>
    </div>
  );
}

// ── Pago de hitos (Bitácora → Hitos Maestro) ───────────────────────────────
// Cómo se paga cada sorting y cada ambulancia interna, por CECO o para todos.
// Sorting: monto fijo por servicio. Ambulancia: el supervisor consigna el valor
// en la bitácora (se le sugiere el de aquí) y administración lo puede corregir
// en el Maestro. Desactivar una regla deja de pagar ese tipo de hito en ese CECO.
const TIPOS_HITO = { sorting: "Sorting", ambulancia: "Ambulancia interna" };
const MODOS_HITO = { fijo: "Monto fijo por servicio", por_entregado: "Monto por entregado" };
const pesos = (v) => "$" + Math.round(Number(v) || 0).toLocaleString("es-CL");
function PagoHitos({ quien }) {
  const [filas, setFilas] = useState(null);
  const [cecos, setCecos] = useState([]);
  const [f, setF] = useState({ tipo: "sorting", ceco: "TODOS", modo: "fijo", monto: "" });
  const [msg, setMsg] = useState("");
  const cargar = async () => {
    const [x, ca] = await Promise.all([
      apiSuave("hitos_tarifas_cl?select=*&order=tipo,ceco", null),
      apiSuave("cecos_admin?select=nombre&activo=eq.true&order=nombre", []),
    ]);
    setFilas(x); setCecos([...new Set((ca || []).map(c => c.nombre))].filter(c => /^ML_/.test(c)));
  };
  useEffect(() => { cargar(); }, []);
  const guardar = async (r) => {
    setMsg("");
    if (!(Number(r.monto) >= 0) || r.monto === "") { setMsg("Indica el monto."); return; }
    try { await rpc("fn_hito_tarifa_guardar2", { p_tipo: r.tipo, p_ceco: r.ceco, p_modo: r.modo, p_monto: Number(r.monto), p_activo: r.activo !== false,
            p_desde: r.vigente_desde || null, p_hasta: r.vigente_hasta || null, p_por: quien });
          setMsg(`✓ ${TIPOS_HITO[r.tipo]} · ${r.ceco}: guardado`); await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); }
  };
  if (filas === null) return (
    <div className="mt-card"><div className="mt-tit">Pago de hitos</div>
      <div className="mt-sub" style={{ color: AMBAR }}>Faltan los SQL de esta pasada (hitos_tarifas_cl).</div></div>
  );
  return (
    <div className="mt-card">
      <div className="mt-tit">Pago de hitos de la bitácora</div>
      <div className="mt-sub">
        Cómo se paga cada <b>sorting</b> y cada <b>ambulancia interna</b> que registran los supervisores en Hitos Maestro.
        Una regla de un CECO manda sobre la de "TODOS". En la ambulancia, el supervisor consigna el valor en la bitácora
        (se le sugiere el de aquí) y administración lo puede corregir en el Maestro. Una regla desactivada deja de pagar ese
        tipo de hito en ese CECO. La ruta madre paga sus entregados menos los de la ambulancia.
      </div>
      {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
      {filas.length > 0 && (
        <table className="mt-tabla" style={{ marginBottom: 12, maxWidth: 900 }}>
          <thead><tr><th>Hito</th><th>CECO</th><th>Cómo se paga</th><th>Monto</th><th>Vigente desde</th><th>Vigente hasta</th><th>Activa</th><th>Último cambio</th></tr></thead>
          <tbody>
            {filas.map(x => (
              <tr key={x.tipo + x.ceco} style={!x.activo ? { opacity: 0.55 } : undefined}>
                <td style={{ fontWeight: 700, color: NAVY }}>{TIPOS_HITO[x.tipo]}</td>
                <td>{x.ceco}</td>
                <td><select className="mt-in" value={x.modo} onChange={e => guardar({ ...x, modo: e.target.value })}>
                  {Object.entries(MODOS_HITO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
                <td><input className="mt-in" type="number" min="0" defaultValue={x.monto} style={{ width: 120 }}
                           onBlur={e => Number(e.target.value) !== Number(x.monto) && guardar({ ...x, monto: e.target.value })} />
                  <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 6 }}>{pesos(x.monto)}</span></td>
                <td><input className="mt-in" type="date" defaultValue={x.vigente_desde || ""} onBlur={e => e.target.value !== (x.vigente_desde || "") && guardar({ ...x, vigente_desde: e.target.value || null })} /></td>
                <td><input className="mt-in" type="date" defaultValue={x.vigente_hasta || ""} onBlur={e => e.target.value !== (x.vigente_hasta || "") && guardar({ ...x, vigente_hasta: e.target.value || null })} />
                  {!x.vigente_hasta && <div style={{ fontSize: 10.5, color: "#94a3b8" }}>sin término</div>}</td>
                <td><input type="checkbox" checked={!!x.activo} onChange={e => guardar({ ...x, activo: e.target.checked })} /></td>
                <td style={{ fontSize: 11, color: "#64748b" }}>{x.actualizado_por || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="mt-lbl">Hito
          <select className="mt-in" value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>
            {Object.entries(TIPOS_HITO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label className="mt-lbl">CECO
          <select className="mt-in" value={f.ceco} onChange={e => setF({ ...f, ceco: e.target.value })}>
            <option value="TODOS">TODOS</option>{cecos.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="mt-lbl">Cómo se paga
          <select className="mt-in" value={f.modo} onChange={e => setF({ ...f, modo: e.target.value })}>
            {Object.entries(MODOS_HITO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label className="mt-lbl">Monto ($)
          <input className="mt-in" type="number" min="0" value={f.monto} onChange={e => setF({ ...f, monto: e.target.value })} style={{ width: 120 }} /></label>
        <button className="mt-btn pri" disabled={f.monto === ""} onClick={() => guardar({ ...f, activo: true })}>Agregar regla</button>
      </div>
    </div>
  );
}

// ── Glosario del Maestro ───────────────────────────────────────────────────
// Qué significa cada origen, columna nueva y estado interno, y qué decide si una
// línea se tarifica sola o queda para el analista. Es la referencia común para
// administración, analistas y supervisores.
const GLOSARIO = [
  { tit: "Origen de la línea", filas: [
    ["API", "#1E3A6E", "#E8EEF8", "La línea viene de la conexión con el sistema del cliente: MELI (Logistic y First Mile), DispatchTrack en Canon, Driv.in en Rosen. Sus cifras (paradas, cargados, entregados) nunca se editan a mano. ID: el de la ruta del cliente, por ejemplo 73294575."],
    ["Interno", "#A3440B", "#FDEBDD", "La línea nace en la Bitácora del supervisor porque el cliente no la informa: una ambulancia interna o un sorting. Tiene un ID propio para no mezclarse con las del cliente: 73294575-AI1 (ambulancia 1 de la ruta 73294575) o SORT-SRM1-201126-01."],
  ]},
  { tit: "Tipos de línea interna", filas: [
    ["Ambulancia interna", "#E8651A", "#FFF7F1", "Otro vehículo se lleva parte de la carga de una ruta (la ruta madre). Sus paquetes se RESTAN de la madre: la madre paga sus entregados menos los de la ambulancia y la ambulancia paga los suyos. La suma de ambas nunca supera lo que informa la API. El supervisor consigna el monto acordado y ese monto lo aprueba su jefe."],
    ["Sorting", "#1E3A6E", "#F4F8FF", "Servicio interno de clasificación en bodega: se paga al transporte, no se cobra al cliente. Cuenta como 1 servicio (paradas, cargados y entregados = 1) y se paga según Mantenedor → Pago de hitos."],
    ["Observación", "#1D6B45", "#F3FAF6", "Nota del supervisor sobre una ruta API (incidencia, descuento, cobro adicional, pago especial u otro). No cambia las cifras; si es «Pago especial» la ruta pasa a tarificación manual."],
  ]},
  { tit: "Columnas nuevas del Maestro", filas: [
    ["Observación", "#334155", "#F6F8FB", "Observaciones de la bitácora sobre esa ruta, con quién y cuándo."],
    ["Ajuste AI", "#A82E22", "#FDECEC", "Paquetes que pasan de la ruta madre a sus ambulancias internas: −25 en la madre, +25 en la ambulancia."],
    ["Entr. pago", "#0D2B52", "#F7F9FC", "Entregados que se pagan: entregados de la API − ambulancias + recolectas en ruta. Es lo que alimenta Maestro Pago con el tarificador de cada CECO."],
    ["Estado cliente", "#475569", "#EEF2F9", "Lo que informa el cliente (MELI, etc.) sobre la ruta. En las líneas internas va «—»."],
    ["Estado interno", "#1E3A6E", "#E8EEF8", "En qué paso del proceso de pago está la línea (ver abajo). Decide si se tarifica sola o queda para el analista."],
  ]},
  { tit: "Estados internos (qué se tarifica solo)", filas: [
    ["En ventana", "#1E3A6E", "#E8EEF8", "El supervisor todavía puede editar el hito (24 h desde que lo registró). Todavía no se paga."],
    ["Por revisar", "#7A4A00", "#FFF1DB", "Algo lo debe revisar el analista antes de pagar: empresa sin certificar, ambulancia sin el ok del jefe, ruta sin tarifa o sin CECO. No se paga hasta resolverlo."],
    ["Tarificación manual", "#A3440B", "#FDEBDD", "No se tarifica automático: la decide el analista. Por ejemplo, una ruta con observación de «Pago especial»: el analista ingresa el monto en Maestro Pago."],
    ["Lista para pago", "#1E6B3A", "#E6F4EA", "Pasa automático: el tarificador la valoriza y entra al pago."],
    ["En prefactura", "#3E4656", "#EEF0F3", "La línea ya se incluyó en una prefactura enviada a la empresa. Ya no cambia."],
  ]},
];
function Glosario() {
  return (
    <div>
      {GLOSARIO.map(g => (
        <div key={g.tit} className="mt-card">
          <div className="mt-tit">{g.tit}</div>
          <table className="mt-tabla" style={{ marginTop: 8 }}>
            <tbody>
              {g.filas.map(([t, c, f, d]) => (
                <tr key={t}>
                  <td style={{ width: 190, verticalAlign: "top" }}>
                    <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 8, fontWeight: 800, fontSize: 12, color: c, background: f }}>{t}</span>
                  </td>
                  <td style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.55 }}>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="mt-card">
        <div className="mt-tit">El camino de una línea</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, marginTop: 8 }}>
          {[["En ventana", "#E8EEF8", "#1E3A6E"], ["Por revisar / Tarificación manual", "#FFF1DB", "#7A4A00"], ["Lista para pago", "#E6F4EA", "#1E6B3A"], ["En prefactura", "#EEF0F3", "#3E4656"]]
            .map(([t, f, c], i) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {i > 0 && <span style={{ color: "#94a3b8" }}>→</span>}
                <span style={{ padding: "4px 10px", borderRadius: 8, fontWeight: 700, background: f, color: c }}>{t}</span>
              </span>
            ))}
        </div>
        <div className="mt-sub" style={{ marginTop: 8 }}>
          Las cifras de la API nunca se editan: los ajustes viven en las líneas internas y en las columnas Ajuste AI y Entr. pago.
        </div>
      </div>
    </div>
  );
}

// ── Líderes y supervisores ─────────────────────────────────────────────────
// Qué supervisores administra cada líder (jefe de zona). El líder da el ok al
// monto de las ambulancias internas de sus supervisores. Para vacaciones del
// líder, se registra quién lo cubre y entre qué fechas.
function Lideres({ quien }) {
  const hoy = hoyCL();
  const [filas, setFilas] = useState(null);
  const [rem, setRem] = useState([]);
  const [supBit, setSupBit] = useState([]);
  const [nuevo, setNuevo] = useState({ supervisor_nombre: "", lider_nombre: "", zona: "" });
  const [r, setR] = useState({ lider_nombre: "", reemplazante_nombre: "", desde: hoy, hasta: sumar(hoy, 6), nota: "" });
  const [msg, setMsg] = useState("");
  const cargar = async () => {
    const [x, y, sb] = await Promise.all([
      apiSuave("lideres_supervisores_cl?select=*&order=zona,lider_nombre,supervisor_nombre", null),
      apiSuave("lideres_reemplazos_cl?select=*&activo=eq.true&order=desde.desc&limit=100", []),
      apiSuave("supervisores_bt?select=email,nombre&activo=eq.true&order=nombre", []),
    ]);
    setFilas(x); setRem(y || []); setSupBit(sb || []);
  };
  useEffect(() => { cargar(); }, []);
  const guardar = async (f) => {
    setMsg("");
    try { await rpc("fn_lider_supervisor_guardar", { p_supervisor: f.supervisor_nombre, p_supervisor_email: f.supervisor_email || null,
            p_lider: f.lider_nombre, p_lider_email: f.lider_email || null, p_zona: f.zona || null, p_activo: f.activo !== false, p_por: quien });
          setMsg(`✓ ${f.supervisor_nombre}: guardado`); setNuevo({ supervisor_nombre: "", lider_nombre: "", zona: "" }); await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); }
  };
  const guardarRem = async (accion, x) => {
    setMsg("");
    try { await rpc("fn_lider_reemplazo", { p_id: x?.id || null, p_lider: r.lider_nombre, p_reemplazante: r.reemplazante_nombre,
            p_desde: r.desde, p_hasta: r.hasta, p_nota: r.nota || null, p_accion: accion, p_por: quien });
          setMsg(accion === "anular" ? "✓ Reemplazo anulado" : `✓ ${r.reemplazante_nombre} cubre a ${r.lider_nombre} del ${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}`);
          await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); }
  };
  if (filas === null) return <div className="mt-card"><div className="mt-tit">Líderes y supervisores</div>
    <div className="mt-sub" style={{ color: AMBAR }}>Faltan los SQL de esta pasada (lideres_supervisores_cl).</div></div>;
  const lideres = [...new Set(filas.map(x => x.lider_nombre))].sort();
  const porLider = lideres.map(l => [l, filas.filter(x => x.lider_nombre === l)]);
  return (
    <div>
      {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
      <div className="mt-card">
        <div className="mt-tit">Supervisores que administra cada líder</div>
        <div className="mt-sub">El líder da el ok al monto de las ambulancias internas de sus supervisores. Cambia el líder de un supervisor con la lista; la cuenta de la bitácora se enlaza por correo.</div>
        {porLider.map(([l, xs]) => (
          <div key={l} style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 800, color: NAVY, fontSize: 13 }}>{l} <span style={{ color: "#94a3b8", fontWeight: 600 }}>· {xs[0]?.zona || ""} · {xs.length} supervisores</span></div>
            <table className="mt-tabla" style={{ marginTop: 6, maxWidth: 980 }}>
              <thead><tr><th>Supervisor</th><th>Cuenta en la bitácora</th><th>Líder</th><th>Zona</th><th>Activo</th></tr></thead>
              <tbody>
                {xs.map(x => (
                  <tr key={x.supervisor_nombre} style={!x.activo ? { opacity: 0.5 } : undefined}>
                    <td style={{ fontWeight: 600 }}>{x.supervisor_nombre}</td>
                    <td><select className="mt-in" value={x.supervisor_email || ""} onChange={e => guardar({ ...x, supervisor_email: e.target.value })}
                                style={{ color: x.supervisor_email ? undefined : ROJO }}>
                      <option value="">Sin enlazar</option>{supBit.map(b => <option key={b.email} value={b.email}>{b.nombre} · {b.email}</option>)}</select></td>
                    <td><select className="mt-in" value={x.lider_nombre} onChange={e => guardar({ ...x, lider_nombre: e.target.value, lider_email: filas.find(y => y.lider_nombre === e.target.value)?.lider_email })}>
                      {lideres.map(y => <option key={y}>{y}</option>)}</select></td>
                    <td><input className="mt-in" defaultValue={x.zona || ""} style={{ width: 90 }} onBlur={e => e.target.value !== (x.zona || "") && guardar({ ...x, zona: e.target.value })} /></td>
                    <td><input type="checkbox" checked={!!x.activo} onChange={e => guardar({ ...x, activo: e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              Correo del líder (para que apruebe en la bitácora):
              <select className="mt-in" value={xs[0]?.lider_email || ""} onChange={e => xs.forEach(x => guardar({ ...x, lider_email: e.target.value }))}>
                <option value="">Sin cuenta</option>{supBit.map(b => <option key={b.email} value={b.email}>{b.nombre} · {b.email}</option>)}</select>
            </div>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 14 }}>
          <label className="mt-lbl">Supervisor nuevo<input className="mt-in" value={nuevo.supervisor_nombre} onChange={e => setNuevo({ ...nuevo, supervisor_nombre: e.target.value.toUpperCase() })} placeholder="NOMBRE APELLIDO" /></label>
          <label className="mt-lbl">Líder<input className="mt-in" list="lideres-lista" value={nuevo.lider_nombre} onChange={e => setNuevo({ ...nuevo, lider_nombre: e.target.value.toUpperCase() })} />
            <datalist id="lideres-lista">{lideres.map(l => <option key={l} value={l} />)}</datalist></label>
          <label className="mt-lbl">Zona<input className="mt-in" value={nuevo.zona} onChange={e => setNuevo({ ...nuevo, zona: e.target.value.toUpperCase() })} style={{ width: 90 }} /></label>
          <button className="mt-btn pri" disabled={!nuevo.supervisor_nombre || !nuevo.lider_nombre} onClick={() => guardar(nuevo)}>Agregar</button>
        </div>
      </div>
      <div className="mt-card">
        <div className="mt-tit">Reemplazos de líder (vacaciones, licencia…)</div>
        <div className="mt-sub">En esas fechas, el reemplazante da el ok a las ambulancias de los supervisores del líder ausente.</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="mt-lbl">Líder ausente<select className="mt-in" value={r.lider_nombre} onChange={e => setR({ ...r, lider_nombre: e.target.value })}>
            <option value="">Elige</option>{lideres.map(l => <option key={l}>{l}</option>)}</select></label>
          <label className="mt-lbl">Lo reemplaza<input className="mt-in" list="lideres-lista" value={r.reemplazante_nombre} onChange={e => setR({ ...r, reemplazante_nombre: e.target.value.toUpperCase() })} placeholder="NOMBRE" /></label>
          <label className="mt-lbl">Desde<input className="mt-in" type="date" value={r.desde} onChange={e => setR({ ...r, desde: e.target.value })} /></label>
          <label className="mt-lbl">Hasta<input className="mt-in" type="date" value={r.hasta} onChange={e => setR({ ...r, hasta: e.target.value })} /></label>
          <label className="mt-lbl">Nota<input className="mt-in" value={r.nota} onChange={e => setR({ ...r, nota: e.target.value })} placeholder="Vacaciones" /></label>
          <button className="mt-btn pri" disabled={!r.lider_nombre || !r.reemplazante_nombre || !r.desde || !r.hasta} onClick={() => guardarRem("guardar")}>Guardar</button>
        </div>
        {rem.length > 0 && (
          <table className="mt-tabla" style={{ marginTop: 10, maxWidth: 820 }}>
            <thead><tr><th>Líder</th><th>Lo reemplaza</th><th>Fechas</th><th>Nota</th><th></th></tr></thead>
            <tbody>{rem.map(x => (
              <tr key={x.id} style={x.hasta < hoy ? { opacity: 0.5 } : undefined}>
                <td style={{ fontWeight: 700 }}>{x.lider_nombre}</td><td>{x.reemplazante_nombre}</td>
                <td>{fechaCorta(x.desde)} → {fechaCorta(x.hasta)}</td><td>{x.nota || "—"}</td>
                <td><button className="mt-btn rojo" onClick={() => guardarRem("anular", x)}>Anular</button></td>
              </tr>))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Categorías de observación (Hitos Maestro) ──────────────────────────────
// Qué categorías puede usar el supervisor al dejar una observación, qué efecto
// tiene su monto en el pago, con qué rango de monto y en qué fechas rige.
const EFECTOS = { informativo: "Solo informativo (no cambia el pago)", suma: "Se suma al pago de la ruta",
                  descuenta: "Se descuenta del pago de la ruta", cobro: "Se cobra a la empresa (prefactura)",
                  reemplaza: "Reemplaza el pago de la ruta (tarificación manual)" };
function CategoriasObs({ quien }) {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ categoria: "", efecto: "informativo", monto_min: "", monto_max: "", vigente_desde: "", vigente_hasta: "", descripcion: "" });
  const [msg, setMsg] = useState("");
  const cargar = async () => setFilas(await apiSuave("hitos_categorias_cl?select=*&order=orden,categoria", null));
  useEffect(() => { cargar(); }, []);
  const n = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  const guardar = async (x) => {
    setMsg("");
    if (n(x.monto_min) != null && n(x.monto_max) != null && n(x.monto_min) > n(x.monto_max)) { setMsg("El mínimo no puede ser mayor que el máximo."); return; }
    try { await rpc("fn_hito_categoria_guardar", { p_categoria: x.categoria, p_efecto: x.efecto, p_min: n(x.monto_min), p_max: n(x.monto_max),
            p_desde: x.vigente_desde || null, p_hasta: x.vigente_hasta || null, p_activa: x.activa !== false, p_descripcion: x.descripcion || null, p_por: quien });
          setMsg(`✓ ${x.categoria}: guardada`); setF({ categoria: "", efecto: "informativo", monto_min: "", monto_max: "", vigente_desde: "", vigente_hasta: "", descripcion: "" }); await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); }
  };
  if (filas === null) return <div className="mt-card"><div className="mt-tit">Categorías de observación</div>
    <div className="mt-sub" style={{ color: AMBAR }}>Faltan los SQL de esta pasada (hitos_categorias_cl).</div></div>;
  return (
    <div className="mt-card">
      <div className="mt-tit">Categorías de observación</div>
      <div className="mt-sub">
        Son las que ve el supervisor en Hitos Maestro → Observación. El monto es obligatorio y la bitácora no deja registrar
        uno fuera del rango. Una categoría fuera de su vigencia o inactiva no aparece en la bitácora.
      </div>
      {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
      <div style={{ overflowX: "auto" }}>
        <table className="mt-tabla" style={{ marginBottom: 12 }}>
          <thead><tr><th>Categoría</th><th>Efecto en el pago</th><th>Monto mínimo</th><th>Monto máximo</th><th>Vigente desde</th><th>Vigente hasta</th><th>Descripción para el supervisor</th><th>Activa</th></tr></thead>
          <tbody>
            {filas.map(x => (
              <tr key={x.categoria} style={!x.activa ? { opacity: 0.55 } : undefined}>
                <td style={{ fontWeight: 700, color: NAVY }}>{x.categoria}</td>
                <td><select className="mt-in" value={x.efecto} onChange={e => guardar({ ...x, efecto: e.target.value })}>
                  {Object.entries(EFECTOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
                <td><input className="mt-in" type="number" min="0" defaultValue={x.monto_min ?? ""} style={{ width: 110 }} placeholder="sin mínimo"
                           onBlur={e => n(e.target.value) !== n(x.monto_min) && guardar({ ...x, monto_min: e.target.value })} /></td>
                <td><input className="mt-in" type="number" min="0" defaultValue={x.monto_max ?? ""} style={{ width: 110 }} placeholder="sin tope"
                           onBlur={e => n(e.target.value) !== n(x.monto_max) && guardar({ ...x, monto_max: e.target.value })} /></td>
                <td><input className="mt-in" type="date" defaultValue={x.vigente_desde || ""} onBlur={e => e.target.value !== (x.vigente_desde || "") && guardar({ ...x, vigente_desde: e.target.value })} /></td>
                <td><input className="mt-in" type="date" defaultValue={x.vigente_hasta || ""} onBlur={e => e.target.value !== (x.vigente_hasta || "") && guardar({ ...x, vigente_hasta: e.target.value })} /></td>
                <td><input className="mt-in" defaultValue={x.descripcion || ""} style={{ minWidth: 220 }} onBlur={e => e.target.value !== (x.descripcion || "") && guardar({ ...x, descripcion: e.target.value })} /></td>
                <td><input type="checkbox" checked={!!x.activa} onChange={e => guardar({ ...x, activa: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="mt-lbl">Categoría nueva<input className="mt-in" value={f.categoria} onChange={e => setF({ ...f, categoria: e.target.value })} placeholder="Ej.: Peaje" /></label>
        <label className="mt-lbl">Efecto<select className="mt-in" value={f.efecto} onChange={e => setF({ ...f, efecto: e.target.value })}>
          {Object.entries(EFECTOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label className="mt-lbl">Mínimo<input className="mt-in" type="number" value={f.monto_min} onChange={e => setF({ ...f, monto_min: e.target.value })} style={{ width: 100 }} /></label>
        <label className="mt-lbl">Máximo<input className="mt-in" type="number" value={f.monto_max} onChange={e => setF({ ...f, monto_max: e.target.value })} style={{ width: 100 }} /></label>
        <label className="mt-lbl">Desde<input className="mt-in" type="date" value={f.vigente_desde} onChange={e => setF({ ...f, vigente_desde: e.target.value })} /></label>
        <label className="mt-lbl">Hasta<input className="mt-in" type="date" value={f.vigente_hasta} onChange={e => setF({ ...f, vigente_hasta: e.target.value })} /></label>
        <button className="mt-btn pri" disabled={!f.categoria.trim()} onClick={() => guardar({ ...f, categoria: f.categoria.trim(), activa: true })}>Agregar</button>
      </div>
    </div>
  );
}

// ── CECO y centros MELI ────────────────────────────────────────────────────
// Los centros de MELI (SRM1, SIL1, SLT1…) de los que el VPS captura rutas salen
// de la tabla cecos (capturar = sí): el scraper la lee en cada vuelta, así que
// un CECO nuevo se agrega aquí sin tocar el servidor. Debajo, lo que le falta a
// cada CECO para que su operación se pague bien, y la regla de Same Day.
function CecosCentros({ quien }) {
  const [centros, setCentros] = useState(null);
  const [admin, setAdmin] = useState([]);
  const [chk, setChk] = useState({});
  const [f, setF] = useState({ nombre: "ML_", codigo: "" });
  const [msg, setMsg] = useState("");
  const cargar = async () => {
    const [c, a, sbt, tar, bono, seg] = await Promise.all([
      apiSuave("cecos?select=codigo,capturar,fuente&order=codigo", null),
      apiSuave("cecos_admin?select=nombre,codigo_meli,activo&order=nombre", []),
      apiSuave("supervisores_bt?select=nombre,scs_asignados,activo,es_prueba&activo=eq.true", []),
      apiSuave("tarifas?select=cecos_admin,servicio&activa=eq.true&limit=2000", []),
      apiSuave("bono_ns_tramos?select=cecos_admin&activo=eq.true&limit=2000", []),
      apiSuave("segmentaciones?select=nombre,cecos_admin&limit=2000", []),
    ]);
    setCentros(c); setAdmin(a || []);
    const m = {};
    (a || []).filter(x => /^ML_/.test(x.nombre)).forEach(x => {
      const n = x.nombre;
      m[n] = m[n] || { centros: new Set(), sup: [], tarifas: new Set(), bono: 0, seg: 0 };
      if (x.codigo_meli) m[n].centros.add(x.codigo_meli);
    });
    Object.keys(m).forEach(n => {
      m[n].sup = (sbt || []).filter(b => !b.es_prueba && arr(b.scs_asignados).includes(n)).map(b => b.nombre);
      (tar || []).filter(t => t.cecos_admin === n).forEach(t => m[n].tarifas.add(t.servicio));
      m[n].bono = (bono || []).filter(b => b.cecos_admin === n).length;
      m[n].seg = (seg || []).filter(x => x.cecos_admin === n).length;
    });
    setChk(m);
  };
  useEffect(() => { cargar(); }, []);
  const capt = new Set((centros || []).filter(c => c.capturar).map(c => c.codigo));
  const toggle = async (codigo, v) => {
    setMsg("");
    try { await api(`cecos?codigo=eq.${encodeURIComponent(codigo)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ capturar: v, actualizado_por: quien }) });
          setMsg(`✓ ${codigo}: ${v ? "el VPS capturará sus rutas desde la próxima vuelta" : "el VPS deja de capturar sus rutas"}`); await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); }
  };
  const agregar = async () => {
    const nombre = f.nombre.trim().toUpperCase().replace(/\s+/g, " "), codigo = f.codigo.trim().toUpperCase();
    if (!/^ML_.+/.test(nombre) || codigo.length < 3) { setMsg("Escribe el CECO (ML_…) y el código del centro MELI (ej. SIL1)."); return; }
    setMsg("");
    try {
      await api("cecos?on_conflict=codigo", { method: "POST", headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
        body: JSON.stringify([{ codigo, fuente: "manual", capturar: true, actualizado_por: quien }]) });
      await api("cecos_admin?on_conflict=nombre,codigo_meli", { method: "POST", headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
        body: JSON.stringify([{ nombre, codigo_meli: codigo, actualizado_por: quien }]) });
      setMsg(`✓ ${nombre} (${codigo}) agregado: el VPS captura sus rutas desde la próxima vuelta. Completa lo que le falta en la tabla de abajo.`);
      setF({ nombre: "ML_", codigo: "" }); await cargar();
    } catch (e) { setMsg("No se pudo agregar: " + e.message); }
  };
  if (centros === null) return <div className="mt-card"><div className="mt-tit">CECO y centros MELI</div>
    <div className="mt-sub" style={{ color: AMBAR }}>No se pudo leer la tabla cecos: faltan los SQL de esta pasada.</div></div>;
  const ok = (b) => <span style={{ color: b ? VERDE : ROJO, fontWeight: 700 }}>{b ? "✓" : "✕"}</span>;
  const cecosML = Object.keys(chk).sort();
  return (
    <div>
      {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
      <div className="mt-card">
        <div className="mt-tit">Agregar un CECO nuevo</div>
        <div className="mt-sub">El CECO del Brain (ML_…) y el código del centro de MELI de donde salen sus rutas. Al guardarlo, el VPS empieza a capturar ese centro en su próxima vuelta (cada pocos minutos), sin tocar el servidor.</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="mt-lbl">CECO<input className="mt-in" value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value.toUpperCase() })} placeholder="ML_TALCA" /></label>
          <label className="mt-lbl">Centro MELI<input className="mt-in" value={f.codigo} onChange={e => setF({ ...f, codigo: e.target.value.toUpperCase() })} placeholder="STL1" style={{ width: 100 }} /></label>
          <button className="mt-btn pri" onClick={agregar}>Agregar y capturar</button>
        </div>
      </div>

      <div className="mt-card">
        <div className="mt-tit">Qué le falta a cada CECO</div>
        <div className="mt-sub">Para que un CECO se pague bien necesita: centro MELI capturado, supervisor titular, tarifas, tramos de bono por NS y zonas o segmentación. Lo que tenga ✕ se completa en su mantenedor (Supervisores y CECO, Tarifario, Factores NS, Zonas de pago).</div>
        <div style={{ overflowX: "auto" }}>
          <table className="mt-tabla">
            <thead><tr><th>CECO</th><th>Centros MELI</th><th>Captura rutas</th><th>Supervisor</th><th>Tarifas (servicios)</th><th>Bono NS</th><th>Segmentación</th></tr></thead>
            <tbody>
              {cecosML.map(n => {
                const x = chk[n]; const cs = [...x.centros];
                return (
                  <tr key={n}>
                    <td style={{ fontWeight: 700, color: NAVY }}>{n}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{cs.join(", ") || "—"}</td>
                    <td>{ok(cs.some(c => capt.has(c)))} <span style={{ fontSize: 11, color: "#64748b" }}>{cs.filter(c => capt.has(c)).join(", ")}</span></td>
                    <td>{ok(x.sup.length > 0)} <span style={{ fontSize: 11, color: "#64748b" }}>{x.sup.join(", ")}</span></td>
                    <td>{ok(x.tarifas.size > 0)} <span style={{ fontSize: 11, color: "#64748b" }}>{[...x.tarifas].sort().join(", ")}</span></td>
                    <td>{ok(x.bono > 0)} <span style={{ fontSize: 11, color: "#64748b" }}>{x.bono ? `${x.bono} tramos` : "factor 1,00"}</span></td>
                    <td>{ok(x.seg > 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-card">
        <div className="mt-tit">Centros MELI que captura el VPS</div>
        <div className="mt-sub">Encender o apagar un centro rige desde la próxima vuelta del scraper. Si un centro se apaga, sus rutas dejan de llegar al Maestro.</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {centros.map(c => (
            <label key={c.codigo} className="mt-chip" style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer",
                                                         borderColor: c.capturar ? VERDE : undefined }}>
              <input type="checkbox" checked={!!c.capturar} onChange={e => toggle(c.codigo, e.target.checked)} />
              <span style={{ fontFamily: "monospace" }}>{c.codigo}</span>
            </label>
          ))}
        </div>
      </div>

      <SameDayXpt quien={quien} />
    </div>
  );
}

// ── Same Day por XPT ───────────────────────────────────────────────────────
// Administración decide qué rutas son Same Day. Cada XPT (punto de MELI desde
// donde salen las rutas de un CECO) muestra sus ciclos con cuántas rutas tuvo en
// los últimos 30 días; se toca un ciclo para pasarlo de UM a Same Day.
function SameDayXpt({ quien }) {
  const [datos, setDatos] = useState(null);
  const [reglas, setReglas] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(null);
  const cargar = async () => {
    const [d, r] = await Promise.all([
      apiSuave("vw_xpt_ciclos_cl?select=*&order=facility_id,ciclo", null),
      apiSuave("reglas_same_day_xpt_cl?select=*&activo=eq.true", []),
    ]);
    setDatos(d); setReglas(r || []);
  };
  useEffect(() => { cargar(); }, []);
  const esSD = (f, c) => reglas.some(x => x.facility_id === f && (x.ciclo === "*" || x.ciclo === c));
  const alternar = async (f, c) => {
    const act = !esSD(f, c);
    setBusy(f + c); setMsg("");
    try { await rpc("fn_regla_same_day_xpt", { p_facility: f, p_ciclo: c, p_activo: act, p_por: quien });
          setMsg(`✓ ${f} ${c}: ${act ? "se paga como Same Day" : "vuelve a pagarse como UM"}`); await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); } finally { setBusy(null); }
  };
  if (datos === null) return <div className="mt-card"><div className="mt-tit">Same Day</div>
    <div className="mt-sub" style={{ color: AMBAR }}>Faltan los SQL de esta pasada (vw_xpt_ciclos_cl).</div></div>;

  const xpts = [...new Set(datos.map(d => d.facility_id))].map(f => {
    const filas = datos.filter(d => d.facility_id === f);
    return { f, ceco: filas[0]?.cecos_admin, ciclos: filas.filter(d => d.ciclo), sinCiclo: filas.filter(d => !d.ciclo).reduce((a, d) => a + Number(d.rutas || 0), 0) };
  });
  const marcados = xpts.flatMap(x => x.ciclos.filter(c => esSD(x.f, c.ciclo)).map(c => `${x.ceco || x.f} (${x.f} ${c.ciclo})`));

  return (
    <div className="mt-card">
      <div className="mt-tit">Same Day</div>
      <div className="mt-sub">
        Las rutas de MELI salen de un <b>XPT</b> (punto de salida de cada CECO) y en un <b>ciclo</b>: AM1 es la mañana,
        PM1 y PM2 la tarde. Toca un ciclo para decidir cómo se paga: <b>UM</b> (por entregado, lo normal) o <b>Same Day</b>
        (monto fijo por ruta, con la tarifa SAME DAY del Tarifario). El número es cuántas rutas tuvo ese ciclo en los últimos 30 días.
      </div>
      <div style={{ background: "#f6f8fb", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, margin: "4px 0 12px" }}>
        <b style={{ color: NAVY }}>Hoy se pagan como Same Day:</b>{" "}
        {marcados.length ? marcados.join(" · ") : <span style={{ color: "#64748b" }}>ninguno (todas las rutas se pagan como UM)</span>}
      </div>
      {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {xpts.map(x => (
          <div key={x.f} style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 12, alignItems: "center",
                                  border: "1px solid #e6e9ef", borderRadius: 10, padding: "10px 12px" }}>
            <div>
              <div style={{ fontWeight: 800, color: NAVY, fontSize: 13 }}>{x.ceco || "Sin CECO"}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>XPT {x.f}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {x.ciclos.map(c => {
                const sd = esSD(x.f, c.ciclo);
                return (
                  <button key={c.ciclo} disabled={busy === x.f + c.ciclo} onClick={() => alternar(x.f, c.ciclo)}
                          title={sd ? "Se paga como Same Day. Toca para volver a UM." : "Se paga como UM. Toca para pagarlo como Same Day."}
                          style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 120, cursor: "pointer",
                                   border: `1.5px solid ${sd ? "#7c3aed" : "#dfe4ec"}`, background: sd ? "#f3e8ff" : "#fff",
                                   borderRadius: 10, padding: "6px 10px", fontFamily: "inherit", textAlign: "left" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: "#1f2937" }}>{c.ciclo}
                      <span style={{ fontWeight: 400, color: "#64748b" }}> · {Number(c.rutas).toLocaleString("es-CL")} rutas</span></span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: sd ? "#7c3aed" : "#64748b" }}>{sd ? "✓ Same Day" : "UM"}</span>
                  </button>
                );
              })}
              {x.sinCiclo > 0 && <span style={{ fontSize: 11, color: "#94a3b8" }}>+ {x.sinCiclo} rutas sin ciclo (se pagan como UM)</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Clientes DispatchTrack ──────────────────────────────────────────────────
// La cuenta de DispatchTrack de Bigticket es una sola; el cliente de cada guía
// (Canon, Hypnos…) viene en "Categorías y grupos → Cliente". El VPS lo lee guía
// por guía y lo guarda. Aquí aparecen solos los clientes que llegan, con cuántas
// guías tuvieron en los últimos 30 días; administración les asigna CECO y decide
// si se capturan.
function ClientesDT({ quien }) {
  const [vistos, setVistos] = useState(null);
  const [conf, setConf] = useState([]);
  const [cecos, setCecos] = useState([]);
  const [msg, setMsg] = useState("");
  const cargar = async () => {
    const [v, c, a] = await Promise.all([
      apiSuave("vw_clientes_dt_cl?select=*&order=guias_30d.desc", null),
      apiSuave("clientes_dt_cl?select=*&order=cliente", []),
      apiSuave("cecos_admin?select=nombre&activo=eq.true&order=nombre", []),
    ]);
    setVistos(v); setConf(c || []); setCecos([...new Set((a || []).map(x => x.nombre))]);
  };
  useEffect(() => { cargar(); }, []);
  const guardar = async (cliente, cambios) => {
    const actual = conf.find(x => x.cliente === cliente) || { capturar: true, cecos_admin: null };
    const n = { ...actual, ...cambios };
    setMsg("");
    try { await rpc("fn_cliente_dt_guardar", { p_cliente: cliente, p_cecos: n.cecos_admin || null, p_capturar: n.capturar !== false, p_por: quien });
          setMsg(`✓ ${cliente} guardado`); await cargar(); }
    catch (e) { setMsg("No se pudo guardar: " + e.message); }
  };
  if (vistos === null) return <div className="mt-card"><div className="mt-tit">Clientes DispatchTrack</div>
    <div className="mt-sub" style={{ color: AMBAR }}>Faltan los SQL de esta pasada (vw_clientes_dt_cl).</div></div>;
  const nombres = [...new Set([...vistos.map(v => v.cliente), ...conf.map(c => c.cliente)])];
  return (
    <div className="mt-card">
      <div className="mt-tit">Clientes DispatchTrack</div>
      <div className="mt-sub">
        Todos los clientes llegan por la misma cuenta de DispatchTrack de Bigticket. El cliente de cada guía es el de
        "Categorías y grupos → Cliente" y el VPS lo lee solo. Un cliente nuevo aparece aquí en cuanto tiene guías:
        asígnale su CECO (si se deja "Por región", usa la regla de Canon: Metropolitana → C_RM, Valparaíso → C_VIÑA). Si se marca "no capturar", sus guías dejan de guardarse en el Maestro desde la próxima vuelta (cada 20 minutos).
      </div>
      {msg && <div className="mt-msg" style={{ color: msg.startsWith("✓") ? VERDE : ROJO }}>{msg}</div>}
      <table className="mt-tabla" style={{ maxWidth: 900 }}>
        <thead><tr><th>Cliente (en DispatchTrack)</th><th style={{ textAlign: "right" }}>Guías 30 días</th><th>Última guía</th><th>CECO</th><th>Capturar</th></tr></thead>
        <tbody>
          {nombres.map(n => {
            const v = vistos.find(x => x.cliente === n) || {};
            const c = conf.find(x => x.cliente === n) || {};
            const sinCliente = n === "(sin cliente aún)";
            return (
              <tr key={n} style={c.capturar === false ? { opacity: 0.55 } : undefined}>
                <td style={{ fontWeight: 700, color: sinCliente ? AMBAR : NAVY }}>{n}
                  {!c.cliente && !sinCliente && <span className="mt-chip" style={{ marginLeft: 6, color: AMBAR }}>nuevo</span>}</td>
                <td style={{ textAlign: "right" }}>{Number(v.guias_30d || 0).toLocaleString("es-CL")}</td>
                <td>{v.ultima_fecha ? v.ultima_fecha.split("-").reverse().join("-") : "—"}</td>
                <td>{sinCliente ? <span className="mt-sub">El VPS las completa en las próximas vueltas</span> : (
                  <select className="mt-in" value={c.cecos_admin || ""} onChange={e => guardar(n, { cecos_admin: e.target.value || null })}>
                    <option value="">Por región (C_RM / C_VIÑA)</option>{cecos.map(x => <option key={x}>{x}</option>)}
                  </select>)}</td>
                <td>{!sinCliente && <input type="checkbox" checked={c.capturar !== false} onChange={e => guardar(n, { capturar: e.target.checked })} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
