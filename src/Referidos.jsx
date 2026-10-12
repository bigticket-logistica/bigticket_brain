// ═══════════════════════════════════════════════════════════════════════════
// Referidos.jsx — Programa de referidos MX (pestaña madre del Brain).
//
//   Bonos       los premios que genera la base cada noche: validar, aprobar,
//               rechazar y marcar pagados.
//   Referidos   cada transportista referido y en qué etapa va.
//   Referidores quienes refieren, su código y su cuenta para pagarles.
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
  entrevista_alta: ["Entrevista y alta", "#eef2ff", AZUL],
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
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    const [b, r, p] = await Promise.all([
      sb.from("vw_ref_brain_premios").select("*").order("cumplido_at", { ascending: false }),
      sb.from("vw_ref_brain_referidos").select("*").order("creado_at", { ascending: false }),
      sb.from("vw_ref_brain_referidores").select("*").order("creado_at", { ascending: false }),
    ]);
    const err = b.error || r.error || p.error;
    if (err) setError(err.message);
    setBonos(b.data || []); setReferidos(r.data || []); setReferidores(p.data || []);
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const porValidar = bonos.filter((x) => x.estado === "por_validar").length;
  const TABS = [["bonos", "Bonos", porValidar], ["referidos", "Referidos", referidos.length], ["referidores", "Referidores", referidores.length]];

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
          {tab === "referidos" && <Referidos referidos={referidos} />}
          {tab === "referidores" && <Referidores referidores={referidores} />}
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
function Referidos({ referidos }) {
  const [q, setQ] = useState("");
  const [etapa, setEtapa] = useState("");
  const lista = useMemo(() => referidos.filter((r) => {
    const t = `${r.nombre} ${r.razon_social || ""} ${r.rfc} ${r.referidor} ${r.codigo}`.toLowerCase();
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
                  <td style={td}>{r.referidor}<div style={sub}>{r.codigo}</div></td>
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
function Referidores({ referidores }) {
  const [q, setQ] = useState("");
  const lista = referidores.filter((r) => !q || `${r.nombre} ${r.codigo} ${r.correo} ${r.telefono} ${r.curp}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <input placeholder="Buscar por nombre, código, correo, teléfono o CURP…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {lista.length === 0 ? <div className="empty">No hay referidores con esa búsqueda.</div> : (
        <div className="form-card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={tabla}>
            <thead><tr>{["Inscrito", "Referidor", "Código", "Contacto", "Cuenta", "Referidos", "Ganado", "Pagado"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
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

const tabla = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th = { textAlign: "left", padding: "10px 12px", fontSize: 11, color: GRIS, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", background: "#f8f9fb", whiteSpace: "nowrap" };
const td = { padding: "10px 12px", verticalAlign: "top" };
const sub = { fontSize: 11.5, color: GRIS, marginTop: 2 };
const btnChico = { padding: "6px 12px", fontSize: 12 };
