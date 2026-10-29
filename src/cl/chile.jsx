// ═══════════════════════════════════════════════════════════════════════════
// chile.jsx — Bitácora del Supervisor · Chile
//
// Misma imagen que México (web), con el contenido de Chile:
//   1. Avance de rutas de sus CECO (vw_bit_avance_cl, foto cada 5 min)
//   2. PNR con comprobante (vw_pnr_tareas_bitacora_cl, tareas pnr_tareas_cl,
//      fotos en el bucket pnr-pruebas-cl; plazo de 72 h para el supervisor)
//   3. Diferencias                    (pendiente)
//
// En Chile el "SC" del supervisor es su CECO (ML_ARICA, ML_RM_SRM1…). La vista
// vw_bit_avance_cl ya entrega solo las rutas de los CECO del supervisor.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { sb } from "./supabase.js";
import { Bandera } from "./pais.jsx";
import { ShellMovil, useEsMovil } from "./movil.jsx";
import { PostventaCL, contarPostventa } from "./postventa-cl.jsx";
import { ViajesCL, NoSalidasCL, contarViajes, contarNoSalidas } from "./operacion-cl.jsx";

// Pestañas de Chile en el celular y en la app
const TABS_CL = [
  { k: "avance", label: "Avance" },
  { k: "pnr", label: "PNR" },
  { k: "postventa", label: "Postventa" },
  { k: "viajes", label: "Viajes" },
  { k: "mas", label: "Más" },
];
// Lo que no cabe abajo en el celular va en la hoja "Más"
const EXTRAS_CL = [
  { k: "nosalidas", t: "No salidas a ruta", d: "Tus patentes sin ruta y su motivo" },
  { k: "diferencias", t: "Diferencias", d: "Reclamos de los terceros" },
];

// Nombre corto del CECO para mostrar: ML_RM_SRM1 → SRM1, ML_SAN_ANTONIO → San Antonio
export function nombreCeco(c) {
  const s = String(c || "").replace(/^ML_RM_/, "").replace(/^ML_/, "").replace(/_/g, " ");
  return /^SRM\d/.test(s) ? s : s.toLowerCase().replace(/(^|\s)\S/g, (l) => l.toUpperCase());
}

// Fecha y hora de Chile para la barra superior
const ahoraCL = () => {
  const d = new Date();
  return {
    fecha: d.toLocaleDateString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric" }),
    hora: d.toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false }),
  };
};

