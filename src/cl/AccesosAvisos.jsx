// ═══════════════════════════════════════════════════════════════════════════
// cl/AccesosAvisos.jsx — B-05 y B-06 (pedido 25-11): quién ve qué en el Brain Chile y avisos
//   · useAccesosCL: módulos y subpestañas que ve el usuario (tablas brain_accesos_cl, con reemplazos por fechas).
//   · CampanaAvisosCL: campanita en el menú, ventana emergente o en la esquina y sonido, según el mantenedor.
//   · MantAccesosCL: mantenedor (Mantenedor › Brain: accesos y avisos) para Adriana y Eduardo Stine.
// Todo en Supabase Chile. Sin filas para un usuario, se usa lo que define App.jsx (para no dejar a nadie sin acceso).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { useMenuSubtabs, elegirSubtab } from "../shared/subtabs";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";
const H = { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" };
const api = async (path) => { const r = await fetch(`${CL_URL}/rest/v1/${path}`, { headers: H }); if (!r.ok) throw new Error((await r.text()).slice(0, 200)); return r.json(); };
const rpc = async (fn, args) => { const r = await fetch(`${CL_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) }); const t = await r.text(); if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* texto */ } throw new Error(m); } return t ? JSON.parse(t) : null; };

const NAVY = "#002E5D", NARANJA = "#FF6600", ROJO = "#B42318", VERDE = "#167A3E", TENUE = "#64748b", BORDE = "#e6e9ef";
export const MODULOS_CL = [["certificaciones_cl", "Certificaciones"], ["mantenciones_cl", "Cuidado de Activo"], ["maestro_cl", "Maestro Operaciones"],
  ["gps_seguros_cl", "GPS y Seguros"], ["pnr_cl", "Posventa"], ["aceptacion_cl", "Aceptación de Rutas"], ["mantenedor_cl", "Mantenedor"]];

// ── Accesos efectivos del usuario (Chile) ──────────────────────────────────
export function useAccesosCL(usuario, pais) {
  const [acc, setAcc] = useState(undefined);   // undefined: cargando · null: sin filas (usa el código) · objeto
  useEffect(() => {
    if (pais !== "Chile" || !usuario?.email) { setAcc(null); return undefined; }
    let vivo = true;
    const cargar = () => rpc("fn_brain_mis_accesos", { p_email: usuario.email }).then((r) => vivo && setAcc(r || null)).catch(() => vivo && setAcc(null));
    cargar();
    const t = setInterval(cargar, 5 * 60 * 1000);   // reemplazos con fecha: se recalcula solo
    return () => { vivo = false; clearInterval(t); };
  }, [usuario?.email, pais]);
  return acc;
}

// ── Sonidos (generados en el navegador; no requieren archivos) ─────────────
let ctxAudio = null;
export function sonar(tipo) {
  if (!tipo || tipo === "ninguno") return;
  try {
    ctxAudio = ctxAudio || new (window.AudioContext || window.webkitAudioContext)();
    const tono = (f, ini, dur, vol = 0.18, forma = "sine") => {
      const o = ctxAudio.createOscillator(), g = ctxAudio.createGain();
      o.type = forma; o.frequency.value = f; o.connect(g); g.connect(ctxAudio.destination);
      const t0 = ctxAudio.currentTime + ini;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.start(t0); o.stop(t0 + dur + 0.05);
    };
    if (tipo === "campana") { tono(880, 0, 0.9); tono(1320, 0, 0.6, 0.08); }
    else if (tipo === "ding") tono(1046, 0, 0.35);
    else if (tipo === "doble") { tono(988, 0, 0.25); tono(1318, 0.28, 0.35); }
    else if (tipo === "alarma") { for (let i = 0; i < 4; i++) { tono(880, i * 0.3, 0.14, 0.2, "square"); tono(660, i * 0.3 + 0.15, 0.14, 0.2, "square"); } }
    else if (tipo === "suave") tono(523, 0, 0.6, 0.12);
  } catch { /* el navegador no permite sonido todavía (falta un clic del usuario) */ }
}
export const SONIDOS = [["ninguno", "Sin sonido"], ["campana", "Campana"], ["ding", "Ding"], ["doble", "Doble tono"], ["alarma", "Alarma (urgente)"], ["suave", "Suave"]];
export const VENTANAS = [["emergente", "Ventana emergente (al centro)"], ["esquina", "Aviso en la esquina"], ["solo_campana", "Solo la campanita"]];

// ── Campanita en el menú ───────────────────────────────────────────────────
export function CampanaAvisosCL({ usuario, onIr }) {
  const [avisos, setAvisos] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [emergente, setEmergente] = useState(null);   // lista de avisos para la ventana al centro
  const [esquina, setEsquina] = useState([]);
  const mostrados = useRef(new Set());
  const primera = useRef(true);
  const cargar = async () => {
    if (!usuario?.email) return;
    let lista = [];
    try { lista = (await rpc("fn_brain_avisos", { p_email: usuario.email })) || []; } catch { return; }
    setAvisos(lista);
    const nuevos = lista.filter((a) => !a.visto && !mostrados.current.has(a.clave));
    nuevos.forEach((a) => mostrados.current.add(a.clave));
    if (!nuevos.length) { primera.current = false; return; }
    // B8: al iniciar sesión, una ventana con lo pendiente; después, cada aviso nuevo según su configuración
    const em = nuevos.filter((a) => a.ventana === "emergente"), es = nuevos.filter((a) => a.ventana === "esquina");
    if (primera.current) { if (em.length || es.length) setEmergente([...em, ...es]); }
    else { if (em.length) setEmergente(em); if (es.length) setEsquina((x) => [...es, ...x].slice(0, 4)); }
    const sonido = (nuevos.find((a) => a.sonido === "alarma") || nuevos.find((a) => a.sonido && a.sonido !== "ninguno") || {}).sonido;
    sonar(sonido);
    primera.current = false;
  };
  useEffect(() => { cargar(); const t = setInterval(cargar, 20000); return () => clearInterval(t); }, [usuario?.email]);   // eslint-disable-line react-hooks/exhaustive-deps
  const vistos = async (claves) => { if (!claves.length) return; try { await rpc("fn_brain_avisos_vistos", { p_email: usuario.email, p_claves: claves }); } catch { /* reintenta en el próximo ciclo */ } setAvisos((l) => l.map((a) => (claves.includes(a.clave) ? { ...a, visto: true } : a))); };
  const ir = (a) => { vistos([a.clave]); setAbierto(false); setEmergente(null); setEsquina((x) => x.filter((y) => y.clave !== a.clave)); if (a.sub) elegirSubtab(a.modulo, a.sub); onIr && onIr(a.modulo); };
  const pend = avisos.filter((a) => !a.visto);
  const hora = (t) => (t ? new Date(t).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  const fila = (a) => (
    <div key={a.clave} onClick={() => ir(a)} style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDE}`, cursor: "pointer", background: a.visto ? "#fff" : "#fff7ed" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: a.evento === "wa_urgente" ? ROJO : NAVY }}>{a.titulo}</div>
      <div style={{ fontSize: 11.5, color: TENUE }}>{[a.detalle, hora(a.desde)].filter(Boolean).join(" · ")}</div>
    </div>
  );
  return (
    <>
      <div style={{ position: "relative" }}>
        <button onClick={() => { setAbierto(!abierto); sonar("ninguno"); }} title="Avisos" aria-label="Avisos"
          style={{ background: "transparent", border: "none", cursor: "pointer", position: "relative", padding: "6px 8px", display: "flex", alignItems: "center" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          {pend.length > 0 && <span style={{ position: "absolute", top: 0, right: 0, background: NARANJA, color: "#fff", borderRadius: 10, fontSize: 10.5, fontWeight: 800, padding: "1px 5px", minWidth: 16, textAlign: "center" }}>{pend.length > 99 ? "99+" : pend.length}</span>}
        </button>
        {abierto && <>
          <div style={{ position: "fixed", inset: 0, zIndex: 60 }} onClick={() => setAbierto(false)} />
          <div style={{ position: "absolute", right: 0, top: "110%", width: 340, maxHeight: 440, overflowY: "auto", background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.2)", zIndex: 61 }}>
            <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", borderBottom: `1px solid ${BORDE}` }}>
              <b style={{ color: NAVY, fontSize: 14 }}>Avisos</b><span style={{ flex: 1 }} />
              {pend.length > 0 && <a style={{ fontSize: 12, color: NAVY, cursor: "pointer" }} onClick={() => vistos(pend.map((a) => a.clave))}>Marcar todo como visto</a>}
            </div>
            {avisos.length === 0 ? <div style={{ padding: 14, fontSize: 12.5, color: TENUE }}>Sin avisos pendientes.</div> : avisos.slice(0, 60).map(fila)}
          </div>
        </>}
      </div>
      {emergente && emergente.length > 0 && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setEmergente(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: "min(460px, 92vw)", maxHeight: "70vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}>
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${BORDE}`, display: "flex", alignItems: "center" }}>
              <b style={{ color: NAVY }}>🔔 {emergente.length === 1 ? "Tienes un aviso" : `Tienes ${emergente.length} avisos`}</b><span style={{ flex: 1 }} />
              <button onClick={() => { vistos(emergente.map((a) => a.clave)); setEmergente(null); }} style={{ border: `1px solid ${BORDE}`, background: "#fff", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>Visto</button>
            </div>
            {emergente.map(fila)}
          </div>
        </div>
      )}
      {esquina.length > 0 && (
        <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 79, display: "flex", flexDirection: "column", gap: 8, width: 320 }}>
          {esquina.map((a) => (
            <div key={a.clave} style={{ background: "#fff", borderLeft: `4px solid ${a.evento === "wa_urgente" ? ROJO : NARANJA}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.18)", padding: "10px 12px" }}>
              <div style={{ display: "flex" }}><div style={{ flex: 1, cursor: "pointer" }} onClick={() => ir(a)}><div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{a.titulo}</div><div style={{ fontSize: 11.5, color: TENUE }}>{a.detalle}</div></div>
                <a style={{ cursor: "pointer", color: TENUE }} onClick={() => { vistos([a.clave]); setEsquina((x) => x.filter((y) => y.clave !== a.clave)); }}>✕</a></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ═══ Mantenedor «Brain: accesos y avisos» (Adriana y Eduardo Stine) ═══════
const inp = { border: `1px solid ${BORDE}`, borderRadius: 8, padding: "6px 9px", fontSize: 13 };
const btn = (sec) => ({ border: sec ? `1px solid ${NAVY}` : "none", background: sec ? "#fff" : NAVY, color: sec ? NAVY : "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const card = { background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 12, padding: 14, marginBottom: 12 };

export function MantAccesosCL({ usuario }) {
  const [vista, setVista] = useState("ver");
  const [editores, setEditores] = useState(null);
  useEffect(() => { api("ca_config_cl?clave=eq.brain_accesos_editores&select=valor").then((r) => setEditores(((r || [])[0]?.valor || "").toLowerCase())).catch(() => setEditores("")); }, []);
  if (editores === null) return <div style={card}>Cargando…</div>;
  const puede = editores.replace(/\s/g, "").split(",").includes(String(usuario?.email || "").toLowerCase());
  const quien = usuario?.email || "brain";
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[["ver", "👁 Quién ve qué"], ["avisos", "🔔 Avisos: ventanas y sonidos"], ["reemplazos", "↺ Reemplazos con fechas"], ["hist", "Historial"]].map(([k, t]) =>
          <button key={k} style={btn(vista !== k)} onClick={() => setVista(k)}>{t}</button>)}
      </div>
      {!puede && <div style={{ ...card, color: "#9a5b00", background: "#fff7ed" }}>Solo lectura: editan {editores.split(",").join(" y ")}.</div>}
      {vista === "ver" && <QuienVe quien={quien} puede={puede} />}
      {vista === "avisos" && <AvisosCfg quien={quien} puede={puede} />}
      {vista === "reemplazos" && <Reemplazos quien={quien} puede={puede} />}
      {vista === "hist" && <HistAccesos />}
    </div>
  );
}

function QuienVe({ quien, puede }) {
  const [us, setUs] = useState(null), [acc, setAcc] = useState([]), [ocu, setOcu] = useState([]), [msg, setMsg] = useState(""), [n, setN] = useState({ email: "", nombre: "" });
  const { listas } = useMenuSubtabs();
  const subsCA = listas.mantenciones_cl || [];
  const cargar = async () => {
    const [u, a, o] = await Promise.all([api("brain_usuarios_cl?select=*&order=nombre"), api("brain_accesos_cl?select=email,modulo"), api("brain_subocultas_cl?select=*")]);
    setUs(u || []); setAcc(a || []); setOcu(o || []);
  };
  useEffect(() => { cargar().catch(() => setUs([])); }, []);
  if (us === null) return <div style={card}>Cargando…</div>;
  const tiene = (e, m) => acc.some((x) => x.email.toLowerCase() === e.toLowerCase() && x.modulo === m);
  const oculta = (e, s) => ocu.some((x) => x.email.toLowerCase() === e.toLowerCase() && x.sub === s);
  const cambiar = async (e, m, ve) => { setMsg(""); try { await rpc("fn_brain_acceso", { p_email: e, p_modulo: m, p_ve: ve, p_por: quien }); await cargar(); } catch (x) { setMsg(x.message); } };
  const celda = { padding: "6px 8px", borderBottom: `1px solid ${BORDE}`, fontSize: 12.5, textAlign: "center" };
  return (
    <div>
      <div style={{ fontSize: 12.5, color: TENUE, marginBottom: 8 }}>Qué módulos del Brain Chile ve cada usuario. Se precargó con lo que cada uno veía al 27-11. Quien no tiene un módulo marcado no lo ve en el menú ni recibe sus avisos. Los cambios rigen la próxima vez que la persona entra (o en 5 minutos).</div>
      {msg && <div style={{ color: ROJO, fontSize: 12.5, marginBottom: 8 }}>{msg}</div>}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead><tr style={{ background: "#f6f7f9" }}><th style={{ ...celda, textAlign: "left" }}>Usuario</th>{MODULOS_CL.map(([k, t]) => <th key={k} style={{ ...celda, color: TENUE }}>{t}</th>)}</tr></thead>
          <tbody>{us.filter((u) => u.activo).map((u) => (
            <tr key={u.email}><td style={{ ...celda, textAlign: "left" }}><b>{u.nombre}</b><div style={{ fontSize: 11, color: TENUE }}>{u.email}</div></td>
              {MODULOS_CL.map(([k]) => <td key={k} style={celda}><input type="checkbox" disabled={!puede} checked={tiene(u.email, k)} onChange={(e) => cambiar(u.email, k, e.target.checked)} /></td>)}</tr>))}</tbody>
        </table>
      </div>
      {subsCA.length > 0 && <>
        <div style={{ fontWeight: 800, color: NAVY, margin: "6px 0" }}>Subpestañas de Cuidado de Activo</div>
        <div style={{ fontSize: 12, color: TENUE, marginBottom: 6 }}>Solo para quienes ven Cuidado de Activo. Desmarca una subpestaña para ocultarla del menú de esa persona.</div>
        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead><tr style={{ background: "#f6f7f9" }}><th style={{ ...celda, textAlign: "left" }}>Usuario</th>{subsCA.map((s) => <th key={s.id} style={{ ...celda, color: TENUE, fontSize: 11 }}>{s.label}</th>)}</tr></thead>
            <tbody>{us.filter((u) => u.activo && tiene(u.email, "mantenciones_cl")).map((u) => (
              <tr key={u.email}><td style={{ ...celda, textAlign: "left" }}><b>{u.nombre}</b></td>
                {subsCA.map((s) => <td key={s.id} style={celda}><input type="checkbox" disabled={!puede} checked={!oculta(u.email, s.id)} onChange={(e) => cambiar(u.email, `mantenciones_cl:${s.id}`, e.target.checked)} /></td>)}</tr>))}</tbody>
          </table>
        </div>
      </>}
      {puede && <div style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <b style={{ color: NAVY, width: "100%" }}>Agregar usuario a la lista</b>
        <input style={{ ...inp, minWidth: 240 }} placeholder="correo@bigticket.cl" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} />
        <input style={{ ...inp, minWidth: 200 }} placeholder="Nombre" value={n.nombre} onChange={(e) => setN({ ...n, nombre: e.target.value })} />
        <button style={btn()} disabled={!n.email.includes("@")} onClick={async () => { try { await rpc("fn_brain_usuario", { p_email: n.email, p_nombre: n.nombre || null, p_activo: true, p_por: quien }); setN({ email: "", nombre: "" }); cargar(); } catch (x) { setMsg(x.message); } }}>Agregar</button>
        <span style={{ fontSize: 11.5, color: TENUE }}>La clave de ingreso al Brain la sigue creando Camilo; aquí se define qué ve.</span>
      </div>}
    </div>
  );
}

function AvisosCfg({ quien, puede }) {
  const [ev, setEv] = useState(null), [dest, setDest] = useState([]), [us, setUs] = useState([]), [msg, setMsg] = useState("");
  const cargar = async () => {
    const [e, d, u] = await Promise.all([api("brain_avisos_eventos_cl?select=*&order=orden"), api("brain_avisos_dest_cl?select=*"), api("brain_usuarios_cl?activo=is.true&select=email,nombre&order=nombre")]);
    setEv(e || []); setDest(d || []); setUs(u || []);
  };
  useEffect(() => { cargar().catch(() => setEv([])); }, []);
  if (ev === null) return <div style={card}>Cargando…</div>;
  const g = async (fn, args) => { setMsg(""); try { await rpc(fn, { ...args, p_por: quien }); await cargar(); } catch (x) { setMsg(x.message); } };
  return (
    <div>
      <div style={{ fontSize: 12.5, color: TENUE, marginBottom: 8 }}>Para cada aviso: cómo aparece (ventana emergente, aviso en la esquina o solo la campanita), con qué sonido y a quién le llega. Al iniciar sesión, si quedan avisos pendientes, aparece una ventana con ellos. El sonido necesita que la persona haya hecho al menos un clic en el Brain (regla de los navegadores).</div>
      {msg && <div style={{ color: ROJO, fontSize: 12.5, marginBottom: 8 }}>{msg}</div>}
      {ev.map((x) => (
        <div key={x.codigo} style={{ ...card, opacity: x.activo ? 1 : 0.55 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px" }}><b style={{ color: NAVY }}>{x.nombre}</b><div style={{ fontSize: 12, color: TENUE }}>{x.descripcion}</div></div>
            <select style={inp} disabled={!puede} value={x.ventana} onChange={(e) => g("fn_brain_aviso_evento", { p_codigo: x.codigo, p_ventana: e.target.value, p_sonido: null, p_activo: null })}>{VENTANAS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
            <select style={inp} disabled={!puede} value={x.sonido} onChange={(e) => g("fn_brain_aviso_evento", { p_codigo: x.codigo, p_ventana: null, p_sonido: e.target.value, p_activo: null })}>{SONIDOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
            <button style={btn(true)} onClick={() => sonar(x.sonido)}>▶ Probar</button>
            <label style={{ fontSize: 12.5, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" disabled={!puede} checked={!!x.activo} onChange={(e) => g("fn_brain_aviso_evento", { p_codigo: x.codigo, p_ventana: null, p_sonido: null, p_activo: e.target.checked })} /> Activo</label>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: TENUE }}>Le llega a:</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {us.map((u) => { const on = dest.some((d) => d.evento === x.codigo && d.email.toLowerCase() === u.email.toLowerCase()); return (
              <label key={u.email} style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", border: `1px solid ${on ? NAVY : BORDE}`, background: on ? "#eef2f8" : "#fff", borderRadius: 14, padding: "2px 8px", cursor: puede ? "pointer" : "default" }}>
                <input type="checkbox" disabled={!puede} checked={on} onChange={(e) => g("fn_brain_aviso_dest", { p_evento: x.codigo, p_email: u.email, p_recibe: e.target.checked })} />{u.nombre}</label>); })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Reemplazos({ quien, puede }) {
  const [fil, setFil] = useState(null), [us, setUs] = useState([]), [msg, setMsg] = useState("");
  const vacio = { id: null, titular: "", reemplazo: "", desde: "", hasta: "", motivo: "" };
  const [n, setN] = useState(vacio);
  const cargar = async () => { const [r, u] = await Promise.all([api("brain_reemplazos_cl?select=*&order=desde.desc"), api("brain_usuarios_cl?activo=is.true&select=email,nombre&order=nombre")]); setFil(r || []); setUs(u || []); };
  useEffect(() => { cargar().catch(() => setFil([])); }, []);
  if (fil === null) return <div style={card}>Cargando…</div>;
  const nom = (e) => (us.find((u) => u.email.toLowerCase() === String(e).toLowerCase()) || {}).nombre || e;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
  const guardar = async (x, activo = true) => { setMsg(""); try { await rpc("fn_brain_reemplazo", { p_id: x.id, p_titular: x.titular, p_reemplazo: x.reemplazo, p_desde: x.desde, p_hasta: x.hasta, p_motivo: x.motivo || null, p_activo: activo, p_por: quien }); setN(vacio); cargar(); } catch (e) { setMsg(e.message); } };
  return (
    <div>
      <div style={{ fontSize: 12.5, color: TENUE, marginBottom: 8 }}>Entre las fechas «desde» y «hasta», el reemplazo ve los módulos y recibe los avisos del titular, y el titular deja de verlos. Al terminar el rango, todo vuelve solo al titular.</div>
      {msg && <div style={{ color: ROJO, fontSize: 12.5, marginBottom: 8 }}>{msg}</div>}
      {puede && <div style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ fontSize: 12, color: TENUE }}>Titular<br /><select style={inp} value={n.titular} onChange={(e) => setN({ ...n, titular: e.target.value })}><option value="">Elegir…</option>{us.map((u) => <option key={u.email} value={u.email}>{u.nombre}</option>)}</select></label>
        <label style={{ fontSize: 12, color: TENUE }}>Reemplazo<br /><select style={inp} value={n.reemplazo} onChange={(e) => setN({ ...n, reemplazo: e.target.value })}><option value="">Elegir…</option>{us.map((u) => <option key={u.email} value={u.email}>{u.nombre}</option>)}</select></label>
        <label style={{ fontSize: 12, color: TENUE }}>Desde<br /><input type="date" style={inp} value={n.desde} onChange={(e) => setN({ ...n, desde: e.target.value })} /></label>
        <label style={{ fontSize: 12, color: TENUE }}>Hasta<br /><input type="date" style={inp} value={n.hasta} onChange={(e) => setN({ ...n, hasta: e.target.value })} /></label>
        <label style={{ fontSize: 12, color: TENUE, flex: "1 1 160px" }}>Motivo<br /><input style={{ ...inp, width: "100%", boxSizing: "border-box" }} value={n.motivo} onChange={(e) => setN({ ...n, motivo: e.target.value })} placeholder="Vacaciones" /></label>
        <button style={btn()} disabled={!n.titular || !n.reemplazo || !n.desde || !n.hasta} onClick={() => guardar(n)}>{n.id ? "Guardar cambio" : "Agregar reemplazo"}</button>
        {n.id && <button style={btn(true)} onClick={() => setN(vacio)}>Cancelar</button>}
      </div>}
      <div style={{ ...card, padding: 0 }}>
        {fil.length === 0 ? <div style={{ padding: 14, fontSize: 12.5, color: TENUE }}>Sin reemplazos.</div> : fil.map((x) => {
          const vigente = x.activo && hoy >= x.desde && hoy <= x.hasta;
          return (
            <div key={x.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 12px", borderBottom: `1px solid ${BORDE}`, opacity: x.activo ? 1 : 0.5, flexWrap: "wrap" }}>
              <div style={{ flex: 1, fontSize: 13 }}><b>{nom(x.reemplazo)}</b> reemplaza a <b>{nom(x.titular)}</b> · {x.desde} al {x.hasta}{x.motivo ? ` · ${x.motivo}` : ""}</div>
              {vigente ? <span style={{ color: VERDE, fontWeight: 700, fontSize: 12 }}>Vigente</span> : !x.activo ? <span style={{ fontSize: 12, color: TENUE }}>Anulado</span> : hoy < x.desde ? <span style={{ fontSize: 12, color: NAVY }}>Programado</span> : <span style={{ fontSize: 12, color: TENUE }}>Terminado</span>}
              {puede && x.activo && <><a style={{ cursor: "pointer", fontSize: 12, color: NAVY }} onClick={() => setN({ id: x.id, titular: x.titular, reemplazo: x.reemplazo, desde: x.desde, hasta: x.hasta, motivo: x.motivo || "" })}>Editar</a>
                <a style={{ cursor: "pointer", fontSize: 12, color: ROJO }} onClick={() => window.confirm("¿Anular este reemplazo?") && guardar(x, false)}>Anular</a></>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistAccesos() {
  const [h, setH] = useState(null);
  useEffect(() => { api("brain_accesos_hist_cl?select=*&order=at.desc&limit=200").then(setH).catch(() => setH([])); }, []);
  if (h === null) return <div style={card}>Cargando…</div>;
  return <div style={card}>{h.length === 0 ? <div style={{ fontSize: 12.5, color: TENUE }}>Sin cambios todavía.</div> : h.map((x) => (
    <div key={x.id} style={{ fontSize: 12.5, padding: "4px 0", borderBottom: `1px solid ${BORDE}` }}>{new Date(x.at).toLocaleString("es-CL", { timeZone: "America/Santiago" })} · <b>{x.que}</b> · {x.detalle} · <span style={{ color: TENUE }}>{x.por}</span></div>))}</div>;
}
