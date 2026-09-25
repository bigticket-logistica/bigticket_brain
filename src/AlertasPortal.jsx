// ═══════════════════════════════════════════════════════════════════════════
// AlertasPortal.jsx — Lo que le llega al tercero en la campana y en el Inicio
// de su portal.
//
// Catálogo: una fila por tipo de alerta. El disparador es código (no se edita
// aquí); el texto, el color, el plazo y a dónde lleva sí. Los cambios valen
// para las alertas nuevas: las que ya se generaron conservan lo que el tercero
// leyó.
//
// Avisos puntuales: mensajes que no nacen de una acción del sistema. Van a
// todos, a un centro o a una empresa, con fecha de inicio y de fin.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "./shared";

const AZUL = "#1a3a6b";
const BORDE = "#e4e7ec";

// Colores del portal (maqueta de marketing y manual de marca).
const ESTILOS = {
  rojo:    { label: "Rojo · urgente",     borde: "#C43D2F", fg: "#C43D2F", bg: "#FBE3E0" },
  naranja: { label: "Naranja · pendiente", borde: "#FF6600", fg: "#FF6600", bg: "#FDE7D7" },
  azul:    { label: "Azul · novedad",     borde: "#002E5D", fg: "#002E5D", bg: "#E1E8F0" },
  verde:   { label: "Verde · a su favor", borde: "#1A7A3C", fg: "#1A7A3C", bg: "#E2F1E7" },
};

// Pantallas del portal a las que puede llevar una alerta.
const DESTINOS = [
  ["home", "Inicio"], ["movimientos", "Mi billetera · Movimientos"], ["descuentos", "Mi billetera · Descuentos"],
  ["facturacion", "Facturación · Por facturar"], ["facturado", "Facturación · Facturado"], ["pagado", "Facturación · Pagado"],
  ["flota", "Mi operación · Mi Flota"], ["certificar", "Certificación · Certificar"], ["estado", "Certificación · Estado"],
  ["firma", "Certificación · Firma de contrato"], ["baja", "Certificación · Solicitar baja"],
  ["perfil", "Mi empresa · Perfil y cuenta bancaria"], ["docs", "Mi empresa · Documentos"],
  ["consultas", "Consultas"], ["postula", "Postula (peak)"],
];
const nombreDestino = (k) => (DESTINOS.find(d => d[0] === k) || [k, k])[1];

// Valores de ejemplo para la vista previa de cada variable.
const EJEMPLO = {
  fecha: "24 sep", monto: "$2,157.00", concepto: "PNR facturado", placa: "LG37936", vence: "5 oct",
  semana: "40", sc: "SQR1", sat_estado: "Cancelado", referencia: " · ref. SPEI 123",
  folio: "6", reconocido: "$2,157.00", reclamado: "$2,157.00", titulo: "Firma el contrato de Luis M.",
};
const rellenar = (t) => String(t || "").replace(/\{(\w+)\}/g, (m, k) => EJEMPLO[k] ?? m);

const input = { width: "100%", border: `1px solid ${BORDE}`, borderRadius: 7, padding: "7px 9px", fontSize: 13, boxSizing: "border-box" };
const label = { fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4, display: "block" };

export default function ModuloAlertasPortal({ usuario }) {
  const [pestana, setPestana] = useState("catalogo");
  return (
    <div style={{ padding: "18px 22px", maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: AZUL }}>Alertas del portal de terceros</div>
      <div style={{ fontSize: 13, color: "#64748b", margin: "4px 0 16px" }}>
        Lo que le llega a cada transportista en la campana y en el inicio de su portal.
      </div>
      <div style={{ display: "flex", gap: 6, borderBottom: `1px solid ${BORDE}`, marginBottom: 18 }}>
        {[["catalogo", "Catálogo de alertas"], ["avisos", "Avisos puntuales"]].map(([k, l]) => (
          <button key={k} onClick={() => setPestana(k)} style={{
            border: "none", background: "none", padding: "9px 14px", fontSize: 14, cursor: "pointer",
            fontWeight: pestana === k ? 700 : 500, color: pestana === k ? AZUL : "#64748b",
            borderBottom: `2px solid ${pestana === k ? AZUL : "transparent"}`, marginBottom: -1,
          }}>{l}</button>
        ))}
      </div>
      {pestana === "catalogo" ? <Catalogo usuario={usuario} /> : <Avisos usuario={usuario} />}
    </div>
  );
}

