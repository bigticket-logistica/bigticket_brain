// ═══════════════════════════════════════════════════════════════════════════
// Referidos.jsx — Programa de referidos MX (pestaña madre del Brain).
//
//   Bonos       los premios que genera la base cada noche: validar, aprobar,
//               rechazar y marcar pagados.
//   Referidos   cada transportista referido y en qué etapa va.
//   Referidores quienes refieren, su código y su cuenta para pagarles.
//   Oportunidades en qué centros se buscan transportistas, cuántos vehículos y
//               de qué tipo. Se muestra en el portal de referidos y en la
//               postulación. Cada centro tiene su propuesta económica
//               (ref_propuestas), que el referido lee y acepta antes de dejar
//               sus datos; se edita aquí con el mismo formato de campañas.
//
// Lee de las vistas vw_ref_brain_* y cambia el estado de un bono con la
// función fn_ref_brain_premio (todo en Supabase, prefijo ref_).
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "./shared";

const AZUL = "#1a3a6b";
const NARANJA = "#F47B20";
const BORDE = "#e4e7ec";
const GRIS = "#667085";

const pesos = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });
const fecha = (v) => (v ? new Date(String(v).length <= 10 ? v + "T12:00:00" : v).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—");

const ETAPAS = {
  registrado: ["Registrado", "#f2f4f7", GRIS],
  en_revision: ["En revisión", "#fff4e5", "#b45309"],
  entrevista_alta: ["Solicitud de alta", "#eef2ff", AZUL],
  firma_contrato: ["Firma de contrato", "#eef2ff", AZUL],
  contrato_firmado: ["Contrato firmado", "#eef2ff", AZUL],
  primera_ruta: ["En ruta", "#e0f2fe", "#075985"],
  quince_rutas: ["Meta cumplida", "#dcfce7", "#166534"],
  sin_meta_30_dias: ["Sin meta 30 días", "#f2f4f7", GRIS],
  no_aprobado: ["No aprobado", "#fee2e2", "#b42318"],
};
const ESTADOS_BONO = {
  por_validar: ["Por validar", "#fff4e5", "#b45309"],
  aprobado: ["Aprobado", "#eef2ff", AZUL],
  pagado: ["Pagado", "#dcfce7", "#166534"],
  rechazado: ["Rechazado", "#fee2e2", "#b42318"],
};
const TRAMO = { firma_y_primera_ruta: "Primera ruta", quince_rutas_30_dias: "15 rutas en 30 días" };

function Pill({ par }) {
  const [t, bg, fg] = par;
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>{t}</span>;
}

export default function ModuloReferidos({ usuario }) {
  const [tab, setTab] = useState("bonos");
  const [bonos, setBonos] = useState([]);
  const [referidos, setReferidos] = useState([]);
  const [referidores, setReferidores] = useState([]);
  const [oportunidades, setOportunidades] = useState([]);
  const [centros, setCentros] = useState([]);
  const [propuestas, setPropuestas] = useState([]);
  const [canales, setCanales] = useState([]);   // fuentes de Bigticket sin referidor (camioneta, Facebook)
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    const [b, r, p, o, c, pr, ca] = await Promise.all([
      sb.from("vw_ref_brain_premios").select("*").order("cumplido_at", { ascending: false }),
      sb.from("vw_ref_brain_referidos").select("*").order("creado_at", { ascending: false }),
      sb.from("vw_ref_brain_referidores").select("*").order("creado_at", { ascending: false }),
      sb.from("ref_oportunidades").select("*").order("sc"),
      sb.from("centros_mx").select("sc, nombre").eq("activo", true).order("nombre"),
      sb.from("ref_propuestas").select("*"),
      sb.from("ref_canales").select("*").order("creado_at"),
    ]);
    // Si ref_canales no se puede leer, la pestaña sigue funcionando sin las filas de canal.
    const err = b.error || r.error || p.error || o.error || c.error || pr.error;
    if (err) setError(err.message);
    setBonos(b.data || []); setReferidos(r.data || []); setReferidores(p.data || []);
    setOportunidades(o.data || []); setCentros(c.data || []); setPropuestas(pr.data || []); setCanales(ca.data || []);
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const porValidar = bonos.filter((x) => x.estado === "por_validar").length;
  const vacantes = oportunidades.filter((x) => x.activa && x.cantidad > 0).reduce((t, x) => t + x.cantidad, 0);
  const TABS = [["bonos", "Bonos", porValidar], ["referidos", "Referidos", referidos.length], ["referidores", "Referidores", referidores.length + canales.length], ["oportunidades", "Oportunidades", vacantes]];

  return (
    <div className="pg">
      <div className="sec-title">Referidos</div>
      <div className="sec-sub">Programa de referidos MX: $500 por contrato firmado y primera ruta, y $1,500 por 15 rutas en 30 días.</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(([k, t, n]) => (
          <button key={k} onClick={() => setTab(k)} className={`nav-btn${tab === k ? " active" : ""}`} style={{ border: `0.5px solid ${BORDE}` }}>
            {t} {n > 0 && <span style={{ marginLeft: 6, background: k === "bonos" ? NARANJA : "#e4e7ec", color: k === "bonos" ? "#fff" : AZUL, borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{n}</span>}
          </button>
        ))}
        <button onClick={cargar} className="btn-back" style={{ marginLeft: "auto" }}>↻ Actualizar</button>
      </div>
      {error && <div className="form-card" style={{ color: "#b42318" }}>No se pudo cargar: {error}</div>}
      {cargando ? <div className="loading">Cargando…</div> : (
        <>
          {tab === "bonos" && <Bonos bonos={bonos} usuario={usuario} onCambio={cargar} />}
          {tab === "referidos" && <Referidos referidos={referidos} canales={canales} />}
          {tab === "referidores" && <Referidores referidores={referidores} canales={canales} referidos={referidos} />}
          {tab === "oportunidades" && <Oportunidades lista={oportunidades} centros={centros} propuestas={propuestas} usuario={usuario} onCambio={cargar} />}
        </>
      )}
    </div>
  );
}

// ── Bonos ───────────────────────────────────────────────────────────────────
function Bonos({ bonos, usuario, onCambio }) {
  const [filtro, setFiltro] = useState("por_validar");
  const [busy, setBusy] = useState(null);
  const lista = filtro === "todos" ? bonos : bonos.filter((b) => b.estado === filtro);
  const suma = (est) => bonos.filter((b) => b.estado === est).reduce((t, b) => t + Number(b.monto || 0), 0);

  const cambiar = async (b, estado) => {
    let referencia = null, nota = null;
    if (estado === "pagado") {
      if (!b.clabe) { alert("Este referidor todavía no registra su CLABE. Pídele que la registre en su portal antes de pagar."); return; }
      referencia = prompt(`Referencia del pago de ${pesos(b.monto)} a ${b.titular || b.referidor} (por ejemplo, la clave de rastreo SPEI):`);
      if (!referencia) return;
    }
    if (estado === "rechazado") {
      nota = prompt("¿Por qué no procede este bono? El motivo queda registrado.");
      if (!nota) return;
    }
    if (estado === "aprobado" && !confirm(`¿Aprobar el bono de ${pesos(b.monto)} para ${b.referidor}?`)) return;
    setBusy(b.id);
    const { error } = await sb.rpc("fn_ref_brain_premio", { p_id: b.id, p_estado: estado, p_referencia: referencia, p_nota: nota, p_por: usuario?.email || usuario?.nombre || "brain" });
    setBusy(null);
    if (error) { alert("No se pudo guardar: " + error.message); return; }
    onCambio();
  };

  return (
    <>
      <div className="three-col" style={{ marginBottom: 16 }}>
        <Cifra t="Por validar" v={pesos(suma("por_validar"))} c="#b45309" />
        <Cifra t="Aprobados, por pagar" v={pesos(suma("aprobado"))} c={AZUL} />
        <Cifra t="Pagados" v={pesos(suma("pagado"))} c="#166534" />
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[["por_validar", "Por validar"], ["aprobado", "Aprobados"], ["pagado", "Pagados"], ["rechazado", "Rechazados"], ["todos", "Todos"]].map(([k, t]) => (
          <button key={k} onClick={() => setFiltro(k)} className={`nav-btn${filtro === k ? " active" : ""}`}>{t}</button>
        ))}
      </div>
      {lista.length === 0 ? <div className="empty">No hay bonos en este estado.</div> : (
        <div className="form-card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={tabla}>
            <thead><tr>{["Ganado", "Referidor", "Referido", "Meta", "Monto", "Cuenta para pagar", "Estado", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {lista.map((b) => (
                <tr key={b.id} style={{ borderTop: `0.5px solid ${BORDE}` }}>
                  <td style={td}>{fecha(b.cumplido_at)}</td>
                  <td style={td}><b>{b.referidor}</b><div style={sub}>{b.codigo} · {b.referidor_telefono}</div></td>
                  <td style={td}><b>{b.razon_social || b.referido}</b><div style={sub}>RFC {b.rfc}</div></td>
                  <td style={td}>{TRAMO[b.tramo] || b.tramo}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{pesos(b.monto)}</td>
                  <td style={td}>{b.clabe ? <><b>{b.banco || "—"}</b><div style={sub}>{b.titular} · CLABE {b.clabe}</div></> : <span style={{ color: "#b42318", fontSize: 12 }}>Sin CLABE registrada</span>}</td>
                  <td style={td}><Pill par={ESTADOS_BONO[b.estado] || ESTADOS_BONO.por_validar} />
                    {b.pago_referencia && <div style={sub}>Ref. {b.pago_referencia} · {fecha(b.pagado_at)}</div>}
                    {b.nota && <div style={sub}>{b.nota}</div>}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {b.estado === "por_validar" && <>
                      <button className="btn-blue" style={btnChico} disabled={busy === b.id} onClick={() => cambiar(b, "aprobado")}>Aprobar</button>{" "}
                      <button className="btn-back" style={{ color: "#b42318" }} disabled={busy === b.id} onClick={() => cambiar(b, "rechazado")}>Rechazar</button>
                    </>}
                    {b.estado === "aprobado" && <button className="btn-orange" style={btnChico} disabled={busy === b.id} onClick={() => cambiar(b, "pagado")}>Marcar pagado</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Cifra({ t, v, c }) {
  return (
    <div className="form-card" style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 12, color: GRIS }}>{t}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: c, marginTop: 4 }}>{v}</div>
    </div>
  );
}

// ── Referidos ───────────────────────────────────────────────────────────────
function Referidos({ referidos, canales = [] }) {
  const canalDe = (c) => (canales.find((x) => x.codigo === c) || {}).nombre || c;
  const [q, setQ] = useState("");
  const [etapa, setEtapa] = useState("");
  const lista = useMemo(() => referidos.filter((r) => {
    const t = `${r.nombre} ${r.razon_social || ""} ${r.rfc} ${r.referidor} ${r.codigo} ${r.canal || ""}`.toLowerCase();
    return (!q || t.includes(q.toLowerCase())) && (!etapa || r.etapa === etapa);
  }), [referidos, q, etapa]);

  return (
    <>
      <div className="two-col" style={{ marginBottom: 12 }}>
        <input placeholder="Buscar por nombre, RFC, referidor o código…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={etapa} onChange={(e) => setEtapa(e.target.value)}>
          <option value="">Todas las etapas</option>
          {Object.entries(ETAPAS).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </div>
      {lista.length === 0 ? <div className="empty">No hay referidos con esos filtros.</div> : (
        <div className="form-card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={tabla}>
            <thead><tr>{["Registrado", "Referido", "Referidor", "Etapa", "Contrato", "Primera ruta", "Rutas 30 días"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.referido_id} style={{ borderTop: `0.5px solid ${BORDE}` }}>
                  <td style={td}>{fecha(r.creado_at)}</td>
                  <td style={td}><b>{r.razon_social || r.nombre}</b><div style={sub}>{r.tipo === "persona_moral" ? "Persona moral" : "Persona física"} · RFC {r.rfc}</div></td>
                  <td style={td}>{r.canal ? <>{canalDe(r.canal)}<div style={sub}>Canal Bigticket</div></> : <>{r.referidor}<div style={sub}>{r.codigo}</div></>}</td>
                  <td style={td}><Pill par={ETAPAS[r.etapa] || ETAPAS.registrado} /></td>
                  <td style={td}>{fecha(r.firmado_at)}</td>
                  <td style={td}>{fecha(r.primera_ruta)}</td>
                  <td style={td}>{r.primera_ruta ? `${r.rutas_30} de 15` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Referidores ─────────────────────────────────────────────────────────────
// Los canales de Bigticket (camioneta, Facebook) se muestran como un referidor
// más, para ver cuántos referidos nacen de cada fuente. No generan bonos.
const FIRMADO = ["contrato_firmado", "primera_ruta", "quince_rutas", "sin_meta_30_dias"];
const EN_RUTA = ["primera_ruta", "quince_rutas", "sin_meta_30_dias"];

function Referidores({ referidores, canales = [], referidos = [] }) {
  const [q, setQ] = useState("");
  const lista = referidores.filter((r) => !q || `${r.nombre} ${r.codigo} ${r.correo} ${r.telefono} ${r.curp}`.toLowerCase().includes(q.toLowerCase()));
  const deCanal = (c) => referidos.filter((r) => r.canal === c);
  const listaCanales = canales.filter((c) => !q || `${c.nombre} ${c.codigo}`.toLowerCase().includes(q.toLowerCase()));
  const fuentes = [
    ["Referidores", referidos.filter((r) => !r.canal).length],
    ...canales.map((c) => [c.nombre, deCanal(c.codigo).length]),
  ];
  const totalRef = referidos.length || 1;
  return (
    <>
      <div className="form-card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: GRIS, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>Referidos por fuente</span>
        {fuentes.map(([n, k]) => (
          <span key={n} style={{ background: "#f8f9fb", border: `0.5px solid ${BORDE}`, borderRadius: 20, padding: "5px 12px", fontSize: 13 }}>
            {n}: <b style={{ color: AZUL }}>{k}</b> <span style={{ color: GRIS }}>({Math.round((k * 100) / totalRef)}%)</span>
          </span>
        ))}
      </div>
      <input placeholder="Buscar por nombre, código, correo, teléfono o CURP…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {lista.length + listaCanales.length === 0 ? <div className="empty">No hay referidores con esa búsqueda.</div> : (
        <div className="form-card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={tabla}>
            <thead><tr>{["Inscrito", "Referidor", "Código", "Contacto", "Cuenta", "Referidos", "Ganado", "Pagado"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {listaCanales.map((c) => {
                const rs = deCanal(c.codigo);
                return (
                  <tr key={"canal-" + c.codigo} style={{ borderTop: `0.5px solid ${BORDE}`, background: "#f5f8ff" }}>
                    <td style={td}>{fecha(c.creado_at)}</td>
                    <td style={td}><b>{c.nombre}</b><div style={sub}>Canal Bigticket{c.activo ? "" : " · inactivo"}</div></td>
                    <td style={{ ...td, fontWeight: 700 }}>/c/{c.codigo}</td>
                    <td style={td}><span style={sub}>referidos.fleetbiggy.com/c/{c.codigo}</span></td>
                    <td style={td}><span style={{ color: GRIS, fontSize: 12 }}>No genera bonos</span></td>
                    <td style={td}>{rs.length}<div style={sub}>{rs.filter((r) => FIRMADO.includes(r.etapa)).length} firmados · {rs.filter((r) => EN_RUTA.includes(r.etapa)).length} en ruta</div></td>
                    <td style={td}>—</td>
                    <td style={td}>—</td>
                  </tr>
                );
              })}
              {lista.map((r) => (
                <tr key={r.id} style={{ borderTop: `0.5px solid ${BORDE}` }}>
                  <td style={td}>{fecha(r.creado_at)}</td>
                  <td style={td}><b>{r.nombre}</b><div style={sub}>CURP {r.curp}{r.es_chofer_bt ? " · chofer BT" : ""}{r.tercero_id ? " · empresa BT" : ""}</div></td>
                  <td style={{ ...td, fontWeight: 700 }}>{r.codigo}</td>
                  <td style={td}>{r.telefono}<div style={sub}>{r.correo}</div></td>
                  <td style={td}>{r.clabe ? <>{r.banco || "—"}<div style={sub}>{r.titular} · {r.clabe}</div></> : <span style={{ color: GRIS, fontSize: 12 }}>Sin CLABE</span>}</td>
                  <td style={td}>{r.n_referidos}</td>
                  <td style={td}>{pesos(r.ganado)}</td>
                  <td style={td}>{pesos(r.pagado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Oportunidades ───────────────────────────────────────────────────────────
// Por cada centro y tipo de vehículo, cuántos se buscan. Lo activo y con
// cantidad mayor a cero aparece en el portal de referidos y en la postulación.
// Sugerencias para el tipo de vehículo; se puede escribir cualquier otro.
const TIPOS_SUGERIDOS = ["Small Van", "Large Van", "Auto", "Moto", "Camioneta pickup", "Camión 3.5 t"];

function Oportunidades({ lista, centros, propuestas, usuario, onCambio }) {
  const [editando, setEditando] = useState(null);   // propuesta en edición
  const [viendo, setViendo] = useState(null);       // propuesta en vista previa
  // Una oportunidad nueva puede traer varios tipos de vehículo a la vez (una fila por tipo).
  const NUEVO = () => ({ sc: "", filas: [{ tipo: "Small Van", cantidad: 1, tarifa: "" }], nota: "" });
  const [nuevo, setNuevo] = useState(NUEVO);
  const setFila = (i, k, v) => setNuevo((n) => ({ ...n, filas: n.filas.map((f, j) => (j === i ? { ...f, [k]: v } : f)) }));
  const otraFila = () => setNuevo((n) => ({ ...n, filas: [...n.filas, { tipo: "", cantidad: 1, tarifa: "" }] }));
  const quitarFila = (i) => setNuevo((n) => ({ ...n, filas: n.filas.filter((_, j) => j !== i) }));
  const [busy, setBusy] = useState(false);
  const nombreDe = (sc) => (centros.find((c) => c.sc === sc) || {}).nombre || sc;
  const tipos = [...new Set([...TIPOS_SUGERIDOS, ...lista.map((x) => x.tipo_vehiculo)])];
  const por = usuario?.email || usuario?.nombre || "brain";

  const guardar = async (sc, tipo, cantidad, activa, nota, tarifa, recargar = true) => {
    setBusy(true);
    const t = tarifa === "" || tarifa == null ? null : Number(tarifa);
    const { error } = await sb.rpc("fn_ref_oportunidad_guardar", { p_sc: sc, p_tipo: tipo, p_cantidad: Number(cantidad) || 0, p_activa: activa, p_nota: nota || null, p_tarifa: t, p_por: por });
    setBusy(false);
    if (error) { alert(`No se pudo guardar ${tipo}: ` + error.message); return false; }
    if (recargar) onCambio();
    return true;
  };
  const borrar = async (o) => {
    if (!confirm(`¿Quitar la oportunidad de ${o.tipo_vehiculo} en ${nombreDe(o.sc)}?`)) return;
    setBusy(true);
    const { error } = await sb.rpc("fn_ref_oportunidad_borrar", { p_id: o.id });
    setBusy(false);
    if (error) { alert("No se pudo quitar: " + error.message); return; }
    onCambio();
  };
  const agregar = async () => {
    if (!nuevo.sc) { alert("Elige el centro."); return; }
    const filas = nuevo.filas.map((f) => ({ ...f, tipo: f.tipo.trim() }));
    for (const [i, f] of filas.entries()) {
      const n = filas.length > 1 ? ` (fila ${i + 1})` : "";
      if (f.tipo.length < 2) { alert("Escribe el tipo de vehículo" + n + "."); return; }
      if (!(Number(f.cantidad) > 0)) { alert("Escribe cuántos vehículos se buscan" + n + "."); return; }
      if (!(Number(f.tarifa) > 0)) { alert("Escribe la tarifa por viaje" + n + "."); return; }
    }
    if (new Set(filas.map((f) => f.tipo.toLowerCase())).size !== filas.length) { alert("Hay un tipo de vehículo repetido."); return; }
    let ok = true;
    for (const f of filas) ok = (await guardar(nuevo.sc, f.tipo, f.cantidad, true, nuevo.nota, f.tarifa, false)) && ok;
    onCambio();
    if (ok) setNuevo(NUEVO());
  };

  const total = lista.filter((x) => x.activa && x.cantidad > 0).reduce((t, x) => t + x.cantidad, 0);
  const porCentro = lista.reduce((m, o) => { (m[o.sc] = m[o.sc] || []).push(o); return m; }, {});

  // Propuesta del centro: si no existe se parte vacía, con una fila de tarifas
  // por cada tipo de vehículo que se busca en ese centro.
  const propuestaDe = (sc) => propuestas.find((p) => p.sc === sc);
  // Tipos que están en la tabla de tarifas de la propuesta pero no como oportunidad.
  // El portal también los ofrece (con la tarifa de 0-100 km), así que aquí se muestran.
  const numero = (v) => Number(String(v ?? "").replace(/\D/g, "")) || "";
  const soloPropuesta = (sc) => ((propuestaDe(sc) || {}).tarifas || [])
    .filter((t) => (t.categoria || "").trim() && !(porCentro[sc] || []).some((o) => o.tipo_vehiculo.toLowerCase() === t.categoria.trim().toLowerCase()))
    .map((t) => ({ sc, tipo_vehiculo: t.categoria.trim(), tarifa: numero(t.tramos?.["0-100"]) }));
  const abrirPropuesta = (sc) => {
    const p = propuestaDe(sc) || { sc, tarifas: [], semana_retenida: false };
    const tarifas = [...(p.tarifas || [])];
    for (const t of [...new Set((porCentro[sc] || []).map((o) => o.tipo_vehiculo))])
      if (!tarifas.some((x) => x.categoria === t)) tarifas.push({ categoria: t, tramos: Object.fromEntries(TRAMOS.map((k) => [k, ""])) });
    setEditando({ ...p, tarifas, nombre: `${nombreDe(sc)} (${sc})` });
  };
  const guardarPropuesta = async () => {
    const e = editando;
    if (!(e.cedis || "").trim()) { alert("Escribe el CEDIS."); return; }
    if ((e.tarifas || []).some((t) => !(t.categoria || "").trim())) { alert("Escribe el tipo de vehículo de cada fila de tarifas, o quita la fila vacía."); return; }
    if (!(e.tarifas || []).some((t) => Object.values(t.tramos || {}).some((v) => String(v).trim()))) { alert("Escribe al menos una tarifa por jornada."); return; }
    setBusy(true);
    const { nombre, sc, actualizado_at, actualizado_por, ...datos } = e;
    const { error } = await sb.rpc("fn_ref_propuesta_guardar", { p_sc: sc, p_datos: datos, p_por: por });
    setBusy(false);
    if (error) { alert("No se pudo guardar la propuesta: " + error.message); return; }
    setEditando(null); onCambio();
  };

  return (
    <>
      <div className="form-card">
        <div style={{ fontWeight: 700, color: AZUL, marginBottom: 4 }}>Agregar una oportunidad</div>
        <div style={{ fontSize: 12.5, color: GRIS, marginBottom: 12 }}>
          Lo que esté activo y con cantidad aparece en el portal de referidos y en la postulación, con su tarifa por viaje y el comentario: el referido solo puede elegir estos centros y estos tipos de vehículo. Si el centro y el tipo ya existen, se actualizan sus datos.
        </div>
        <label style={{ ...lbl, maxWidth: 420 }}>Centro
          <select value={nuevo.sc} onChange={(e) => setNuevo({ ...nuevo, sc: e.target.value })}>
            <option value="">Elige un centro</option>
            {centros.map((c) => <option key={c.sc} value={c.sc}>{c.nombre} ({c.sc})</option>)}
          </select>
        </label>
        <datalist id="ref-tipos-vehiculo">{tipos.map((t) => <option key={t} value={t} />)}</datalist>
        {nuevo.filas.map((f, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 1fr 36px", gap: 10, alignItems: "end", marginTop: 10 }}>
            <label style={lbl}>Tipo de vehículo
              {/* Lista con sugerencias, pero se puede escribir un tipo nuevo. */}
              <input list="ref-tipos-vehiculo" value={f.tipo} placeholder="Elige o escribe" onChange={(e) => setFila(i, "tipo", e.target.value)} />
            </label>
            <label style={lbl}>Cantidad
              <input type="number" min="1" value={f.cantidad} onChange={(e) => setFila(i, "cantidad", e.target.value)} />
            </label>
            <label style={lbl}>Tarifa por viaje (MXN)
              <input type="number" min="0" step="1" placeholder="Ej. 1800" value={f.tarifa} onChange={(e) => setFila(i, "tarifa", e.target.value)} />
            </label>
            {nuevo.filas.length > 1
              ? <button className="btn-back" title="Quitar este tipo" style={{ color: "#b42318", padding: "8px 0" }} onClick={() => quitarFila(i)}>✕</button>
              : <span />}
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
          <button className="btn-back" onClick={otraFila}>＋ Otro tipo de vehículo</button>
          <button className="btn-orange" disabled={busy} onClick={agregar} style={{ marginLeft: "auto" }}>
            Agregar{nuevo.filas.length > 1 ? ` ${nuevo.filas.length} tipos` : ""}
          </button>
        </div>
        <label style={{ ...lbl, marginTop: 10 }}>Comentario para más información (opcional)
          <textarea rows={2} placeholder="Por ejemplo: turno de mañana, salida a las 7:00, se paga semanal." value={nuevo.nota}
            onChange={(e) => setNuevo({ ...nuevo, nota: e.target.value })} style={{ resize: "vertical" }} />
        </label>
      </div>

      <div style={{ fontSize: 13, color: GRIS, margin: "4px 2px 10px" }}>
        Hoy se buscan <b style={{ color: AZUL }}>{total} {total === 1 ? "vehículo" : "vehículos"}</b> en total.
      </div>

      {lista.length === 0 ? <div className="empty">Todavía no hay oportunidades. Agrega la primera arriba.</div> : (
        <div className="form-card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={tabla}>
            <thead><tr>{["Centro", "Tipo de vehículo", "Cantidad", "Tarifa por viaje", "Comentario", "En el portal", "Actualizado", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {Object.entries(porCentro).map(([sc, filas]) => {
                const celda = (

                    <>
                      {nombreDe(sc)} ({sc})
                      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                        {propuestaDe(sc)
                          ? <span style={{ fontSize: 11, fontWeight: 700, color: "#166534" }}>✓ Con propuesta</span>
                          : <span style={{ fontSize: 11, fontWeight: 700, color: "#b42318" }}>Sin propuesta: no se puede postular</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button className="btn-blue" style={btnChico} onClick={() => abrirPropuesta(sc)}>📄 {propuestaDe(sc) ? "Editar propuesta" : "Crear propuesta"}</button>
                        {propuestaDe(sc) && <button className="btn-back" style={btnChico} onClick={() => setViendo(propuestaDe(sc))}>👁 Ver</button>}
                      </div>
                    </>
                  
                );
                return [
                  ...filas.map((o, i) => (
                    <FilaOportunidad key={o.id} o={o} busy={busy} onGuardar={guardar} onBorrar={borrar} centro={i === 0 ? celda : ""} />
                  )),
                  ...soloPropuesta(sc).map((t) => (
                    <FilaSoloPropuesta key={sc + t.tipo_vehiculo} t={t} busy={busy} onGuardar={guardar} />
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {viendo && <PropuestaVista p={viendo} onCerrar={() => setViendo(null)} />}
      {editando && <PropuestaEditor e={editando} setE={setEditando} busy={busy} onGuardar={guardarPropuesta}
        onVer={() => setViendo(editando)} onCerrar={() => setEditando(null)} />}
    </>
  );
}

// Tipo que solo está en la propuesta: se ve y se puede pasar a oportunidad con su cantidad.
function FilaSoloPropuesta({ t, busy, onGuardar }) {
  const [cantidad, setCantidad] = useState("");
  const [tarifa, setTarifa] = useState(t.tarifa);
  const [nota, setNota] = useState("");
  const agregar = () => {
    if (!(Number(cantidad) > 0)) { alert("Escribe cuántos vehículos se buscan."); return; }
    if (!(Number(tarifa) > 0)) { alert("Escribe la tarifa por viaje."); return; }
    onGuardar(t.sc, t.tipo_vehiculo, cantidad, true, nota, tarifa);
  };
  return (
    <tr style={{ borderTop: `0.5px solid ${BORDE}`, background: "#fffaf5" }}>
      <td style={td} />
      <td style={td}>{t.tipo_vehiculo}</td>
      <td style={td}><input type="number" min="0" placeholder="—" value={cantidad} onChange={(e) => setCantidad(e.target.value)} style={{ width: 80 }} /></td>
      <td style={td}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>$<input type="number" min="0" value={tarifa} onChange={(e) => setTarifa(e.target.value)} style={{ width: 90 }} /></div>
        <div style={sub}>Tarifa 0-100 km de la propuesta</div>
      </td>
      <td style={td}><textarea rows={1} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="—" style={{ minWidth: 180, resize: "vertical" }} /></td>
      <td style={td}><span style={{ color: "#b45309", fontWeight: 700, fontSize: 12.5 }}>Se muestra<br />(desde la propuesta)</span></td>
      <td style={td}><span style={sub}>Sin cantidad</span></td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <button className="btn-blue" style={btnChico} disabled={busy} onClick={agregar}>Agregar como oportunidad</button>
      </td>
    </tr>
  );
}

function FilaOportunidad({ o, centro, busy, onGuardar, onBorrar }) {
  const [cantidad, setCantidad] = useState(o.cantidad);
  const [tarifa, setTarifa] = useState(o.tarifa ?? "");
  const [nota, setNota] = useState(o.nota || "");
  const cambio = Number(cantidad) !== o.cantidad || (nota || "") !== (o.nota || "")
    || String(tarifa ?? "") !== String(o.tarifa ?? "");
  const visible = o.activa && o.cantidad > 0;
  return (
    <tr style={{ borderTop: `0.5px solid ${BORDE}` }}>
      <td style={{ ...td, fontWeight: 700 }}>{centro}</td>
      <td style={td}>{o.tipo_vehiculo}</td>
      <td style={td}><input type="number" min="0" value={cantidad} onChange={(e) => setCantidad(e.target.value)} style={{ width: 80 }} /></td>
      <td style={td}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>$<input type="number" min="0" value={tarifa} onChange={(e) => setTarifa(e.target.value)} style={{ width: 90 }} /></div>
      </td>
      <td style={td}><textarea rows={1} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="—" style={{ minWidth: 180, resize: "vertical" }} /></td>
      <td style={td}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={o.activa} disabled={busy} onChange={(e) => onGuardar(o.sc, o.tipo_vehiculo, o.cantidad, e.target.checked, o.nota, o.tarifa)} />
          {visible ? <span style={{ color: "#166534", fontWeight: 700 }}>Se muestra</span> : <span style={{ color: GRIS }}>Oculta</span>}
        </label>
      </td>
      <td style={td}>{fecha(o.actualizado_at)}<div style={sub}>{o.actualizado_por || ""}</div></td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {cambio && <button className="btn-blue" style={btnChico} disabled={busy} onClick={() => onGuardar(o.sc, o.tipo_vehiculo, cantidad, o.activa, nota, tarifa)}>Guardar</button>}{" "}
        <button className="btn-back" style={{ color: "#b42318" }} disabled={busy} onClick={() => onBorrar(o)}>Quitar</button>
      </td>
    </tr>
  );
}

const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: GRIS, fontWeight: 600 };
const tabla = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th = { textAlign: "left", padding: "10px 12px", fontSize: 11, color: GRIS, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", background: "#f8f9fb", whiteSpace: "nowrap" };
const td = { padding: "10px 12px", verticalAlign: "top" };
const sub = { fontSize: 11.5, color: GRIS, marginTop: 2 };
const btnChico = { padding: "6px 12px", fontSize: 12 };

// ── Propuesta económica por centro ─────────────────────────────────────────
// Mismo formato que la propuesta de campañas (bigticket-portal): el editor y la
// "Vista del conductor". La vista es la misma que ve el referido en el portal.
const TRAMOS = ["0-100", "101-150", "151-200", "201-250", "251+"];

function PropuestaVista({ p, onCerrar }) {
  const titulo = (t) => (
    <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 4, height: 18, background: "#F47B20", borderRadius: 2 }} />{t}
    </div>
  );
  const check = (items) => (
    <div style={{ fontSize: 13, color: "#444", display: "flex", flexDirection: "column", gap: 8 }}>
      {items.filter(Boolean).map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ color: "#27ae60", fontWeight: 700, flexShrink: 0 }}>✓</span><span>{item}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 210, overflowY: "auto", padding: "20px 16px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ background: "#002f5d", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <img src="https://psvdtgjvognbmxfvqbaa.supabase.co/storage/v1/object/public/assets/LOGO%20ENCUESTA%20Y%20PROPUESTA.png" alt="Bigticket" style={{ height: 34, objectFit: "contain" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Vista del Conductor</span>
            <button onClick={onCerrar} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", fontSize: 18 }}>×</button>
          </div>
        </div>
        <div style={{ overflowY: "auto", maxHeight: "75vh" }}>
          <div style={{ padding: "24px 24px 16px" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#1a1a1a", marginBottom: 6 }}>Propuesta Económica</div>
            <div style={{ width: 48, height: 3, background: "#F47B20", borderRadius: 2 }} />
          </div>
          <div style={{ padding: "0 24px 20px" }}>
            {titulo("Condiciones Generales de la Operación")}
            <div style={{ background: "#f8f9fa", borderRadius: 10, padding: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, border: "0.5px solid #e4e7ec" }}>
              {[["📍", "Dirección CEDIS", p.cedis], ["🕐", "Horario", p.horario], ["📦", "Entregas estimadas", p.entregas], ["🗓", "Devolución", p.devolucion]].map(([ic, l, v]) => v && (
                <div key={l}>
                  <div style={{ fontSize: 10, color: "#1a1a1a", fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>{ic} {l}</div>
                  <div style={{ fontSize: 13, fontWeight: 400, color: "#1a1a1a" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
          {p.tarifas?.length > 0 && (
            <div style={{ padding: "0 24px 20px" }}>
              {titulo("Tarifas por Jornada")}
              <div style={{ overflowX: "auto", borderRadius: 10, border: "0.5px solid #e4e7ec" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "#1a3a6b", color: "#fff" }}>
                    <th style={{ padding: "9px 12px", textAlign: "left" }}>Categoría</th>
                    {TRAMOS.map((t) => <th key={t} style={{ padding: "9px 8px", textAlign: "center" }}>{t} km</th>)}
                  </tr></thead>
                  <tbody>
                    {p.tarifas.map((t, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#f8f9fa" : "#fff", borderBottom: "0.5px solid #e4e7ec" }}>
                        <td style={{ padding: "9px 12px", fontWeight: 700, color: "#1a1a1a" }}>{t.categoria}</td>
                        {TRAMOS.map((k) => <td key={k} style={{ padding: "9px 8px", textAlign: "center", fontWeight: 600, color: "#1a1a1a" }}>{t.tramos?.[k] ? `$ ${t.tramos[k]}` : "—"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>*Valores netos + IVA{p.auxiliar ? ` | Auxiliar: ${p.auxiliar}` : ""}</div>
            </div>
          )}
          <div style={{ padding: "0 24px 20px" }}>
            {titulo("Nivel de Servicio")}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div style={{ background: "#f0f2f5", borderRadius: 10, padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Mínimo exigido</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#1a3a6b" }}>{p.ns_minimo || "99.00%"}</div>
              </div>
              <div style={{ background: "#f0fdf4", borderRadius: 10, padding: "14px", textAlign: "center", border: "1.5px solid #86efac" }}>
                <div style={{ fontSize: 10, color: "#166534", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Excelente 🏆</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#166534" }}>{p.ns_excelente}</div>
                <div style={{ fontSize: 11, color: "#166534", marginTop: 4 }}>Premio: {p.ns_premio}</div>
              </div>
            </div>
            <div style={{ background: "#fffbeb", borderRadius: 10, padding: "12px 16px", border: "1px solid #fde68a", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: "#F47B20", flexShrink: 0 }}>⚠️</span>
              <div style={{ fontSize: 12, color: "#92400e" }}><strong>Castigo:</strong> {p.ns_castigo}</div>
            </div>
          </div>
          <div style={{ padding: "0 24px 20px" }}>
            {titulo("Condiciones de Pago")}
            {check(["Pago semanal cada viernes", "Transferencia bancaria, previa emisión de CFDI",
              p.semana_retenida ? "Semana retenida al inicio como garantía" : null,
              `Vigencia del contrato: ${p.vigencia || "12 meses"} condicionado al cumplimiento de los niveles de servicio.`])}
          </div>
          {p.requisitos && (
            <div style={{ padding: "0 24px 20px" }}>
              {titulo("Requisitos del Prestador")}
              {check(p.requisitos.split("\n").filter(Boolean))}
            </div>
          )}
          {p.notas && (
            <div style={{ padding: "0 24px 20px" }}>
              <div style={{ background: "#f0f9ff", borderRadius: 10, padding: "12px 16px", border: "1px solid #bae6fd", fontSize: 12, color: "#0369a1" }}>
                <strong>📌 Nota:</strong> {p.notas}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: "12px 24px", borderTop: "1px solid #e4e7ec", background: "#f8f9fa" }}>
          <button onClick={onCerrar} className="btn-blue" style={{ width: "100%" }}>Cerrar preview</button>
        </div>
      </div>
    </div>
  );
}

function PropuestaEditor({ e, setE, busy, onGuardar, onVer, onCerrar }) {
  const upd = (k, v) => setE((p) => ({ ...p, [k]: v }));
  const updCategoria = (ci, v) => setE((p) => ({ ...p, tarifas: p.tarifas.map((t, j) => (j === ci ? { ...t, categoria: v } : t)) }));
  const otraCategoria = () => setE((p) => ({ ...p, tarifas: [...(p.tarifas || []), { categoria: "", tramos: Object.fromEntries(TRAMOS.map((k) => [k, ""])) }] }));
  const quitarCategoria = (ci) => setE((p) => ({ ...p, tarifas: p.tarifas.filter((_, j) => j !== ci) }));
  const updTarifa = (ci, tramo, val) => setE((p) => {
    const t = [...p.tarifas];
    t[ci] = { ...t[ci], tramos: { ...t[ci].tramos, [tramo]: val } };
    return { ...p, tarifas: t };
  });
  const campo = (k, label, ph) => (
    <div className="field-row"><span className="field-label">{label}</span><input value={e[k] || ""} onChange={(x) => upd(k, x.target.value)} placeholder={ph} /></div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, overflowY: "auto", padding: "20px 16px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ background: "#002f5d", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "#F47B20", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Editar propuesta económica</div>
            <div style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginTop: 2 }}>{e.nombre}</div>
          </div>
          <button onClick={onCerrar} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 18 }}>×</button>
        </div>
        <div style={{ padding: "20px 24px", overflowY: "auto", maxHeight: "70vh", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="two-col">{campo("cliente", "Cliente / Operación", "Ej: MELI Querétaro")}{campo("cedis", "CEDIS *", "Ej: SQR1 | Av. Zaragoza 61")}</div>
          <div className="two-col">{campo("horario", "Horario de presentación", "Por confirmar")}{campo("entregas", "Entregas estimadas", "80-100")}</div>
          {campo("devolucion", "Devolución de mercancía no entregada", "Mismo SVC hasta las 22:00 hrs")}
          <div>
            <span className="field-label" style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>Tarifas por jornada *</span>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "#1a3a6b", color: "#fff" }}>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>Categoría</th>
                  {TRAMOS.map((t) => <th key={t} style={{ padding: "8px 10px", textAlign: "center" }}>{t} km</th>)}
                  <th />
                </tr></thead>
                <tbody>
                  {(e.tarifas || []).map((cat, ci) => (
                    <tr key={ci} style={{ background: ci % 2 === 0 ? "#f8f9fa" : "#fff" }}>
                      <td style={{ padding: 4, minWidth: 120 }}>
                        <input list="ref-tipos-vehiculo" value={cat.categoria} onChange={(x) => updCategoria(ci, x.target.value)} placeholder="Tipo de vehículo"
                          style={{ width: "100%", padding: "5px 6px", border: "0.5px solid #d0d5dd", borderRadius: 6, fontSize: 12, fontWeight: 700, color: "#1a3a6b" }} />
                      </td>
                      {TRAMOS.map((t) => (
                        <td key={t} style={{ padding: 4 }}>
                          <input value={cat.tramos?.[t] || ""} onChange={(x) => updTarifa(ci, t, x.target.value)} placeholder="$0"
                            style={{ width: "100%", padding: "5px 6px", border: "0.5px solid #d0d5dd", borderRadius: 6, fontSize: 12, textAlign: "center" }} />
                        </td>
                      ))}
                      <td style={{ padding: 4 }}>
                        <button type="button" title="Quitar este tipo" onClick={() => quitarCategoria(ci)}
                          style={{ background: "none", border: "none", color: "#b42318", cursor: "pointer", fontSize: 14 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              <button type="button" className="btn-back" onClick={otraCategoria}>＋ Agregar tipo de vehículo</button>
              <span style={{ fontSize: 11.5, color: GRIS }}>Al abrir se agrega una fila por cada tipo que se busca en este centro.</span>
            </div>
          </div>
          {campo("auxiliar", "Tarifa auxiliar diario", "$300 MXN por día")}
          <div className="two-col">{campo("ns_minimo", "NS mínimo", "99.00%")}{campo("ns_excelente", "NS excelente", "99.50% - 100%")}</div>
          <div className="two-col">{campo("ns_premio", "Premio NS excelente", "5% sobre tarifa diaria")}{campo("ns_castigo", "Castigo bajo NS", "3% sobre tarifa base")}</div>
          <div className="two-col">
            {campo("vigencia", "Vigencia del contrato", "12 meses")}
            <div className="field-row" style={{ display: "flex", alignItems: "center", paddingTop: 20 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={e.semana_retenida || false} style={{ width: "auto" }} onChange={(x) => upd("semana_retenida", x.target.checked)} />
                Semana retenida como garantía
              </label>
            </div>
          </div>
          <div className="field-row"><span className="field-label">Requisitos (uno por línea)</span>
            <textarea value={e.requisitos || ""} onChange={(x) => upd("requisitos", x.target.value)} style={{ height: 100 }} placeholder={"Carta de no antecedentes penales\nLicencia vigente..."} />
          </div>
          <div className="field-row"><span className="field-label">Notas adicionales</span>
            <textarea value={e.notas || ""} onChange={(x) => upd("notas", x.target.value)} style={{ height: 60 }} placeholder="Condiciones especiales..." />
          </div>
        </div>
        <div style={{ padding: "12px 24px", borderTop: "1px solid #e4e7ec", background: "#f8f9fa", display: "flex", gap: 10 }}>
          <button onClick={onCerrar} style={{ flex: 1, background: "#f4f5f7", border: "none", borderRadius: 10, padding: "11px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
          <button onClick={onVer} className="btn-back" style={{ flex: 1 }}>👁 Vista previa</button>
          <button onClick={onGuardar} disabled={busy} className="btn-blue" style={{ flex: 2 }}>💾 Guardar propuesta</button>
        </div>
      </div>
    </div>
  );
}