// Versión web: la misma barra superior, saludo, selector de SC y pestañas que
// México (usa las mismas clases del css de App.jsx).
export function LandingCL({ perfil, onSignOut, biggyImg, colors = { orange: "#FF6600" } }) {
  const cecosTodos = Array.isArray(perfil?.scs_asignados) ? perfil.scs_asignados : [];
  const CLAVE = `bitacora_sc_sel:${perfil?.email || ""}`;
  const [sel, setSel] = useState(() => {
    try { const v = localStorage.getItem(CLAVE); if (v === "todos" || cecosTodos.includes(v)) return v; } catch {}
    return cecosTodos.length > 1 ? "todos" : (cecosTodos[0] || "");
  });
  const elegir = (v) => { setSel(v); try { localStorage.setItem(CLAVE, v); } catch {} };
  const cecos = cecosTodos.length <= 1 ? cecosTodos : sel === "todos" ? cecosTodos : [sel];
  const [tab, setTab] = useState("avance");
  const [{ fecha, hora }, setAhora] = useState(ahoraCL());
  useEffect(() => { const t = setInterval(() => setAhora(ahoraCL()), 30000); return () => clearInterval(t); }, []);
  const movil = useEsMovil();   // celular o app nativa → armazón móvil, igual que México

  // Cuántos PNR esperan respuesta del supervisor (campana y número de la pestaña)
  const [pendPnr, setPendPnr] = useState(0);
  const contarPnr = async () => {
    if (!cecos.length) { setPendPnr(0); return; }
    const { count } = await sb.from("vw_pnr_tareas_bitacora_cl").select("id", { count: "exact", head: true })
      .in("ceco", cecos).eq("estado", "pendiente").is("cerrada_en", null);
    setPendPnr(count || 0);
  };
  useEffect(() => { contarPnr(); const t = setInterval(contarPnr, 60000); return () => clearInterval(t); }, [cecos.join(",")]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Casos de postventa (Canon) por responder o devueltos por el Biggy
  const [pendPost, setPendPost] = useState(0);
  const contarPost = async () => setPendPost(await contarPostventa(cecos));
  useEffect(() => { contarPost(); const t = setInterval(contarPost, 60000); return () => clearInterval(t); }, [cecos.join(",")]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Viajes por confirmar (no planificados) y patentes sin ruta y sin motivo, de hoy
  const [pendViajes, setPendViajes] = useState(0);
  const [pendNoSal, setPendNoSal] = useState(0);
  const contarOperacion = async () => {
    try { setPendViajes(await contarViajes(cecos)); } catch { setPendViajes(0); }
    try { setPendNoSal(await contarNoSalidas(cecos)); } catch { setPendNoSal(0); }
  };
  useEffect(() => { contarOperacion(); const t = setInterval(contarOperacion, 120000); return () => clearInterval(t); }, [cecos.join(",")]);   // eslint-disable-line react-hooks/exhaustive-deps

  const contenido = (
    <>
      {tab === "avance" && <AvanceRutasCL cecos={cecos} />}
      {tab === "pnr" && <PnrCL cecos={cecos} perfil={perfil} onCambio={contarPnr} />}
      {tab === "postventa" && <PostventaCL cecos={cecos} perfil={perfil} onCambio={contarPost} />}
      {tab === "viajes" && <ViajesCL cecos={cecos} perfil={perfil} onCambio={contarOperacion} />}
      {tab === "nosalidas" && <NoSalidasCL cecos={cecos} perfil={perfil} onCambio={contarOperacion} />}
      {tab === "diferencias" && <Pronto titulo="Diferencias" texto="Aquí vas a revisar los reclamos de los terceros." />}
    </>
  );

  if (movil) {
    return (
      <ShellMovil
        perfil={perfil} pais="cl" tab={tab} onTab={setTab}
        pendientes={{ pnr: pendPnr, postventa: pendPost, viajes: pendViajes, nosalidas: pendNoSal }} scsTodos={cecosTodos} scs={cecos} onElegirSc={elegir}
        biggyImg={biggyImg} onBiggy={() => {}} onSignOut={onSignOut}
        tabs={TABS_CL} extrasMas={EXTRAS_CL} conConsultas={false} nombreSc={nombreCeco}
      >
        {contenido}
      </ShellMovil>
    );
  }

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <img src={biggyImg} alt="Biggy" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", border: `1.5px solid ${colors.orange}`, flexShrink: 0 }} />
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            <span style={{ color: colors.orange }}>Big</span>
            <span style={{ color: "#fff" }}>ticket</span>
          </span>
          <span className="topbar-sub">Bitácora del Supervisor · {cecos.map(nombreCeco).join(" · ")}</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-fecha">🕐 {fecha} {hora} hs (CL)</span>
          <span className="topbar-nombre" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Bandera pais="cl" /> {perfil?.nombre}</span>
          <button className="btn-gw" onClick={onSignOut}>Salir</button>
        </div>
      </div>

      <div className="pg">
        <div style={{ marginBottom: 20 }}>
          <div className="sec-title">Hola, {perfil?.nombre?.split(" ")[0]} 👋</div>
          {cecosTodos.length > 1 && (
            <div className="sc-picker">
              <label htmlFor="sc-picker">Service Center</label>
              <select id="sc-picker" value={cecos.length > 1 ? "todos" : cecos[0]} onChange={(e) => elegir(e.target.value)}>
                {cecosTodos.map((c) => <option key={c} value={c}>{nombreCeco(c)}</option>)}
                <option value="todos">Todos mis SC ({cecosTodos.length})</option>
              </select>
            </div>
          )}
          <div className="sec-sub">
            {cecos.length === 0 ? "No tienes Service Centers asignados."
              : cecos.length === 1 ? `Avance de las rutas de ${nombreCeco(cecos[0])} hoy.`
              : `Avance de las rutas de tus ${cecos.length} Service Centers hoy.`}
          </div>
        </div>

        <div className="tab-bar">
          <button className={`tab-btn ${tab === "avance" ? "active" : ""}`} onClick={() => setTab("avance")}>🚚 Avance de rutas</button>
          <button className={`tab-btn ${tab === "pnr" ? "active" : ""}`} onClick={() => setTab("pnr")}>📦 PNR{pendPnr ? ` (${pendPnr})` : ""}</button>
          <button className={`tab-btn ${tab === "postventa" ? "active" : ""}`} onClick={() => setTab("postventa")}>✉️ Postventa{pendPost ? ` (${pendPost})` : ""}</button>
          <button className={`tab-btn ${tab === "viajes" ? "active" : ""}`} onClick={() => setTab("viajes")}>🏷️ Tipo de viaje{pendViajes ? ` (${pendViajes})` : ""}</button>
          <button className={`tab-btn ${tab === "nosalidas" ? "active" : ""}`} onClick={() => setTab("nosalidas")}>🚫 No salidas{pendNoSal ? ` (${pendNoSal})` : ""}</button>
          <button className={`tab-btn ${tab === "diferencias" ? "active" : ""}`} onClick={() => setTab("diferencias")}>⚖️ Diferencias</button>
        </div>

        {contenido}
      </div>
    </div>
  );
}

function Pronto({ titulo, texto }) {
  return (
    <div className="cl-card" style={{ textAlign: "center", padding: "28px 18px" }}>
      <style>{CSS_CL}</style>
      <div className="cl-titulo" style={{ marginBottom: 6 }}>{titulo}</div>
      <div className="cl-sub">{texto}</div>
      <div className="cl-sub" style={{ marginTop: 10 }}>Próximamente</div>
    </div>
  );
}

// ── 1. Avance de rutas ─────────────────────────────────────────────────────
const ALERTAS = [
  ["alerta_ruta_demorada", "Ruta demorada"],
  ["alerta_inactividad_vehiculo", "Vehículo detenido"],
  ["alerta_despacho_demorado", "Despacho demorado"],
  ["alerta_stemout_demorado", "Salida demorada"],
  ["alerta_saca_pendiente", "Saca pendiente"],
  ["alerta_parada_comercial", "Parada comercial"],
];
const pct = (a, b) => (b > 0 ? Math.round((a * 100) / b) : 0);
const alertasDe = (r) => ALERTAS.filter(([k]) => r[k]).map(([, t]) => t);
// Avance de una ruta = paquetes gestionados (entregados + no entregados) ÷ cargados,
// igual que el resumen del CECO. El progress_percent de MELI es su indicador de
// desempeño (el círculo de su consola), no el porcentaje entregado: se muestra aparte.
const avanceRuta = (r) => pct(Number(r.pkg_delivered || 0) + Number(r.pkg_not_delivered || 0), Number(r.pkg_total || 0));
const desempenoMeli = (r) => {
  const n = Number(String(r.progress_percent ?? "").replace("%", "").replace(",", ".").trim());
  return r.progress_percent !== null && r.progress_percent !== undefined && String(r.progress_percent).trim() !== "" && Number.isFinite(n)
    ? Math.round(n) : null;
};

function AvanceRutasCL({ cecos }) {
  const [rutas, setRutas] = useState(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(null);
  const [filtro, setFiltro] = useState("todas");   // todas · alerta · en_ruta · terminadas

  const cargar = async () => {
    const { data, error: e } = await sb.from("vw_bit_avance_cl").select("*").in("ceco", cecos.length ? cecos : ["-"]);
    if (e) { setError("No se pudo cargar el avance. Reintenta en un momento."); return; }
    setError(""); setRutas(data || []);
  };
  // El monitoreo captura cada 5 minutos; aquí se refresca cada minuto.
  useEffect(() => {
    setRutas(null); cargar();
    const t = setInterval(() => { if (!document.hidden) cargar(); }, 60000);
    const foco = () => cargar();
    window.addEventListener("focus", foco);
    return () => { clearInterval(t); window.removeEventListener("focus", foco); };
  }, [cecos.join(",")]);   // eslint-disable-line react-hooks/exhaustive-deps

  const porCeco = useMemo(() => {
    const m = {};
    for (const r of rutas || []) (m[r.ceco] = m[r.ceco] || []).push(r);
    return m;
  }, [rutas]);

  if (error) return <div className="cl-card cl-sub"><style>{CSS_CL}</style>{error}</div>;
  if (rutas === null) return <div className="cl-card cl-sub"><style>{CSS_CL}</style>Cargando el avance…</div>;

  const hace = Math.min(...rutas.map((r) => Number(r.hace_minutos ?? 999)));
  const terminada = (r) => Number(r.pkg_pending || 0) === 0 && Number(r.pkg_total || 0) > 0;
  const lista = rutas
    .filter((r) => filtro === "todas" || (filtro === "alerta" && alertasDe(r).length) || (filtro === "terminadas" && terminada(r)) || (filtro === "en_ruta" && !terminada(r)))
    .sort((a, b) => alertasDe(b).length - alertasDe(a).length || avanceRuta(a) - avanceRuta(b));

  return (
    <div className="cl-wrap">
      <style>{CSS_CL}</style>
      <div className="cl-meta">
        {rutas.length ? <>Actualizado hace {Number.isFinite(hace) ? hace : "—"} min · se refresca solo</> : "Sin rutas en curso hoy"}
      </div>

      <div className="cl-cecos">{[...new Set(cecos)].filter((c) => !/^C_/.test(c)).map((c) => <TarjetaCeco key={c} ceco={c} rutas={porCeco[c] || []} />)}</div>

      {rutas.length > 0 && (
        <>
          <div className="cl-filtros">
            {[["todas", "Todas", rutas.length], ["alerta", "Con alerta", rutas.filter((r) => alertasDe(r).length).length],
              ["en_ruta", "En ruta", rutas.filter((r) => !terminada(r)).length], ["terminadas", "Terminadas", rutas.filter(terminada).length]]
              .map(([k, t, n]) => <button key={k} className={filtro === k ? "on" : ""} onClick={() => setFiltro(k)}>{t} <b>{n}</b></button>)}
          </div>
          <div className="cl-rutas">
            {lista.map((r) => (
              <FilaRuta key={r.id_ruta} r={r} abierta={abierto === r.id_ruta} onToggle={() => setAbierto(abierto === r.id_ruta ? null : r.id_ruta)} varios={cecos.length > 1} />
            ))}
          </div>
          {lista.length === 0 && <div className="cl-card cl-sub">No hay rutas en este filtro.</div>}
        </>
      )}
    </div>
  );
}

function TarjetaCeco({ ceco, rutas }) {
  const total = rutas.reduce((t, r) => t + Number(r.pkg_total || 0), 0);
  const entregados = rutas.reduce((t, r) => t + Number(r.pkg_delivered || 0), 0);
  const noEntregados = rutas.reduce((t, r) => t + Number(r.pkg_not_delivered || 0), 0);
  const pendientes = rutas.reduce((t, r) => t + Number(r.pkg_pending || 0), 0);
  const conAlerta = rutas.filter((r) => alertasDe(r).length).length;
  const avance = pct(entregados + noEntregados, total);
  return (
    <div className="cl-card">
      <div className="cl-fila">
        <div>
          <div className="cl-titulo">{nombreCeco(ceco)}</div>
          <div className="cl-sub">{rutas.length} rutas · {pendientes} paquetes por visitar</div>
        </div>
        <div className="cl-pct">{avance}%</div>
      </div>
      <div className="cl-barra"><span style={{ width: `${avance}%` }} /></div>
      <div className="cl-kpis">
        <div><b>{entregados}</b><span>Entregados</span></div>
        <div><b>{noEntregados}</b><span>No entregados</span></div>
        <div><b>{total}</b><span>Cargados</span></div>
        <div className={conAlerta ? "rojo" : ""}><b>{conAlerta}</b><span>Con alerta</span></div>
      </div>
    </div>
  );
}

function FilaRuta({ r, abierta, onToggle, varios }) {
  const al = alertasDe(r);
  const avance = avanceRuta(r);
  const meli = desempenoMeli(r);
  return (
    <button className={`cl-ruta${al.length ? " alerta" : ""}`} onClick={onToggle}>
      <div className="cl-fila">
        <div style={{ minWidth: 0 }}>
          <div className="cl-ruta-t">{r.driver_name || "Sin conductor"}</div>
          <div className="cl-sub">{r.vehicle_license || "—"} · Ruta {r.id_ruta}{varios ? ` · ${nombreCeco(r.ceco)}` : ""}</div>
        </div>
        <div className="cl-ruta-pct">{avance}%</div>
      </div>
      <div className="cl-barra fina"><span style={{ width: `${Math.min(100, avance)}%` }} /></div>
      <div className="cl-ruta-pie">
        <span>{Number(r.pkg_delivered || 0)}/{Number(r.pkg_total || 0)} entregados</span>
        {al.length > 0 && <span className="cl-chip">{al[0]}{al.length > 1 ? ` +${al.length - 1}` : ""}</span>}
      </div>
      {abierta && (
        <div className="cl-detalle">
          <div><span>Estado</span><b>{[r.status, r.substatus].filter(Boolean).join(" · ") || "—"}</b></div>
          <div><span>Ciclo</span><b>{r.cycle_name || "—"}</b></div>
          {meli !== null && <div><span>Desempeño MELI</span><b>{meli}%</b></div>}
          <div><span>Pendientes</span><b>{Number(r.pkg_pending || 0)}</b></div>
          <div><span>No entregados</span><b>{Number(r.pkg_not_delivered || 0)}</b></div>
          <div><span>Ayudante</span><b>{r.has_helper ? "Sí" : "No"}</b></div>
          {al.length > 0 && <div><span>Alertas</span><b>{al.join(" · ")}</b></div>}
        </div>
      )}
    </button>
  );
}

export const CSS_CL = `
.cl-mini{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#545454;}
.cl-devuelto{margin-top:10px;background:#FBEAE8;color:#D92D20;border-radius:10px;padding:8px 10px;font-size:13px;font-weight:600;}
.cl-form{margin-top:12px;display:flex;flex-direction:column;gap:8px;}
.cl-form select,.cl-form input,.cl-form textarea{width:100%;box-sizing:border-box;border:1px solid #E4E3E3;border-radius:10px;padding:10px 12px;font-size:16px;font-family:inherit;background:#fff;}
.cl-fotos{display:flex;align-items:center;justify-content:center;min-height:44px;border:1.5px dashed #FF6600;border-radius:12px;color:#FF6600;font-weight:600;font-size:14px;cursor:pointer;background:#FFF7F1;}
.cl-aviso{background:#FFF4E0;color:#C47A00;border-radius:10px;padding:8px 10px;font-size:13px;}
.cl-botones{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.cl-btn-ok,.cl-btn-no{min-height:46px;border-radius:12px;font-family:'Poppins',sans-serif;font-weight:600;font-size:14px;cursor:pointer;}
.cl-btn-ok{background:#FF6600;color:#fff;border:0;}
.cl-btn-no{background:#fff;color:#D92D20;border:1.5px solid #D92D20;}
.cl-btn-ok:disabled,.cl-btn-no:disabled{opacity:.6;cursor:default;}
.cl-wrap{display:flex;flex-direction:column;gap:10px;max-width:980px;}
.cl-rutas{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;}
.cl-cecos{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;}
.cl-meta{font-size:12.5px;color:#545454;padding:0 2px;}
.cl-card{background:#fff;border:1px solid #E4E3E3;border-radius:14px;padding:14px 16px;}
.cl-fila{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.cl-titulo{font-family:'Poppins',sans-serif;font-weight:700;font-size:17px;color:#002E5D;}
.cl-sub{font-size:13px;color:#545454;}
.cl-pct{font-family:'Poppins',sans-serif;font-weight:700;font-size:26px;color:#002E5D;}
.cl-barra{height:8px;border-radius:6px;background:#EEF0F3;overflow:hidden;margin:10px 0 12px;}
.cl-barra span{display:block;height:100%;background:#FF6600;border-radius:6px;transition:width .4s;}
.cl-barra.fina{height:6px;margin:8px 0;}
.cl-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center;}
.cl-kpis div{background:#F7F8FA;border-radius:10px;padding:8px 4px;display:flex;flex-direction:column;gap:2px;}
.cl-kpis b{font-family:'Poppins',sans-serif;font-size:16px;color:#002E5D;}
.cl-kpis span{font-size:11px;color:#545454;}
.cl-kpis .rojo{background:#FBEAE8;} .cl-kpis .rojo b{color:#D92D20;}
.cl-filtros{display:flex;gap:6px;overflow-x:auto;padding:2px 0;}
.cl-filtros button{flex-shrink:0;border:1px solid #E4E3E3;background:#fff;border-radius:20px;padding:7px 12px;font-size:13px;color:#545454;cursor:pointer;font-family:inherit;}
.cl-filtros button.on{background:#002E5D;border-color:#002E5D;color:#fff;}
.cl-filtros b{font-weight:700;margin-left:2px;}
.cl-ruta{display:block;align-self:start;width:100%;text-align:left;background:#fff;border:1px solid #E4E3E3;border-radius:12px;padding:12px 14px;cursor:pointer;font-family:inherit;}
.cl-ruta.alerta{border-left:4px solid #D92D20;}
.cl-ruta-t{font-weight:700;font-size:14.5px;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cl-ruta-pct{font-family:'Poppins',sans-serif;font-weight:700;font-size:18px;color:#002E5D;}
.cl-ruta-pie{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;color:#545454;}
.cl-chip{background:#FBEAE8;color:#D92D20;border-radius:10px;padding:2px 8px;font-weight:600;font-size:11.5px;}
.cl-detalle{margin-top:10px;border-top:1px solid #F0F0F0;padding-top:8px;display:grid;gap:5px;}
.cl-detalle div{display:flex;justify-content:space-between;gap:10px;font-size:13px;}
.cl-detalle span{color:#545454;} .cl-detalle b{color:#1a1a1a;text-align:right;}
`;

// ── 2. PNR ─────────────────────────────────────────────────────────────────
// Cada caso en "Esperando comprobante" o "Con Penalidad" es una tarea del
// supervisor de su CECO. En Chile el comprobante se carga DIRECTO EN LOGISTIC
// (no en la Bitácora): aquí el supervisor abre el caso, lo clasifica y avisa
// que lo cargó. La tarea se cierra sola cuando MELI muestra el caso con
// comprobante (pnr-cl lo lee cada 5 min) y el analista lo ve en el Brain.
// El plazo sale de postventa_sla_cl (pnr_meli), editable desde el Brain.
const LOGISTIC_CASO = (id) => `https://envios.adminml.com/logistics/case-center/cases/${id}`;
const ABIERTO_MELI = ["WAITING_RECEIPT", "TO_BILL"];
const BUCKET_CL = "pnr-pruebas-cl";
const CLASIF_CL = [
  ["caja_vacia", "Caja vacía", "Paquete sin producto en su interior"],
  ["entrega_tercero", "Entrega a un tercero", "Entregado a un tercero, con o sin autorización"],
  ["paquete_incompleto", "Paquete incompleto", "Falta parte del pedido: quedó en el vehículo, en la bodega o no lo envió el vendedor"],
  ["paquete_danado", "Paquete dañado", "Dañado en ruta, adulterado o con falla de fábrica"],
  ["paquete_extraviado", "Paquete extraviado", "Extraviado por transporte o conserjería"],
  ["reclamo_proveedor", "Reclamo al proveedor", "El reclamo es para el vendedor o proveedor"],
  ["otros", "Otros", "Ninguna de las anteriores"],
];
const SUB_CL = { WAITING_RECEIPT: "Esperando comprobante", TO_BILL: "Con Penalidad" };
const clp = (n) => "$" + Math.round(Number(n || 0)).toLocaleString("es-CL");

function useAhora(ms = 1000) {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return t;
}

function PnrCL({ cecos, perfil, onCambio }) {
  const [tareas, setTareas] = useState(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState("pendiente");   // pendiente · enviadas · aprobadas

  const [slaH, setSlaH] = useState(null);
  const cargar = async () => {
    const { data, error: e } = await sb.from("vw_pnr_tareas_bitacora_cl").select("*")
      .in("ceco", cecos.length ? cecos : ["-"]).is("cerrada_en", null).order("vence_en");
    if (e) { setError("No se pudieron cargar los PNR. Reintenta en un momento."); return; }
    const s = await sb.from("postventa_sla_cl").select("sla_horas").eq("origen", "pnr_meli").maybeSingle();
    if (s.data && s.data.sla_horas) setSlaH(Number(s.data.sla_horas));
    setError(""); setTareas(data || []);
  };
  useEffect(() => { setTareas(null); cargar(); const t = setInterval(cargar, 120000); return () => clearInterval(t); }, [cecos.join(",")]);   // eslint-disable-line react-hooks/exhaustive-deps
  const listo = () => { cargar(); onCambio && onCambio(); };

  if (error) return <div className="cl-card cl-sub"><style>{CSS_CL}</style>{error}</div>;
  if (tareas === null) return <div className="cl-card cl-sub"><style>{CSS_CL}</style>Cargando los PNR…</div>;

  // Plazo editable: desde que MELI abrió el caso + las horas de postventa_sla_cl.
  const conPlazo = tareas.map((t) => ({ ...t,
    vence_en: slaH && t.fecha_caso ? new Date(new Date(t.fecha_caso).getTime() + slaH * 3600000).toISOString() : t.vence_en }));
  // Cargado en Logistic: MELI ya no lo muestra esperando comprobante, aunque el supervisor no haya avisado.
  const cargado = (t) => t.sub_estado && !ABIERTO_MELI.includes(t.sub_estado);
  const grupos = {
    pendiente: conPlazo.filter((t) => t.estado === "pendiente" && !cargado(t)),
    enviadas: conPlazo.filter((t) => t.estado !== "aprobada" && (cargado(t) || t.estado === "completada" || t.estado === "sin_pruebas")),
    aprobadas: conPlazo.filter((t) => t.estado === "aprobada"),
  };
  const lista = grupos[vista];

  return (
    <div className="cl-wrap">
      <style>{CSS_CL}</style>
      <div className="cl-filtros">
        {[["pendiente", "Por resolver"], ["enviadas", "Cargados en Logistic"], ["aprobadas", "Aprobados"]].map(([k, t]) => (
          <button key={k} className={vista === k ? "on" : ""} onClick={() => setVista(k)}>{t} <b>{grupos[k].length}</b></button>
        ))}
      </div>
      {lista.length === 0 && (
        <div className="cl-card cl-sub">{vista === "pendiente" ? "No tienes PNR por resolver. ¡Todo al día!" : "No hay PNR en esta lista."}</div>
      )}
      <div className="cl-rutas">
        {lista.map((t) => <TarjetaPnr key={t.id} t={t} perfil={perfil} varios={cecos.length > 1} onListo={listo} />)}
      </div>
    </div>
  );
}

export function Contador({ vence }) {
  const ahora = useAhora();
  const ms = new Date(vence).getTime() - ahora;
  const venc = ms <= 0;
  const a = Math.abs(ms), h = Math.floor(a / 3600000), m = Math.floor((a % 3600000) / 60000), s = Math.floor((a % 60000) / 1000);
  const txt = `${venc ? "-" : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const color = venc ? "#D92D20" : h < 12 ? "#C47A00" : "#002E5D";
  return (
    <div>
      <div className="cl-mini">{venc ? "PLAZO VENCIDO HACE" : "TIEMPO RESTANTE"}</div>
      <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 28, color, lineHeight: 1.1 }}>{txt}</div>
      <div className="cl-mini" style={{ textTransform: "none", letterSpacing: 0 }}>Vence {new Date(vence).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
    </div>
  );
}

function TarjetaPnr({ t, perfil, varios, onListo }) {
  const pendiente = t.estado === "pendiente";
  const [clasif, setClasif] = useState(t.clasificacion || "");
  const [nota, setNota] = useState(t.clasificacion_nota || "");
  const [comentario, setComentario] = useState(t.comentario || "");
  const [archivos, setArchivos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState("");

  const enviar = async (estado) => {
    if (!clasif) { setAviso("Falta clasificar el PNR."); return; }
    if (clasif === "otros" && !nota.trim()) { setAviso("Elegiste «Otros»: escribe de qué se trató."); return; }
    setBusy(true); setAviso("");
    try {
      const rutas = [];
      for (const f of archivos) {
        const ruta = `${t.case_id}/${Date.now()}_${f.name.replace(/[^\w.-]+/g, "_")}`;
        const { error } = await sb.storage.from(BUCKET_CL).upload(ruta, f, { upsert: false });
        if (error) throw new Error("No se pudo subir " + f.name + ": " + error.message);
        rutas.push(ruta);
      }
      const { error } = await sb.from("pnr_tareas_cl").update({
        estado, clasificacion: clasif, clasificacion_nota: clasif === "otros" ? nota.trim() : null,
        comentario: comentario.trim() || null, fotos: [...(t.fotos || []), ...rutas],
        completada_en: new Date().toISOString(), completada_por: perfil?.email || null,
      }).eq("id", t.id);
      if (error) throw new Error(error.message);
      onListo();
    } catch (e) { setAviso(e.message); } finally { setBusy(false); }
  };

  return (
    <div className={`cl-ruta${pendiente && new Date(t.vence_en) < new Date() ? " alerta" : ""}`} style={{ cursor: "default" }}>
      <div className="cl-fila" style={{ alignItems: "flex-start" }}>
        {pendiente ? <Contador vence={t.vence_en} /> : (
          <span className="cl-chip" style={{ background: t.estado === "aprobada" ? "#E8F4EC" : "#FFF4E0", color: t.estado === "aprobada" ? "#1A7A3C" : "#C47A00" }}>
            {t.estado === "aprobada" ? "Aprobado por el analista" : t.estado === "sin_pruebas" ? "Informado sin pruebas"
              : t.sub_estado && !ABIERTO_MELI.includes(t.sub_estado) ? "Comprobante cargado en Logistic" : "Avisado: cargado en Logistic"}
          </span>
        )}
        <div style={{ textAlign: "right" }}>
          <div className="cl-ruta-pct">{clp(t.monto)}</div>
          <div className="cl-mini" style={{ textTransform: "none", letterSpacing: 0 }}>monto en riesgo</div>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="cl-ruta-t">{t.conductor || "Sin conductor"}</div>
        <div className="cl-sub">Caso {t.case_id} · envío {t.shipment_id || "—"} · ruta {t.route_code || "—"}{varios ? ` · ${nombreCeco(t.ceco)}` : ""}</div>
        <div className="cl-sub">{SUB_CL[t.sub_estado] || t.sub_estado} · SC {t.service_center || "—"}</div>
      </div>
      {t.veces_pedida > 1 && t.aprobada_nota && pendiente && (
        <div className="cl-devuelto">El analista lo devolvió: {t.aprobada_nota}</div>
      )}
      {pendiente ? (
        <div className="cl-form">
          <label className="cl-mini">Clasificación del PNR · obligatoria</label>
          <select value={clasif} onChange={(e) => setClasif(e.target.value)}>
            <option value="">— Elige el motivo del reclamo —</option>
            {CLASIF_CL.map(([k, et, ay]) => <option key={k} value={k}>{et} · {ay}</option>)}
          </select>
          {clasif === "otros" && <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="¿De qué se trató?" />}
          <textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentario (opcional): qué dijo el conductor" />
          <a className="cl-fotos" href={LOGISTIC_CASO(t.case_id)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            📎 Abrir el caso en Logistic para cargar el comprobante
          </a>
          {aviso && <div className="cl-aviso">{aviso}</div>}
          <div className="cl-botones">
            <button className="cl-btn-ok" disabled={busy} onClick={() => enviar("completada")}>{busy ? "Guardando…" : "Ya lo cargué en Logistic"}</button>
            <button className="cl-btn-no" disabled={busy} onClick={() => enviar("sin_pruebas")}>No hay pruebas</button>
          </div>
        </div>
      ) : (
        <div className="cl-sub" style={{ marginTop: 8 }}>
          {(CLASIF_CL.find(([k]) => k === t.clasificacion) || [])[1] || "Sin clasificar"} · {SUB_CL[t.sub_estado] || "Comprobante cargado"}
          {t.completada_en ? ` · enviado ${new Date(t.completada_en).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
        </div>
      )}
    </div>
  );
}