// ── Vista previa con el mismo estilo que el portal ─────────────────────────
function Previa({ titulo, detalle, estilo, etiqueta }) {
  const e = ESTILOS[estilo] || ESTILOS.naranja;
  return (
    <div style={{ background: "#F4F3F3", borderRadius: 10, padding: 12 }}>
      <div style={{
        background: "#fff", border: "1px solid #E4E3E3", borderLeft: `4px solid ${e.borde}`, borderRadius: 12,
        padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        fontFamily: "'Open Sans', system-ui, sans-serif",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "Poppins, system-ui, sans-serif", fontWeight: 700, fontSize: 14.5, color: "#002E5D", marginBottom: 4 }}>
            {titulo || "Título de la alerta"}
          </div>
          {detalle && <div style={{ fontSize: 13, color: "#545454" }}>{detalle}</div>}
        </div>
        <span style={{
          fontFamily: "Poppins, system-ui, sans-serif", fontWeight: 700, fontSize: 12, color: e.fg, background: e.bg,
          padding: "6px 14px", borderRadius: 999, whiteSpace: "nowrap",
        }}>{etiqueta || "Etiqueta"}</span>
      </div>
    </div>
  );
}

// ── Catálogo ───────────────────────────────────────────────────────────────
function Catalogo({ usuario }) {
  const [filas, setFilas] = useState(null);
  const [edit, setEdit] = useState({});
  const [abierta, setAbierta] = useState(null);
  const [msg, setMsg] = useState(null);
  const [guardando, setGuardando] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error } = await sb.from("config_notificaciones").select("*").order("orden");
    if (error) { setMsg({ ok: false, txt: "No se pudo leer el catálogo: " + error.message }); setFilas([]); return; }
    setFilas(data || []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const valor = (f, k) => (edit[f.tipo] && k in edit[f.tipo]) ? edit[f.tipo][k] : f[k];
  const cambiar = (f, k, v) => setEdit(p => ({ ...p, [f.tipo]: { ...(p[f.tipo] || {}), [k]: v } }));
  const sucia = (f) => !!edit[f.tipo] && Object.keys(edit[f.tipo]).length > 0;

  const guardar = async (f, extra = {}) => {
    const cambios = { ...(edit[f.tipo] || {}), ...extra };
    for (const k of ["plazo_dias", "dias_urgente", "dias_visible"]) {
      if (k in cambios) cambios[k] = cambios[k] === "" || cambios[k] == null ? null : Number(cambios[k]);
    }
    if ("titulo" in cambios && !String(cambios.titulo).trim()) { setMsg({ ok: false, txt: "El título no puede quedar vacío." }); return; }
    setGuardando(f.tipo);
    const { error } = await sb.from("config_notificaciones").update({
      ...cambios, editado_por: usuario?.email || usuario?.nombre || "brain", editado_at: new Date().toISOString(),
    }).eq("tipo", f.tipo);
    setGuardando(null);
    if (error) { setMsg({ ok: false, txt: "No se pudo guardar: " + error.message }); return; }
    setEdit(p => { const n = { ...p }; delete n[f.tipo]; return n; });
    setMsg({ ok: true, txt: `"${f.nombre}" guardada. Aplica a las alertas nuevas.` });
    await cargar();
  };

  if (filas === null) return <div style={{ color: "#94a3b8", fontSize: 14 }}>Cargando catálogo…</div>;

  return (
    <div>
      {msg && (
        <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 7, fontSize: 13,
          background: msg.ok ? "#dcfce7" : "#fee2e2", color: msg.ok ? "#166534" : "#991b1b" }}>{msg.txt}</div>
      )}
      <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 12 }}>
        Las <b>pendientes</b> se apagan solas cuando el tercero cumple (sube la factura, firma, reclama) o cuando vence el plazo.
        Las <b>novedades</b> se muestran hasta que las abre o hasta que pasan los días de visibilidad.
      </div>

      {filas.map(f => {
        const open = abierta === f.tipo;
        const est = ESTILOS[valor(f, "estilo")] || ESTILOS.naranja;
        return (
          <div key={f.tipo} style={{ background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, marginBottom: 10, opacity: f.activa ? 1 : 0.6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer" }}
              onClick={() => setAbierta(open ? null : f.tipo)}>
              <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: est.borde }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: AZUL }}>{f.nombre}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                    background: f.clase === "pendiente" ? "#fef3c7" : "#e0e7ff", color: f.clase === "pendiente" ? "#92400e" : "#3730a3" }}>
                    {f.clase === "pendiente" ? "Pendiente" : "Novedad"}
                  </span>
                  {!f.activa && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "#f1f5f9", color: "#64748b" }}>Apagada</span>}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>⚡ {f.disparador} · lleva a {nombreDestino(f.destino)}</div>
              </div>
              <label onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", cursor: "pointer" }}>
                <input type="checkbox" checked={!!f.activa} disabled={guardando === f.tipo}
                  onChange={e => guardar(f, { activa: e.target.checked })} />
                Activa
              </label>
              <span style={{ color: "#94a3b8", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
            </div>

            {open && (
              <div style={{ borderTop: `1px solid ${BORDE}`, padding: 14, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <span style={label}>Título</span>
                    <input style={input} value={valor(f, "titulo") || ""} onChange={e => cambiar(f, "titulo", e.target.value)} />
                  </div>
                  <div>
                    <span style={label}>Detalle</span>
                    <input style={input} value={valor(f, "detalle") || ""} onChange={e => cambiar(f, "detalle", e.target.value)} />
                  </div>
                  <div style={{ fontSize: 11.5, color: "#64748b" }}>
                    Variables disponibles: <code>{f.variables || "ninguna"}</code>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <span style={label}>Color</span>
                      <select style={input} value={valor(f, "estilo")} onChange={e => cambiar(f, "estilo", e.target.value)}>
                        {Object.entries(ESTILOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <span style={label}>Etiqueta</span>
                      <input style={input} value={valor(f, "etiqueta") || ""} onChange={e => cambiar(f, "etiqueta", e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <span style={label}>Lleva a</span>
                    <select style={input} value={valor(f, "destino")} onChange={e => cambiar(f, "destino", e.target.value)}>
                      {DESTINOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    {f.tipo === "solicitud" && (
                      <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 4 }}>
                        Las firmas llevan a Firma de contrato y los documentos a Documentos, sin importar esta opción.
                      </div>
                    )}
                  </div>
                  {f.clase === "pendiente" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <span style={label}>Plazo (días)</span>
                        <input style={input} type="number" min="0" placeholder="sin plazo"
                          value={valor(f, "plazo_dias") ?? ""} onChange={e => cambiar(f, "plazo_dias", e.target.value)} />
                      </div>
                      <div>
                        <span style={label}>Rojo desde (días antes)</span>
                        <input style={input} type="number" min="0" placeholder="nunca"
                          value={valor(f, "dias_urgente") ?? ""} onChange={e => cambiar(f, "dias_urgente", e.target.value)} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span style={label}>Visible (días)</span>
                      <input style={input} type="number" min="1"
                        value={valor(f, "dias_visible") ?? ""} onChange={e => cambiar(f, "dias_visible", e.target.value)} />
                    </div>
                  )}
                  {f.clase === "pendiente" && (
                    <div style={{ fontSize: 11.5, color: "#64748b" }}>
                      Con plazo, la etiqueta cambia sola: «En N días» la última semana, «Mañana» el último día y
                      «Urgente» en rojo desde los días que indiques. Con 0 en «Rojo desde», es urgente desde el inicio.
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <span style={label}>Así la ve el tercero</span>
                  <Previa titulo={rellenar(valor(f, "titulo"))} detalle={rellenar(valor(f, "detalle"))}
                    estilo={valor(f, "estilo")} etiqueta={valor(f, "etiqueta")} />
                  <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
                    Con datos de ejemplo. Última edición: {f.editado_por || "—"}
                    {f.editado_at ? ` · ${new Date(f.editado_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                    <button disabled={!sucia(f) || guardando === f.tipo} onClick={() => guardar(f)} style={{
                      flex: 1, border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 700,
                      background: sucia(f) ? AZUL : "#cbd5e1", color: "#fff", cursor: sucia(f) ? "pointer" : "default",
                    }}>{guardando === f.tipo ? "Guardando…" : "Guardar cambios"}</button>
                    {sucia(f) && (
                      <button onClick={() => setEdit(p => { const n = { ...p }; delete n[f.tipo]; return n; })} style={{
                        border: `1px solid ${BORDE}`, background: "#fff", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#475569", cursor: "pointer",
                      }}>Descartar</button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Avisos puntuales ───────────────────────────────────────────────────────
const VACIO = { titulo: "", detalle: "", estilo: "azul", etiqueta: "Aviso", destino: "home", alcance: "todos", service_center: "", tercero_id: "", desde: "", hasta: "" };
const aLocal = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

function Avisos({ usuario }) {
  const [avisos, setAvisos] = useState(null);
  const [lecturas, setLecturas] = useState({});
  const [terceros, setTerceros] = useState([]);
  const [scs, setScs] = useState([]);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [verPasados, setVerPasados] = useState(false);

  const cargar = useCallback(async () => {
    const [a, l] = await Promise.all([
      sb.from("avisos_portal").select("*").order("desde", { ascending: false }).limit(200),
      sb.from("vw_avisos_portal_lecturas").select("*"),
    ]);
    setAvisos(a.data || []);
    const m = {}; for (const r of (l.data || [])) m[r.aviso_id] = r; setLecturas(m);
  }, []);

  useEffect(() => {
    cargar();
    (async () => {
      const [t, c] = await Promise.all([
        sb.from("terceros").select("id, nombre").order("nombre"),
        sb.from("conciliaciones_terceros").select("service_center").gte("semana", 39).limit(2000),
      ]);
      setTerceros(t.data || []);
      setScs([...new Set((c.data || []).map(r => r.service_center).filter(Boolean))].sort());
    })();
  }, [cargar]);

  const nombreTercero = useMemo(() => Object.fromEntries(terceros.map(t => [t.id, t.nombre])), [terceros]);
  const ahora = Date.now();
  const vigentes = (avisos || []).filter(a => a.activo && new Date(a.hasta).getTime() > ahora);
  const pasados = (avisos || []).filter(a => !(a.activo && new Date(a.hasta).getTime() > ahora));

  const nuevo = () => {
    const h = new Date(); h.setDate(h.getDate() + 7);
    setForm({ ...VACIO, desde: aLocal(new Date()), hasta: aLocal(h) });
    setMsg(null);
  };

  const guardar = async () => {
    const f = form;
    if (!f.titulo.trim()) return setMsg({ ok: false, txt: "Escribe el título del aviso." });
    if (f.alcance === "sc" && !f.service_center) return setMsg({ ok: false, txt: "Elige el centro." });
    if (f.alcance === "tercero" && !f.tercero_id) return setMsg({ ok: false, txt: "Elige la empresa." });
    if (!f.hasta || new Date(f.hasta) <= new Date(f.desde || Date.now())) return setMsg({ ok: false, txt: "La fecha de fin tiene que ser posterior al inicio." });
    setGuardando(true);
    const { error } = await sb.from("avisos_portal").insert({
      titulo: f.titulo.trim(), detalle: f.detalle.trim() || null, estilo: f.estilo, etiqueta: f.etiqueta.trim() || "Aviso",
      destino: f.destino, alcance: f.alcance,
      service_center: f.alcance === "sc" ? f.service_center : null,
      tercero_id: f.alcance === "tercero" ? f.tercero_id : null,
      desde: new Date(f.desde || Date.now()).toISOString(), hasta: new Date(f.hasta).toISOString(),
      creado_por: usuario?.email || usuario?.nombre || "brain",
    });
    setGuardando(false);
    if (error) return setMsg({ ok: false, txt: "No se pudo crear: " + error.message });
    setForm(null);
    setMsg({ ok: true, txt: "Aviso creado. Le aparece a cada tercero la próxima vez que abra su portal." });
    await cargar();
  };

  const apagar = async (a) => {
    if (!confirm(`¿Apagar el aviso "${a.titulo}"?\n\nDeja de mostrarse a los terceros que todavía no lo han visto y a los que lo tienen abierto.`)) return;
    const { error } = await sb.from("avisos_portal").update({ activo: false }).eq("id", a.id);
    if (error) return setMsg({ ok: false, txt: "No se pudo apagar: " + error.message });
    await cargar();
  };

  const alcanceTxt = (a) => a.alcance === "todos" ? "Todos los terceros"
    : a.alcance === "sc" ? `Centro ${a.service_center}` : (nombreTercero[a.tercero_id] || "Una empresa");
  const fecha = (d) => new Date(d).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const Fila = ({ a }) => {
    const l = lecturas[a.id];
    const e = ESTILOS[a.estilo] || ESTILOS.azul;
    return (
      <div style={{ background: "#fff", border: `1px solid ${BORDE}`, borderLeft: `4px solid ${e.borde}`, borderRadius: 10, padding: "11px 14px", marginBottom: 8,
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: AZUL }}>{a.titulo}</div>
          {a.detalle && <div style={{ fontSize: 12.5, color: "#475569", marginTop: 2 }}>{a.detalle}</div>}
          <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 4 }}>
            {alcanceTxt(a)} · {fecha(a.desde)} → {fecha(a.hasta)} · lleva a {nombreDestino(a.destino)} · {a.creado_por || "—"}
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: "#475569" }}>
          <div><b style={{ color: AZUL, fontSize: 15 }}>{l?.leidos || 0}</b> de {l?.enviados || 0} lo abrieron</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>cuenta solo a quienes ya entraron al portal</div>
        </div>
        {a.activo && new Date(a.hasta).getTime() > ahora && (
          <button onClick={() => apagar(a)} style={{ border: "1px solid #fca5a5", background: "#fff", color: "#991b1b", borderRadius: 7, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Apagar
          </button>
        )}
      </div>
    );
  };

  return (
    <div>
      {msg && (
        <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 7, fontSize: 13,
          background: msg.ok ? "#dcfce7" : "#fee2e2", color: msg.ok ? "#166534" : "#991b1b" }}>{msg.txt}</div>
      )}

      {!form ? (
        <button onClick={nuevo} style={{ border: "none", background: AZUL, color: "#fff", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>
          + Nuevo aviso
        </button>
      ) : (
        <div style={{ background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, padding: 14, marginBottom: 18,
          display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div><span style={label}>Título</span>
              <input style={input} value={form.titulo} maxLength={90} onChange={e => setForm({ ...form, titulo: e.target.value })} placeholder="El lunes 29 el SQR1 abre a las 8:00" /></div>
            <div><span style={label}>Detalle</span>
              <input style={input} value={form.detalle} maxLength={160} onChange={e => setForm({ ...form, detalle: e.target.value })} placeholder="Llega 15 minutos antes para la carga" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><span style={label}>Color</span>
                <select style={input} value={form.estilo} onChange={e => setForm({ ...form, estilo: e.target.value })}>
                  {Object.entries(ESTILOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select></div>
              <div><span style={label}>Etiqueta</span>
                <input style={input} value={form.etiqueta} maxLength={16} onChange={e => setForm({ ...form, etiqueta: e.target.value })} /></div>
            </div>
            <div><span style={label}>Lleva a</span>
              <select style={input} value={form.destino} onChange={e => setForm({ ...form, destino: e.target.value })}>
                {DESTINOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><span style={label}>A quién</span>
                <select style={input} value={form.alcance} onChange={e => setForm({ ...form, alcance: e.target.value })}>
                  <option value="todos">Todos los terceros</option>
                  <option value="sc">Un centro</option>
                  <option value="tercero">Una empresa</option>
                </select></div>
              {form.alcance === "sc" && (
                <div><span style={label}>Centro</span>
                  <select style={input} value={form.service_center} onChange={e => setForm({ ...form, service_center: e.target.value })}>
                    <option value="">Elige…</option>
                    {scs.map(s => <option key={s} value={s}>{s}</option>)}
                  </select></div>
              )}
              {form.alcance === "tercero" && (
                <div><span style={label}>Empresa</span>
                  <select style={input} value={form.tercero_id} onChange={e => setForm({ ...form, tercero_id: e.target.value })}>
                    <option value="">Elige…</option>
                    {terceros.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select></div>
              )}
            </div>
            {form.alcance === "sc" && (
              <div style={{ fontSize: 11.5, color: "#64748b" }}>Le llega a las empresas que operaron en ese centro en los últimos 30 días.</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><span style={label}>Desde</span>
                <input style={input} type="datetime-local" value={form.desde} onChange={e => setForm({ ...form, desde: e.target.value })} /></div>
              <div><span style={label}>Hasta</span>
                <input style={input} type="datetime-local" value={form.hasta} onChange={e => setForm({ ...form, hasta: e.target.value })} /></div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={label}>Así lo ve el tercero</span>
            <Previa titulo={form.titulo} detalle={form.detalle} estilo={form.estilo} etiqueta={form.etiqueta} />
            <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
              <button onClick={guardar} disabled={guardando} style={{ flex: 1, border: "none", background: AZUL, color: "#fff", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {guardando ? "Creando…" : "Crear aviso"}
              </button>
              <button onClick={() => setForm(null)} style={{ border: `1px solid ${BORDE}`, background: "#fff", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#475569", cursor: "pointer" }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: AZUL, margin: "4px 0 10px" }}>Vigentes ({vigentes.length})</div>
      {avisos === null ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Cargando…</div>
        : vigentes.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 12 }}>No hay avisos vigentes.</div>
        : vigentes.map(a => <Fila key={a.id} a={a} />)}

      {pasados.length > 0 && (
        <>
          <button onClick={() => setVerPasados(!verPasados)} style={{ border: "none", background: "none", color: "#64748b", fontSize: 12.5, cursor: "pointer", padding: "8px 0" }}>
            {verPasados ? "▲" : "▼"} Vencidos o apagados ({pasados.length})
          </button>
          {verPasados && pasados.map(a => <Fila key={a.id} a={a} />)}
        </>
      )}
    </div>
  );
}
