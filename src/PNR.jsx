import { useState, useEffect } from "react";
import { sb } from "./shared";

// ─── MÓDULO PNR ─────────────────────────────────────────────────────
// ─── MÓDULO PNR ─────────────────────────────────────────────────────
function ModuloPNR() {
  const [casos, setCasos] = useState([]);
  const [estadoRuta, setEstadoRuta] = useState({});
  const [supervisores, setSupervisores] = useState({});
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState("");
  const [periodos, setPeriodos] = useState([]);
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroSC, setFiltroSC] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [tabPnr, setTabPnr] = useState("casos");
  const [ahora, setAhora] = useState(Date.now());

  useEffect(() => { cargarPeriodos(); cargarEstadoRuta(); cargarSupervisores(); }, []);
  useEffect(() => { if (periodo) cargarCasos(periodo); }, [periodo]);
  // Cronómetro: refresca el "ahora" cada segundo para la cuenta regresiva en vivo
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);

  const cargarPeriodos = async () => {
    const { data } = await sb.from("pnr_casos").select("periodo").not("periodo", "is", null).order("periodo", { ascending: false });
    const unicos = [...new Set((data || []).map(d => d.periodo))];
    setPeriodos(unicos);
    if (unicos.length) setPeriodo(unicos[0]);
    else setLoading(false);
  };

  const cargarCasos = async (p) => {
    setLoading(true);
    const { data } = await sb.from("pnr_casos").select("*").eq("periodo", p).order("fecha_caso", { ascending: false });
    setCasos(data || []);
    setLoading(false);
  };

  // Cruce con la vista de estado de ruta (en ruta hoy / finalizada + datos de la ruta)
  const cargarEstadoRuta = async () => {
    const { data } = await sb.from("vw_pnr_estado_ruta").select("*");
    const mapa = {};
    (data || []).forEach(r => { mapa[r.id_caso] = r; });
    setEstadoRuta(mapa);
  };

  // Supervisor por SC (estacion_origen)
  const cargarSupervisores = async () => {
    const { data } = await sb.from("vw_pnr_supervisor").select("*");
    const mapa = {};
    (data || []).forEach(s => { mapa[s.estacion_origen] = s; });
    setSupervisores(mapa);
  };

  const estadoColor = {
    "Esperando comprobante":   { bg: "#fef3c7", color: "#92400e" },
    "Comprobante cargado":     { bg: "#dbeafe", color: "#1e40af" },
    "Pendiente de revision":   { bg: "#f3e8ff", color: "#6b21a8" },
    "Sin comprobante cargado": { bg: "#fee2e2", color: "#c0392b" },
    "Anulado":                 { bg: "#f1f5f9", color: "#475569" },
    "Con penalidad":           { bg: "#fde68a", color: "#854d0e" },
    "Enviado a facturacion":   { bg: "#d1fae5", color: "#065f46" },
  };
  const getEstilo = (e) => estadoColor[e] || { bg: "#f1f5f9", color: "#475569" };

  // Estados considerados "abiertos" (reloj de 48h corre)
  const ABIERTOS = ["Pendiente de revision", "Esperando comprobante", "Sin comprobante cargado"];
  const esAbierto = (e) => ABIERTOS.includes(e);

  // ¿El PNR está en una ruta de hoy? (lo trae la vista vw_pnr_estado_ruta)
  const enRutaHoy = (c) => !!(estadoRuta[c.id_caso] && estadoRuta[c.id_caso].en_ruta_hoy);

  // Cronómetro de 48h: devuelve {texto, bg, color, vencido}
  const cronometro = (c) => {
    if (!c.fecha_caso) return null;
    const limite = new Date(c.fecha_caso).getTime() + 48 * 3600 * 1000;
    let diff = limite - ahora;
    if (diff <= 0) return { texto: "VENCIDO", bg: "#fee2e2", color: "#991b1b", vencido: true };
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const pad = (n) => String(n).padStart(2, "0");
    const texto = `${pad(h)}:${pad(m)}:${pad(s)}`;
    if (diff <= 2 * 3600000) return { texto, bg: "#fee2e2", color: "#991b1b" };
    if (diff <= 6 * 3600000) return { texto, bg: "#fef3c7", color: "#92400e" };
    return { texto, bg: "#f1f5f9", color: "#64748b" };
  };

  // Botón de notificación (preparado; el flujo n8n se conecta después)
  const notificar = (c, canal) => {
    const sup = supervisores[c.estacion_origen];
    if (!sup) { alert("Este SC (" + (c.estacion_origen || "—") + ") no tiene supervisor asignado en supervisores_bt."); return; }
    alert("Notificación por " + canal + " preparada para " + sup.supervisor_nombre + " (PNR " + c.id_caso + ").\n\nEl envío automático se activa con el flujo de notificaciones (pendiente).");
  };

  const casosFiltrados = casos.filter(c => {
    const matchEstado = filtroEstado === "todos" || c.estado === filtroEstado;
    const matchSC = filtroSC === "todos" || c.estacion_origen === filtroSC;
    const matchBusqueda = !busqueda || c.id_caso?.includes(busqueda) || c.ruta?.toLowerCase().includes(busqueda.toLowerCase()) || c.id_conductor?.toLowerCase().includes(busqueda.toLowerCase()) || c.productos?.toLowerCase().includes(busqueda.toLowerCase());
    return matchEstado && matchSC && matchBusqueda;
  });

  const casosHoy = casosFiltrados.filter(c => enRutaHoy(c));
  const casosResto = casosFiltrados.filter(c => !enRutaHoy(c));

  const estadosUnicos = [...new Set(casos.map(c => c.estado).filter(Boolean))];
  const scUnicos = [...new Set(casos.map(c => c.estacion_origen).filter(Boolean))].sort();
  const totalValor = casos.reduce((a, c) => a + (c.valor_compra || 0), 0);
  const porEstado = estadosUnicos.map(e => ({ estado: e, cantidad: casos.filter(c => c.estado === e).length, valor: casos.filter(c => c.estado === e).reduce((a, c) => a + (c.valor_compra || 0), 0) }));
  const enRutaHoyCount = casos.filter(c => enRutaHoy(c)).length;

  // Tarjeta de un PNR (usada en ambas secciones)
  const tarjetaPNR = (c, i) => {
    const estilo = getEstilo(c.estado);
    const er = estadoRuta[c.id_caso];
    const sup = supervisores[c.estacion_origen];
    const crono = esAbierto(c.estado) ? cronometro(c) : null;
    const hoy = enRutaHoy(c);
    return (
      <div key={c.id || c.id_caso || i} style={{ background:"#fff", border:"1px solid #e4e7ec", borderLeft: hoy ? "3px solid #16a34a" : "3px solid #cbd5e1", borderRadius:10, padding:"12px 14px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:13, fontWeight:800, color:"#1a3a6b" }}>PNR {c.id_caso}</span>
          <span style={{ ...estilo, padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>{c.estado || "—"}</span>
          <span style={{ fontSize:11, fontWeight:700, color:"#475569", background:"#f1f5f9", padding:"2px 8px", borderRadius:6 }}>{c.estacion_origen || "—"}</span>
          {crono && <span style={{ marginLeft:"auto", fontSize:13, fontWeight:800, fontVariantNumeric:"tabular-nums", padding:"2px 10px", borderRadius:6, background:crono.bg, color:crono.color }}>⏳ {crono.texto}</span>}
        </div>
        <div style={{ fontSize:12, color:"#555", marginTop:6 }}>{c.productos || "—"} · <strong>${(c.valor_compra || 0).toLocaleString("es-MX")}</strong></div>
        {c.pedido_revision ? <div style={{ fontSize:12, color:"#92400e", marginTop:4 }}>⚠ {c.pedido_revision}</div> : null}
        <div style={{ fontSize:12, marginTop:4 }}>
          {hoy
            ? <span style={{ color:"#16a34a", fontWeight:600 }}>🚚 {er?.ruta_driver || "—"} · {er?.pendientes != null ? er.pendientes + " pendientes" : "ruta de hoy"}</span>
            : <span style={{ color:"#94a3b8" }}>🕐 ruta pasada{er?.ruta_driver ? " · " + er.ruta_driver : ""}</span>}
        </div>
        <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginTop:8, paddingTop:8, borderTop:"1px solid #f1f5f9", fontSize:11, color:"#94a3b8" }}>
          <span>📅 {c.fecha_caso ? new Date(c.fecha_caso).toLocaleString("es-MX",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "—"}</span>
          {c.id_envio ? <span>📦 Envío {c.id_envio}</span> : null}
          {c.id_reclamo ? <span>📄 Reclamo {c.id_reclamo}</span> : null}
          <span>🛣 Ruta {c.ruta || "—"}</span>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:10 }}>
          <button onClick={() => notificar(c, "WhatsApp")} style={{ fontSize:11, padding:"5px 12px", borderRadius:8, border:"1px solid #25d366", background:"#fff", color:"#128c3e", cursor:"pointer", fontWeight:700, fontFamily:"'Outfit', sans-serif" }}>💬 WhatsApp</button>
          <button onClick={() => notificar(c, "Correo")} style={{ fontSize:11, padding:"5px 12px", borderRadius:8, border:"1px solid #3B82F6", background:"#fff", color:"#1e40af", cursor:"pointer", fontWeight:700, fontFamily:"'Outfit', sans-serif" }}>✉ Correo</button>
          <span style={{ marginLeft:"auto", fontSize:11, color:"#94a3b8" }}>Sup: {sup?.supervisor_nombre || "sin asignar"}</span>
        </div>
      </div>
    );
  };

  if (loading) return <div className="pg" style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh" }}><div style={{ textAlign:"center" }}><div style={{ fontSize:40, marginBottom:12 }}>📋</div><div style={{ fontSize:14, color:"#888" }}>Cargando PNR...</div></div></div>;

  if (!casos.length && !loading) return <div className="pg" style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh" }}><div style={{ textAlign:"center" }}><div style={{ fontSize:48, marginBottom:12 }}>📭</div><div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>Sin datos de PNR</div><div style={{ fontSize:13, color:"#888" }}>Usa el botón PNR en Don B para sincronizar</div></div></div>;

  return (
    <div className="pg">
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:"#1a3a6b" }}>📋 PNR</div>
          <div style={{ fontSize:12, color:"#888", marginTop:2 }}>Reclamos · plazo 48h para responder</div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <select value={periodo} onChange={e => setPeriodo(e.target.value)} style={{ fontSize:12, padding:"6px 10px", borderRadius:8, border:"1px solid #e4e7ec", fontFamily:"'Outfit', sans-serif" }}>
            {periodos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={() => { cargarCasos(periodo); cargarEstadoRuta(); }} style={{ fontSize:12, padding:"6px 14px", borderRadius:8, border:"1px solid #e4e7ec", background:"#fff", cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>🔄 Actualizar</button>
        </div>
      </div>

      <div className="three-col" style={{ marginBottom:20 }}>
        <div className="form-card" style={{ textAlign:"center", padding:"16px 12px" }}>
          <div style={{ fontSize:36, fontWeight:800, color:"#1a3a6b" }}>{casos.length}</div>
          <div style={{ fontSize:11, color:"#888", fontWeight:600, textTransform:"uppercase", letterSpacing:1 }}>Total Casos</div>
        </div>
        <div className="form-card" style={{ textAlign:"center", padding:"16px 12px" }}>
          <div style={{ fontSize:36, fontWeight:800, color:"#16a34a" }}>{enRutaHoyCount}</div>
          <div style={{ fontSize:11, color:"#888", fontWeight:600, textTransform:"uppercase", letterSpacing:1 }}>En Ruta Hoy</div>
        </div>
        <div className="form-card" style={{ textAlign:"center", padding:"16px 12px" }}>
          <div style={{ fontSize:28, fontWeight:800, color:"#c0392b" }}>${totalValor.toLocaleString("es-MX", { minimumFractionDigits:0 })}</div>
          <div style={{ fontSize:11, color:"#888", fontWeight:600, textTransform:"uppercase", letterSpacing:1 }}>Valor Total en Riesgo</div>
        </div>
      </div>

      <div style={{ display:"flex", gap:0, borderBottom:"2px solid #e4e7ec", marginBottom:16 }}>
        {[{id:"casos",label:"📋 Casos"},{id:"resumen",label:"📊 Por Estado"},{id:"rutas",label:"🚛 Por Ruta"}].map(t => (
          <button key={t.id} onClick={() => setTabPnr(t.id)} style={{ padding:"10px 20px", background:"none", border:"none", borderBottom:tabPnr===t.id?"2px solid #3B82F6":"2px solid transparent", color:tabPnr===t.id?"#3B82F6":"#555", fontSize:12, fontWeight:800, cursor:"pointer", marginBottom:-2, fontFamily:"'Outfit', sans-serif" }}>{t.label}</button>
        ))}
      </div>

      {tabPnr === "casos" && (
        <div>
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
            <input placeholder="🔍 Buscar caso, ruta, conductor, producto..." value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ fontSize:12, padding:"6px 12px", borderRadius:8, border:"1px solid #e4e7ec", fontFamily:"'Outfit', sans-serif", minWidth:280 }} />
            <select value={filtroSC} onChange={e => setFiltroSC(e.target.value)} style={{ fontSize:12, padding:"6px 10px", borderRadius:8, border:"1px solid #e4e7ec", fontFamily:"'Outfit', sans-serif" }}>
              <option value="todos">Todos los SC</option>
              {scUnicos.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ fontSize:12, padding:"6px 10px", borderRadius:8, border:"1px solid #e4e7ec", fontFamily:"'Outfit', sans-serif" }}>
              <option value="todos">Todos los estados</option>
              {estadosUnicos.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <span style={{ fontSize:12, color:"#888" }}>{casosFiltrados.length} casos</span>
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:8, margin:"0 0 10px" }}>
            <span style={{ fontSize:14, fontWeight:800, color:"#16a34a" }}>🚚 En ruta hoy</span>
            <span style={{ fontSize:11, color:"#888", background:"#f1f5f9", padding:"2px 8px", borderRadius:6 }}>accionable ahora · {casosHoy.length}</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:22 }}>
            {casosHoy.length ? casosHoy.map(tarjetaPNR) : <div style={{ fontSize:12, color:"#94a3b8", padding:"8px" }}>Sin PNR en ruta hoy para este filtro.</div>}
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:8, margin:"0 0 10px" }}>
            <span style={{ fontSize:14, fontWeight:800, color:"#64748b" }}>🕐 Rutas pasadas</span>
            <span style={{ fontSize:11, color:"#888", background:"#f1f5f9", padding:"2px 8px", borderRadius:6 }}>{casosResto.length}</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {casosResto.length ? casosResto.map(tarjetaPNR) : <div style={{ fontSize:12, color:"#94a3b8", padding:"8px" }}>Sin PNR de rutas pasadas para este filtro.</div>}
          </div>
        </div>
      )}

      {tabPnr === "resumen" && (
        <div className="form-card" style={{ padding:0, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:"#f8f9fa" }}>
                {["Estado","Cantidad","Valor"].map(h => <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontWeight:700, color:"#555", borderBottom:"1px solid #e4e7ec" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {porEstado.sort((a,b)=>b.cantidad-a.cantidad).map((r, i) => {
                const estilo = getEstilo(r.estado);
                return (
                  <tr key={i} style={{ borderBottom:"1px solid #f4f5f7" }}>
                    <td style={{ padding:"9px 14px" }}><span style={{ ...estilo, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>{r.estado}</span></td>
                    <td style={{ padding:"9px 14px", fontWeight:700, color:"#1a3a6b" }}>{r.cantidad}</td>
                    <td style={{ padding:"9px 14px", color:"#c0392b", fontWeight:600 }}>${r.valor.toLocaleString("es-MX")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tabPnr === "rutas" && (
        <div className="form-card" style={{ padding:0, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:"#f8f9fa" }}>
                {["Ruta","Conductor","Casos","Valor"].map(h => <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontWeight:700, color:"#555", borderBottom:"1px solid #e4e7ec" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...new Set(casos.map(c => c.ruta).filter(Boolean))].map((ruta, i) => {
                const delRuta = casos.filter(c => c.ruta === ruta);
                const valor = delRuta.reduce((a, c) => a + (c.valor_compra || 0), 0);
                const driver = estadoRuta[delRuta[0]?.id_caso]?.ruta_driver || delRuta[0]?.id_conductor || "—";
                return (
                  <tr key={i} style={{ borderBottom:"1px solid #f4f5f7" }}>
                    <td style={{ padding:"9px 14px", fontWeight:600, color:"#1a3a6b" }}>{ruta}</td>
                    <td style={{ padding:"9px 14px", color:"#555" }}>{driver}</td>
                    <td style={{ padding:"9px 14px", fontWeight:700 }}>{delRuta.length}</td>
                    <td style={{ padding:"9px 14px", color:"#c0392b", fontWeight:600 }}>${valor.toLocaleString("es-MX")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ModuloPNR;
