import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, sb } from "./shared";

// ─── PNR — Cobro a terceros ─────────────────────────────────────────
// Lista los PNR cobrables de la semana y permite agregar cada uno a la
// conciliación del transportista como línea negativa, dejando registro
// de quién lo hizo. Son cobrables dos motivos:
//   BILLED          → MELI lo envió a facturación
//   WITHOUT_RECEIPT → el supervisor respondió pero no cargó comprobante
// El caso pertenece a la semana en que se volvió cobrable por primera
// vez, así que aparece en una sola semana y nunca se repite. El motivo
// y el derecho a cobro se leen del estado ACTUAL del caso en MELI: si
// después se anuló, la fila queda bloqueada.

const ANCLA_SEM = Date.UTC(2026, 5, 1); // lunes de la semana 24

function fechaUtc(iso) {
  const s = String(iso).slice(0, 10).split("-");
  return new Date(Date.UTC(Number(s[0]), Number(s[1]) - 1, Number(s[2])));
}

// Misma numeración que usa el inventario de flota en la pestaña Terceros:
// no es la semana ISO, es 24 + semanas transcurridas desde el 01/06/2026.
function semanaInventario(fechaIso) {
  if (!fechaIso) return null;
  const d = fechaUtc(fechaIso);
  if (isNaN(d.getTime())) return null;
  const off = (d.getUTCDay() + 6) % 7;
  const lunes = new Date(d.getTime() - off * 86400000);
  return 24 + Math.round((lunes.getTime() - ANCLA_SEM) / (7 * 86400000));
}

function rangoSemana(sem) {
  const inicio = new Date(ANCLA_SEM + (Number(sem) - 24) * 7 * 86400000);
  const fin = new Date(inicio.getTime() + 6 * 86400000);
  return { inicio, fin };
}

function etiquetaSemana(sem) {
  const M = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const { inicio, fin } = rangoSemana(sem);
  const di = inicio.getUTCDate(), mi = M[inicio.getUTCMonth()];
  const df = fin.getUTCDate(), mf = M[fin.getUTCMonth()];
  return mi === mf ? `${di}–${df} ${mi}` : `${di} ${mi} – ${df} ${mf}`;
}

function normalizarPlaca(p) {
  if (!p) return null;
  const s = String(p).trim().toUpperCase().replace(/^SDD-/, "");
  return s || null;
}

// Mismo cálculo de totales que Conciliación Terceros: el IVA se aplica
// sobre el neto y los cobros se restan del bruto.
function recalcSC(filas, cobros) {
  const reales = (filas || []).filter(d => !d._saldo);
  const neto = Math.round((filas || []).reduce((s, d) => s + Number(d.monto || 0), 0) * 100) / 100;
  const neg = neto < 0;
  const iva = neg ? 0 : Math.round(neto * 0.16 * 100) / 100;
  const bruto = neg ? neto : Math.round(neto * 1.16 * 100) / 100;
  const c = Number(cobros || 0);
  const liquido = Math.round((bruto - c) * 100) / 100;
  return {
    neto, iva, bruto, cobros: c, liquido, negativo: neg,
    nViajes: reales.length, nNoPago: reales.filter(d => d.es_no_pago).length,
  };
}

const MOTIVOS = {
  BILLED: { label: "Enviado a facturación", corto: "facturación", color: "#1a3a6b", bg: "#e8eef7", concepto: "PNR facturado" },
  WITHOUT_RECEIPT: { label: "Sin comprobante cargado", corto: "sin comprobante", color: "#92400e", bg: "#fef3c7", concepto: "PNR sin comprobante" },
};
const SUB_COBRABLES = Object.keys(MOTIVOS);

function ChipMotivo({ sub, estadoActual }) {
  if (!sub) {
    return (
      <span style={{
        display: "inline-block", padding: "2px 7px", fontSize: 10, fontWeight: 700,
        borderRadius: 4, background: "#f1f3f6", color: "#64748b", whiteSpace: "nowrap",
      }} title={"Estado actual en MELI: " + (estadoActual || "—")}>
        Ya no cobrable
      </span>
    );
  }
  const m = MOTIVOS[sub] || { label: sub, color: "#334155", bg: "#eef2f7" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 7px", fontSize: 10, fontWeight: 700,
      borderRadius: 4, background: m.bg, color: m.color, whiteSpace: "nowrap",
    }}>
      {m.label}
    </span>
  );
}

const lineaId = (d) => d._id || `m|${String(d.fecha || "").slice(0, 10)}|${d.placa || ""}|${d.id_ruta || ""}|${d.service_center_id || ""}`;

const money = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fechaHora = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const soloFecha = (f) => {
  if (!f) return "—";
  const s = String(f).slice(0, 10).split("-");
  return `${s[2]}/${s[1]}/${s[0]}`;
};

const th = {
  padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#64748b",
  textAlign: "left", borderBottom: "1px solid #e4e7ec", whiteSpace: "nowrap",
};
const td = { padding: "8px 10px", fontSize: 12, color: "#1a1a1a", borderBottom: "1px solid #f1f3f6", verticalAlign: "top" };

function Kpi({ label, valor, sub }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: "12px 16px", minWidth: 150 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{valor}</div>
      {sub ? <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

function ChipResumen({ label, n }) {
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", marginRight: 4, marginBottom: 2,
      fontSize: 9, fontWeight: 600, borderRadius: 4, background: "#eef2f7", color: "#334155",
    }}>
      {label} {n}
    </span>
  );
}

// Detalle de avisos, con la misma lectura que el panel de Posventa:
// cada envío con su tipo, a quién fue y cuántas horas de SLA quedaban.
function DetalleAvisos({ lista }) {
  if (!lista || !lista.length) {
    return <div style={{ fontSize: 11, color: "#94a3b8" }}>Este caso no recibió avisos.</div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto", gap: "2px 16px", fontSize: 11 }}>
      {lista.map((a, i) => (
        <Fragment key={i}>
          <span style={{ color: "#334155" }}>
            {a.tipo || "aviso"}{a.destino ? " · " + a.destino : ""}
          </span>
          <span style={{ color: "#64748b" }}>{fechaHora(a.creado_en)}</span>
          <span style={{ color: a.horas_restantes != null && a.horas_restantes <= 6 ? "#b45309" : "#94a3b8" }}>
            {a.horas_restantes != null ? a.horas_restantes + " h" : ""}
          </span>
          <span style={{ color: "#94a3b8" }}>{a.estado_entrega || ""}</span>
        </Fragment>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Cobros a terceros — todo lo que se descuenta de lo que se les paga.
//
// Cada tipo de cobro vive en su propia subpestaña pero comparte la mecánica:
// dos carriles independientes (portal diario y prefactura semanal), cada uno
// con su botón de agregar y de quitar. Lo que cambia entre ellos es de dónde
// sale el caso y cómo se calcula el monto, no cómo se cobra.
// ═══════════════════════════════════════════════════════════════════════════
export default function CobrosTerceros({ usuario }) {
  const [sub, setSub] = useState("pnr");
  const TABS = [
    { id: "pnr", label: "PNR", desc: "Pedido no resuelto" },
    { id: "robos", label: "Robos y extravíos", desc: "Paquetes perdidos en ruta" },
    { id: "noshow", label: "No Show", desc: "Rutas comprometidas y no operadas" },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 6, padding: "14px 24px 0", flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)} title={t.desc}
            style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${sub === t.id ? "#1a3a6b" : "#e4e7ec"}`,
              background: sub === t.id ? "#1a3a6b" : "#fff",
              color: sub === t.id ? "#fff" : "#64748b",
            }}>
            {t.label}
          </button>
        ))}
      </div>
      {sub === "pnr" && <ModuloPnr usuario={usuario} />}
      {sub === "robos" && <ModuloRobos usuario={usuario} />}
      {sub === "noshow" && <ModuloNoShow usuario={usuario} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Robos y extravíos — cobro de paquetes perdidos, con los mismos dos carriles
// que PNR: portal diario (carril B) y prefactura semanal (carril A).
//
// De dónde salen: mermas_cargas_lineas, que se llena de dos formas — la carga
// manual del Excel de complementarias que ya existe en el módulo Mermas, y el
// botón "Traer de MELI" que golpea el acumulado del período en curso.
//
// Lo que MELI acumula en vivo: la pre-factura del período se va llenando día a
// día. Por eso el botón se puede pulsar cada mañana y trae lo que cayó hoy, en
// vez de esperar al cierre quincenal — que es lo que hoy hace que el tercero se
// entere del cobro hasta tres meses después del hecho.
//
// La fecha del hecho puede ser de hace meses. Siempre se muestra junto al
// cobro: sin eso, un descuento aparece en un día donde no pasó nada.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Robos y extravíos — dos momentos de un mismo caso.
//
// FASE 1 · PERDIDO, sin monto. Lo detecta el vigilante de The Eyes cuando MELI
// declara el paquete `lost`, dos o tres días después del hecho. Se publica al
// portal como aviso: el tercero sabe que hay un paquete perdido en su ruta y
// cuánto tiempo lleva, aunque todavía no haya precio. Lo mismo va como tarea al
// supervisor del centro, que es quien puede buscarlo.
//
// FASE 2 · COBRABLE, con monto. Llega semanas después en el acumulado de MELI
// y cae en mermas_cargas_lineas. Se cruza por guía con el aviso y el mismo caso
// pasa a cobro. Para el tercero no es sorpresa: ya lo conocía.
//
// Los dos carriles —portal y prefactura— operan sobre la fase 2, que es la que
// tiene plata. La fase 1 solo avisa.
// ═══════════════════════════════════════════════════════════════════════════

function ModuloRobos({ usuario }) {
  const [filas, setFilas] = useState(null);
  const [cobrados, setCobrados] = useState({});
  const [enPref, setEnPref] = useState({});
  const [fase, setFase] = useState("cobrable");
  const [busca, setBusca] = useState("");
  const [trayendo, setTrayendo] = useState(false);
  const [guardando, setGuardando] = useState(null);
  const [msg, setMsg] = useState(null);
  const semana = semanaBrainHoy();
  const quien = (usuario && (usuario.email || usuario.nombre)) || "brain";
  const HITO_CERO = "2026-09-14";

  const cargar = useCallback(async () => {
    setFilas(null);
    const [paq, cob, concs] = await Promise.all([
      sb.from("vw_paquetes_cobrables").select("*").gte("fecha_ruta", HITO_CERO).limit(2000),
      sb.from("cobros_merma_mx").select("*").eq("estado", "enviado"),
      sb.from("conciliaciones_terceros").select("detalle").eq("semana", Number(semana)),
    ]);
    setFilas(paq.data || []);
    const mc = {};
    for (const c of (cob.data || [])) mc[c.guia] = c;
    setCobrados(mc);
    const ep = {};
    for (const c of (concs.data || [])) {
      for (const d of (Array.isArray(c.detalle) ? c.detalle : [])) {
        const id = String(d?._id || "");
        if (id.startsWith("merma|")) ep[id.slice(6)] = true;
      }
    }
    setEnPref(ep);
  }, [semana]);

  useEffect(() => { cargar(); }, [cargar]);

  const traerDeMeli = async () => {
    setTrayendo(true); setMsg(null);
    try {
      const r = await fetch("/api/reportes/mermas-acumulado", { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Respuesta sin detalle");
      const t = j.totales || {};
      setMsg({ ok: true, txt: `Sesión ${j.usuario}. ${t.nuevas || 0} con monto nuevo, ${t.actualizadas || 0} actualizados, ${t.anuladas || 0} anulados por MELI.` });
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo traer de MELI: " + (e.message || e) }); }
    setTrayendo(false);
  };

  // FASE 1 · avisar del paquete perdido, sin monto
  const avisarPerdido = async (f) => {
    setGuardando(f.folio_guia); setMsg(null);
    try {
      const { data, error } = await sb.rpc("fn_publicar_paquete_perdido",
        { p_guia: f.folio_guia, p_quien: quien });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "No se pudo publicar");
      setMsg({ ok: true, txt: `Guía ${f.folio_guia} avisada a ${data.empresa}. También quedó como tarea del supervisor de ${data.sc}.` });
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo avisar: " + (e.message || e) }); }
    setGuardando(null);
  };

  // FASE 2 · cobrar, ya con monto
  const publicarCobro = async (f) => {
    if (!f.patente) { setMsg({ ok: false, txt: `La guía ${f.folio_guia} no tiene placa.` }); return; }
    setGuardando(f.folio_guia); setMsg(null);
    try {
      const { data: tid } = await sb.rpc("fn_empresa_de_placa", { p_placa: f.patente });
      if (!tid) throw new Error(`No hay empresa para la placa ${f.patente} en el padrón.`);
      const { data: emp } = await sb.from("terceros").select("nombre").eq("id", tid).maybeSingle();
      const { error } = await sb.from("cobros_merma_mx").upsert({
        linea_id: f.merma_id, guia: String(f.folio_guia), tercero_id: tid,
        empresa_nombre: emp?.nombre, service_center: f.service_center_id,
        semana: String(semana), fecha_hecho: f.fecha_ruta,
        fecha_cobro: new Date().toISOString().slice(0, 10),
        id_ruta: String(f.id_ruta || ""), placa: f.patente, driver_name: f.driver_name,
        motivo: "Paquete perdido", monto: f.monto, estado: "enviado", asignado_por: quien,
      }, { onConflict: "linea_id" });
      if (error) throw error;
      setMsg({ ok: true, txt: `Guía ${f.folio_guia} cobrada a ${emp?.nombre} · ${money(f.monto)}.` });
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo publicar: " + (e.message || e) }); }
    setGuardando(null);
  };

  const quitarCobro = async (f, ya) => {
    if (!window.confirm(`¿Quitar del portal el cobro de la guía ${f.folio_guia}?\n\n${ya.empresa_nombre} · ${money(f.monto)}`)) return;
    setGuardando(f.folio_guia);
    try {
      await sb.from("cobros_merma_mx").delete().eq("guia", String(f.folio_guia));
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo quitar: " + (e.message || e) }); }
    setGuardando(null);
  };

  const { visibles, conteo } = useMemo(() => {
    const fs = filas || [];
    const c = {
      cobrable: fs.filter(f => f.fase === "cobrable").length,
      perdido: fs.filter(f => f.fase === "perdido").length,
      en_riesgo: fs.filter(f => f.fase === "en_riesgo").length,
    };
    let v = fs.filter(f => f.fase === fase);
    const q = busca.trim().toLowerCase();
    if (q) v = v.filter(f => [f.folio_guia, f.patente, f.driver_name, f.id_ruta]
      .some(x => String(x || "").toLowerCase().includes(q)));
    return { visibles: v.slice(0, 400), conteo: c };
  }, [filas, fase, busca]);

  const dias = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
  const th = { textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#64748b", background: "#f8fafc", textTransform: "uppercase", letterSpacing: .4, whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: 11.5, borderBottom: "1px solid #f1f5f9" };

  const TABS = [
    { id: "cobrable", l: "Con monto", n: conteo.cobrable, ayuda: "MELI ya puso el precio. Se cobra." },
    { id: "perdido", l: "Perdidos sin monto", n: conteo.perdido, ayuda: "MELI los declaró perdidos. El precio llega después, en el acumulado." },
    { id: "en_riesgo", l: "En riesgo", n: conteo.en_riesgo, ayuda: "No volvieron al centro. Todavía pueden aparecer." },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#1a3a6b" }}>Robos y extravíos</div>
          <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2, maxWidth: 640, lineHeight: 1.5 }}>
            El paquete se declara perdido a los dos o tres días; el monto llega semanas después en
            el acumulado de MELI. Se avisa primero y se cobra cuando hay precio.
          </div>
        </div>
        <button onClick={traerDeMeli} disabled={trayendo}
          style={{ padding: "9px 18px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700,
            background: trayendo ? "#cbd5e1" : "#1a3a6b", color: "#fff", cursor: trayendo ? "not-allowed" : "pointer" }}>
          {trayendo ? "Consultando a MELI…" : "↓ Traer montos de MELI"}
        </button>
      </div>

      {msg && (
        <div style={{ background: msg.ok ? "#f0fdf4" : "#fef2f2", color: msg.ok ? "#166534" : "#991b1b",
          border: `1px solid ${msg.ok ? "#86efac" : "#fca5a5"}`, borderRadius: 8,
          padding: "10px 12px", fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>{msg.txt}</div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setFase(t.id)} title={t.ayuda}
            style={{ padding: "7px 15px", borderRadius: 16, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${fase === t.id ? "#1a3a6b" : "#e4e7ec"}`,
              background: fase === t.id ? "#1a3a6b" : "#fff", color: fase === t.id ? "#fff" : "#64748b" }}>
            {t.l}{t.n > 0 ? ` (${t.n})` : ""}
          </button>
        ))}
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Guía, placa, conductor, ruta…"
          style={{ border: "1px solid #e4e7ec", borderRadius: 6, padding: "6px 10px", fontSize: 12, minWidth: 230 }} />
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>
        {TABS.find(t => t.id === fase)?.ayuda}
      </div>

      {filas === null ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Cargando…</div>
      ) : visibles.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 36, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          Sin paquetes en esta fase.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Guía</th><th style={th}>Ruta del</th><th style={th}>Estado</th>
              <th style={th}>Placa</th><th style={th}>Quién respondía</th><th style={th}>SC</th>
              <th style={{ ...th, textAlign: "right" }}>Monto</th>
              <th style={{ ...th, textAlign: "right" }}>Acciones</th>
            </tr></thead>
            <tbody>
              {visibles.map(f => {
                const ya = cobrados[String(f.folio_guia)];
                const dRuta = dias(f.fecha_ruta);
                const avisado = !!f.aviso_at;
                return (
                  <tr key={f.folio_guia} style={{ background: ya ? "#fbfdfb" : "#fff" }}>
                    <td style={{ ...td, fontWeight: 600, color: "#1a3a6b" }}>
                      {f.folio_guia}
                      {f.id_ruta && <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 400 }}>ruta {f.id_ruta}</div>}
                    </td>
                    <td style={{ ...td, color: "#64748b", whiteSpace: "nowrap" }}>
                      {f.fecha_ruta}
                      {dRuta !== null && <div style={{ fontSize: 9, color: dRuta > 7 ? "#b45309" : "#94a3b8" }}>hace {dRuta} d</div>}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                        background: f.substatus === "lost" ? "#fee2e2" : "#fef3c7",
                        color: f.substatus === "lost" ? "#991b1b" : "#92400e" }}>
                        {f.substatus}
                      </span>
                      {f.lost_at && <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>
                        perdido {new Date(f.lost_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                      </div>}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>{f.patente || "—"}</td>
                    {/* Quién responde cambia con la fase: mientras el paquete iba en
                        ruta era el conductor; una vez que entró al centro en
                        problem_solving, es el supervisor quien lo tiene que encontrar. */}
                    <td style={{ ...td, color: "#64748b" }}>
                      <div>
                        <span style={{ fontSize: 9, color: "#94a3b8" }}>chofer </span>
                        {f.driver_name || "—"}
                      </div>
                      {f.supervisor && (
                        <div style={{ marginTop: 2 }}>
                          <span style={{ fontSize: 9, color: "#94a3b8" }}>supervisor </span>
                          {f.supervisor}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, color: "#64748b" }}>{f.service_center_id || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                      color: f.monto ? "#b91c1c" : "#cbd5e1" }}>
                      {f.monto ? money(f.monto) : "sin precio"}
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      {f.fase === "cobrable" ? (
                        ya ? (
                          <div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: "#92400e" }}>✓ en el portal</div>
                            <div style={{ fontSize: 8.5, color: "#94a3b8" }}>{ya.empresa_nombre}</div>
                            <button onClick={() => quitarCobro(f, ya)} disabled={guardando === f.folio_guia}
                              style={{ marginTop: 3, padding: "3px 10px", fontSize: 9.5, fontWeight: 700, borderRadius: 5,
                                border: "1px solid #f59e0b", background: "#fffbeb", color: "#92400e", cursor: "pointer" }}>
                              Quitar del portal
                            </button>
                          </div>
                        ) : (
                          <div>
                            <button onClick={() => publicarCobro(f)} disabled={guardando === f.folio_guia || !f.patente}
                              style={{ padding: "5px 12px", fontSize: 10.5, fontWeight: 700, borderRadius: 6,
                                border: "1px solid #f59e0b", background: "#fffbeb", color: "#92400e", cursor: "pointer" }}>
                              {guardando === f.folio_guia ? "…" : "Publicar cobro"}
                            </button>
                            <div style={{ fontSize: 8.5, color: "#94a3b8", marginTop: 2 }}>diario · carril B</div>
                          </div>
                        )
                      ) : f.fase === "perdido" ? (
                        avisado ? (
                          <div style={{ fontSize: 9.5, fontWeight: 700, color: "#166534" }}>
                            ✓ avisado
                            <div style={{ fontSize: 8.5, color: "#94a3b8", fontWeight: 400 }}>
                              esperando el monto de MELI
                            </div>
                          </div>
                        ) : (
                          <div>
                            <button onClick={() => avisarPerdido(f)} disabled={guardando === f.folio_guia}
                              style={{ padding: "5px 12px", fontSize: 10.5, fontWeight: 700, borderRadius: 6,
                                border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b", cursor: "pointer" }}>
                              {guardando === f.folio_guia ? "…" : "Avisar al tercero"}
                            </button>
                            <div style={{ fontSize: 8.5, color: "#94a3b8", marginTop: 2 }}>sin monto todavía</div>
                          </div>
                        )
                      ) : (
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>puede aparecer</span>
                      )}
                    </td>
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

// Numeración del Brain: ISO + 1
function semanaBrainHoy() {
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dn);
  const ini = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - ini) / 86400000 + 1) / 7) + 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// No Show — el conductor no se presentó a operar su ruta.
//
// Nace en la Bitácora: el supervisor declara las placas que no se presentaron
// en el Ítem correspondiente de su día. De ahí sale la línea de cobro.
//
// El monto lo pone el analista a mano: no hay tarifa fija todavía. Y la empresa
// se resuelve por la placa con fn_empresa_de_placa, igual que el pago, para que
// el cobro y el pago de una misma placa nunca vayan a empresas distintas.
//
// Limitación conocida: la Bitácora guarda solo la placa, no el nombre del
// conductor. Cuando el tercero reclame, "no se presentó la placa X" es más
// débil que nombrar a quien faltó. Vale la pena pedirle a la Bitácora que
// capture también el conductor.
// ═══════════════════════════════════════════════════════════════════════════
function ModuloNoShow({ usuario }) {
  const [filas, setFilas] = useState(null);
  const [enPref, setEnPref] = useState({});
  const [filtro, setFiltro] = useState("pendientes");
  const [guardando, setGuardando] = useState(null);
  const [msg, setMsg] = useState(null);
  const semana = semanaBrainHoy();
  const quien = (usuario && (usuario.email || usuario.nombre)) || "brain";

  const cargar = useCallback(async () => {
    setFilas(null);
    const [v, concs] = await Promise.all([
      sb.from("vw_noshow_declarados").select("*").order("fecha", { ascending: false }),
      sb.from("conciliaciones_terceros").select("detalle").eq("semana", Number(semana)),
    ]);
    setFilas(v.data || []);
    const ep = {};
    for (const c of (concs.data || [])) {
      for (const d of (Array.isArray(c.detalle) ? c.detalle : [])) {
        const id = String(d?._id || "");
        if (id.startsWith("noshow|")) ep[id.slice(7)] = true;
      }
    }
    setEnPref(ep);
  }, [semana]);

  useEffect(() => { cargar(); }, [cargar]);

  const clave = (f) => `${f.fecha}|${f.sc}|${f.placa}`;

  // CARRIL B · portal. El monto lo pone el analista: no hay tarifa fija.
  const publicar = async (f) => {
    if (!f.tercero_id) { setMsg({ ok: false, txt: `La placa ${f.placa} no tiene empresa en el padrón.` }); return; }
    const m = window.prompt(
      `Cobro por no show\n\n${f.empresa}\n${f.placa} · ${f.sc} · ${f.fecha}\n\nMonto a cobrar:`,
      f.monto || "");
    if (m === null) return;
    const monto = Number(String(m).replace(/[^\d.\-]/g, ""));
    if (!isFinite(monto) || monto <= 0) { setMsg({ ok: false, txt: "Monto inválido." }); return; }

    setGuardando(clave(f)); setMsg(null);
    try {
      const { error } = await sb.from("cobros_noshow_mx").upsert({
        fecha: f.fecha, service_center: f.sc, placa: f.placa,
        tercero_id: f.tercero_id, empresa_nombre: f.empresa,
        monto, semana: String(semana), estado: "enviado",
        justificacion: f.noshow_justificacion, asignado_por: quien,
      }, { onConflict: "fecha,service_center,placa" });
      if (error) throw error;
      setMsg({ ok: true, txt: `No show del ${f.fecha} publicado a ${f.empresa} · ${money(monto)}.` });
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo publicar: " + (e.message || e) }); }
    setGuardando(null);
  };

  const quitar = async (f) => {
    if (!window.confirm(`¿Quitar del portal el no show del ${f.fecha}?\n\n${f.empresa} · ${f.placa} · ${money(f.monto)}`)) return;
    setGuardando(clave(f));
    try {
      await sb.from("cobros_noshow_mx").delete().eq("id", f.cobro_id);
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo quitar: " + (e.message || e) }); }
    setGuardando(null);
  };

  const visibles = useMemo(() => {
    let fs = filas || [];
    if (filtro === "pendientes") fs = fs.filter(f => f.cobro_estado !== "enviado");
    else if (filtro === "publicados") fs = fs.filter(f => f.cobro_estado === "enviado");
    return fs;
  }, [filas, filtro]);

  const totPub = (filas || []).filter(f => f.cobro_estado === "enviado")
    .reduce((t, f) => t + Number(f.monto || 0), 0);
  const th = { textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#64748b", background: "#f8fafc", textTransform: "uppercase", letterSpacing: .4, whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: 11.5, borderBottom: "1px solid #f1f5f9" };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#1a3a6b" }}>No Show</div>
        <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2, maxWidth: 640, lineHeight: 1.5 }}>
          Placas que el supervisor declaró como no presentadas en su bitácora del día.
          El monto lo pones tú: no hay tarifa fija todavía.
        </div>
      </div>

      {msg && (
        <div style={{ background: msg.ok ? "#f0fdf4" : "#fef2f2", color: msg.ok ? "#166534" : "#991b1b",
          border: `1px solid ${msg.ok ? "#86efac" : "#fca5a5"}`, borderRadius: 8,
          padding: "10px 12px", fontSize: 12.5, marginBottom: 12 }}>{msg.txt}</div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {[["pendientes", "Sin cobrar"], ["publicados", "En el portal"], ["todas", "Todas"]].map(([id, l]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{ padding: "6px 14px", borderRadius: 16, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${filtro === id ? "#1a3a6b" : "#e4e7ec"}`,
              background: filtro === id ? "#1a3a6b" : "#fff", color: filtro === id ? "#fff" : "#64748b" }}>{l}</button>
        ))}
        <span style={{ fontSize: 11.5, color: "#64748b", marginLeft: "auto" }}>
          Cobrado: <b style={{ color: "#b91c1c" }}>{money(totPub)}</b>
        </span>
      </div>

      {filas === null ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Cargando…</div>
      ) : visibles.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 36, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          {filtro === "pendientes" ? "No hay no shows sin cobrar." : "Sin resultados."}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Fecha</th><th style={th}>SC</th><th style={th}>Placa</th>
              <th style={th}>Empresa</th><th style={th}>Justificación</th>
              <th style={{ ...th, textAlign: "right" }}>Monto</th>
              <th style={{ ...th, textAlign: "right" }}>Acciones</th>
            </tr></thead>
            <tbody>
              {visibles.map(f => {
                const pub = f.cobro_estado === "enviado";
                return (
                  <tr key={clave(f)} style={{ background: pub ? "#fbfdfb" : "#fff" }}>
                    <td style={{ ...td, color: "#64748b", whiteSpace: "nowrap" }}>{f.fecha}</td>
                    <td style={{ ...td, color: "#64748b" }}>{f.sc}</td>
                    <td style={{ ...td, fontWeight: 600, color: "#1a3a6b" }}>{f.placa}</td>
                    <td style={{ ...td, color: f.empresa ? "#334155" : "#b45309", fontWeight: f.empresa ? 400 : 600 }}>
                      {f.empresa || "⚠️ sin empresa en el padrón"}
                    </td>
                    <td style={{ ...td, color: "#94a3b8", fontSize: 11 }}>{f.noshow_justificacion || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                      color: f.monto ? "#b91c1c" : "#cbd5e1" }}>
                      {f.monto ? money(f.monto) : "sin monto"}
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      {pub ? (
                        <div>
                          <div style={{ fontSize: 9.5, fontWeight: 700, color: "#92400e" }}>✓ en el portal</div>
                          <button onClick={() => quitar(f)} disabled={guardando === clave(f)}
                            style={{ marginTop: 3, padding: "3px 10px", fontSize: 9.5, fontWeight: 700, borderRadius: 5,
                              border: "1px solid #f59e0b", background: "#fffbeb", color: "#92400e", cursor: "pointer" }}>
                            Quitar del portal
                          </button>
                        </div>
                      ) : (
                        <div>
                          <button onClick={() => publicar(f)} disabled={guardando === clave(f) || !f.tercero_id}
                            style={{ padding: "5px 12px", fontSize: 10.5, fontWeight: 700, borderRadius: 6,
                              border: "1px solid #f59e0b", background: f.tercero_id ? "#fffbeb" : "#f8fafc",
                              color: f.tercero_id ? "#92400e" : "#94a3b8",
                              cursor: f.tercero_id ? "pointer" : "not-allowed" }}>
                            {guardando === clave(f) ? "…" : "Cobrar y publicar"}
                          </button>
                          <div style={{ fontSize: 8.5, color: "#94a3b8", marginTop: 2 }}>diario · carril B</div>
                        </div>
                      )}
                    </td>
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

function EnConstruccion({ titulo, nota }) {
  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>{titulo}</div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 8, maxWidth: 520, margin: "8px auto 0", lineHeight: 1.6 }}>
        {nota}
      </div>
    </div>
  );
}

function ModuloPnr({ usuario }) {
  const [semana, setSemana] = useState(() => semanaInventario(new Date().toISOString()));
  const [filas, setFilas] = useState([]);
  const [cobrados, setCobrados] = useState({});
  const [enPrefactura, setEnPrefactura] = useState({});  // pnr_id -> ya tiene linea en la conciliacion
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState(null);
  const [semanaCobro, setSemanaCobro] = useState(() => semanaInventario(new Date().toISOString()));
  const [seleccion, setSeleccion] = useState({});

  const quien = (usuario && (usuario.nombre || usuario.email)) || "Brain";

  useEffect(() => { cargar(semana); }, [semana]);

  const cargar = async (sem, conservarMsg) => {
    setLoading(true);
    if (!conservarMsg) setMsg(null);
    try {
      const { inicio, fin } = rangoSemana(sem);
      const desde = inicio.toISOString();
      const hasta = new Date(fin.getTime() + 86400000).toISOString();

      // 1) transiciones a facturación dentro de la semana
      const { data: hist, error: e1 } = await sb.from("pnr_historial_mx")
        .select("case_id, sub_a, creado_en").in("sub_a", SUB_COBRABLES)
        .lt("creado_en", hasta)
        .order("creado_en", { ascending: true });
      if (e1) throw e1;

      // Primera vez que cada caso se volvió cobrable. Esa fecha define su
      // semana, así que un caso aparece en una sola semana aunque después
      // cambie de sub-estado varias veces.
      const primeraVez = {};
      for (const h of hist || []) if (!primeraVez[h.case_id]) primeraVez[h.case_id] = h.creado_en;

      // se quedan solo los que se volvieron cobrables dentro de esta semana
      const cobrable = {};
      for (const cid in primeraVez) {
        if (primeraVez[cid] >= desde) cobrable[cid] = { ts: primeraVez[cid] };
      }
      const ids = Object.keys(cobrable).map(Number);
      if (!ids.length) { setFilas([]); setCobrados({}); setLoading(false); return; }

      // 2) datos del caso
      const { data: casos, error: e2 } = await sb.from("pnr_casos_mx")
        .select("case_id, shipment_id, monto, moneda, conductor, service_center, route_code, route_id, tercero_id, estado, sub_estado")
        .in("case_id", ids);
      if (e2) throw e2;

      // 2b) historial completo de avisos (el mismo que muestra Posventa)
      const avisosPorCaso = {};
      const { data: avs } = await sb.from("vw_pnr_avisos_historial")
        .select("case_id, tipo, destino, creado_en, horas_restantes, estado_entrega")
        .in("case_id", ids)
        .order("creado_en", { ascending: true });
      for (const a of avs || []) {
        (avisosPorCaso[a.case_id] = avisosPorCaso[a.case_id] || []).push(a);
      }

      // 2c) los que ya se agregaron a una conciliación
      const yaCobrados = {};
      const { data: cob } = await sb.from("cobros_pnr_mx")
        .select("pnr_id, empresa_nombre, service_center, semana, monto, asignado_por, enviado_a_cobro_en")
        .in("pnr_id", ids.map(String));
      for (const c of cob || []) yaCobrados[c.pnr_id] = c;

      // 3) placa y fecha de ruta desde la jornada
      const rutas = [...new Set((casos || []).map(c => c.route_id).filter(Boolean))];
      let jornada = {};
      if (rutas.length) {
        const { data: jor } = await sb.from("maestro_jornada_mx")
          .select("id_ruta, placa, fecha, driver_name, service_center_id").in("id_ruta", rutas);
        for (const j of jor || []) if (!jornada[j.id_ruta]) jornada[j.id_ruta] = j;
      }

      // 4) empresa por placa según la semana de la ruta (no la de facturación)
      const semanas = [...new Set(Object.values(jornada).map(j => semanaInventario(j.fecha)).filter(s => s != null))];
      const empSem = {};
      if (semanas.length) {
        const { data: fl } = await sb.from("flota_terceros_mx")
          .select("semana, placa, empresa_transporte").in("semana", semanas).limit(50000);
        const acc = {};
        for (const f of fl || []) {
          const e = String(f.empresa_transporte || "").trim(); if (!e) continue;
          const k = f.semana + "||" + normalizarPlaca(f.placa);
          if (!acc[k]) acc[k] = new Set();
          acc[k].add(e);
        }
        for (const k in acc) empSem[k] = [...acc[k]].join(" / ");
      }

      // La empresa se resuelve con fn_empresa_de_placa, igual que el pago: manda
      // el inventario de certificación y, si la placa no está ahí, el padrón de
      // la bitácora. Antes se leía flota_terceros_mx —el Excel semanal viejo— y
      // por eso había placas que el motor sí resolvía y acá salían sin empresa.
      const placasUnicas = [...new Set((casos || [])
        .map(c => (jornada[c.route_id] || {}).placa).filter(Boolean)
        .map(p => normalizarPlaca(p)))];
      const empPorPlaca = {};
      await Promise.all(placasUnicas.map(async (pl) => {
        try {
          const { data: tid } = await sb.rpc("fn_empresa_de_placa", { p_placa: pl });
          if (!tid) return;
          const { data: t } = await sb.from("terceros").select("nombre").eq("id", tid).maybeSingle();
          if (t?.nombre) empPorPlaca[pl] = t.nombre;
        } catch (e) { console.error("No se pudo resolver la empresa de", pl, e); }
      }));

      const out = (casos || []).map(c => {
        const j = jornada[c.route_id] || {};
        const placa = j.placa || null;
        const empresa = placa ? (empPorPlaca[normalizarPlaca(placa)] || null) : null;
        const avisos = avisosPorCaso[c.case_id] || [];
        const porTipo = {};
        for (const a of avisos) {
          const t = a.tipo || "aviso";
          porTipo[t] = (porTipo[t] || 0) + 1;
        }
        const mot = cobrable[c.case_id] || {};
        return {
          ...c,
          sub_cobro: MOTIVOS[c.sub_estado] ? c.sub_estado : null,
          facturado_en: mot.ts,
          placa,
          fecha_ruta: j.fecha || null,
          semana_ruta: semanaInventario(j.fecha),
          empresa,
          avisos,
          resumen_avisos: Object.entries(porTipo),
          sin_avisos: avisos.length === 0,
        };
      }).sort((a, b) => String(b.facturado_en).localeCompare(String(a.facturado_en)));

      setFilas(out);
      setCobrados(yaCobrados);

      // Un PNR puede estar solo en el portal (carril B), solo en la prefactura
      // (carril A) o en los dos. Sin distinguirlos, publicar al portal ocultaba
      // el boton de agregar a la prefactura: la fila pasaba a "cobrado" y ya.
      const enPref = {};
      if (Object.keys(yaCobrados).length) {
        const { data: concs } = await sb.from("conciliaciones_terceros")
          .select("empresa_nombre, service_center, semana, detalle")
          .eq("semana", Number(sem));
        for (const c of (concs || [])) {
          for (const d of (Array.isArray(c.detalle) ? c.detalle : [])) {
            const id = String(d?._id || "");
            if (id.startsWith("pnr|")) enPref[id.slice(4)] = true;
          }
        }
      }
      setEnPrefactura(enPref);
      const sel = {};
      for (const f of out) if (!yaCobrados[String(f.case_id)]) sel[f.case_id] = true;
      setSeleccion(sel);
    } catch (e) {
      console.error("PNR cobros:", e);
      setMsg({ ok: false, txt: "No se pudo cargar la semana: " + (e.message || e) });
      setFilas([]);
    }
    setLoading(false);
  };

  // Arma la línea de prefactura y la fila de cobro de un PNR.
  const prepararCobro = (f) => {
    const mot = MOTIVOS[f.sub_cobro] || { label: f.sub_cobro || "PNR", concepto: "PNR" };
    const sc = f.service_center || "SIN SC";
    const monto = Math.abs(Number(f.monto || 0));
    const linea = {
      _id: `pnr|${f.case_id}`, origen: "pnr", es_manual: true,
      fecha: f.fecha_ruta ? String(f.fecha_ruta).slice(0, 10) : null,
      placa: f.placa || "—",
      id_ruta: f.route_id || "",   // el numérico, igual que el resto de la prefactura
      driver_name: "",             // lo arma etiquetar(), que ya sabe el SC final
      service_center_id: sc,
      tiene_auxiliar: false, cargado: null, entregado: null,
      monto: -monto, es_no_pago: false,
      pnr_case_id: f.case_id,
      pnr_shipment_id: f.shipment_id || null,
      pnr_motivo: mot.label,
      pnr_conductor: f.conductor || null,
      pnr_facturado_en: f.facturado_en || null,
      pnr_sc_original: sc,
      pnr_fecha_ruta: f.fecha_ruta || null,
      // Copia del historial de avisos al momento del cobro: es la prueba que
      // viaja impresa en la prefactura, así que no puede depender de Posventa.
      pnr_avisos: (f.avisos || []).map(a => ({
        t: a.tipo || "aviso", d: a.destino || null,
        f: a.creado_en, h: a.horas_restantes != null ? a.horas_restantes : null,
      })),
      agregado_por: quien,
      agregado_at: new Date().toISOString(),
    };
    return { mot, sc, monto, linea, caso: f };
  };

  // Texto que ve el transportista en el detalle de la prefactura: tiene que
  // explicarse solo, porque es la única referencia que va a tener al reclamar.
  const etiquetar = (linea, scFinal) => {
    const partes = [
      `COBRO PNR ${linea.pnr_case_id}`,
      linea.pnr_shipment_id ? `guía ${linea.pnr_shipment_id}` : null,
      linea.pnr_fecha_ruta ? `ruta del ${soloFecha(linea.pnr_fecha_ruta)}` : null,
    ];
    if (scFinal !== linea.pnr_sc_original) {
      partes.push(`corresponde a ${linea.pnr_sc_original}, cobrado acá por no haber operación esa semana en ${linea.pnr_sc_original}`);
    }
    return partes.filter(Boolean).join(" · ");
  };

  // Motivo por el que un PNR no se puede cobrar automáticamente.
  const bloqueo = (f) => {
    if (!f.empresa) return "sin empresa resuelta";
    if (String(f.empresa).includes(" / ")) return "la placa está en dos empresas esa semana";
    if (!Math.abs(Number(f.monto || 0))) return "sin monto";
    return null;
  };

  // SC donde se puede cobrar: el propio si la empresa trabajó ahí esa semana;
  // si no, el que más viajes tenga. Sin operación en ningún SC no hay de dónde
  // descontar. El cache evita repetir la consulta por cada caso de la empresa.
  const resolverSc = async (empresa, scPreferido, cache) => {
    const k = empresa;
    if (!cache[k]) {
      const cuenta = {};
      const { data, error } = await sb.rpc("get_conciliacion_terceros_detalle",
        { p_semana: semanaCobro, p_empresa: empresa, p_sc: null });
      if (error) throw error;
      for (const d of data || []) {
        const sc = d.service_center_id || "SIN SC";
        cuenta[sc] = (cuenta[sc] || 0) + 1;
      }
      // El motor no siempre devuelve las líneas de una prefactura ya generada.
      // Las prefacturas guardadas son la prueba directa de que hay operación,
      // así que también cuentan como SC disponible.
      const { data: conc } = await sb.from("conciliaciones_terceros")
        .select("service_center, n_viajes")
        .eq("empresa_nombre", empresa).eq("semana", semanaCobro);
      for (const c of conc || []) {
        const sc = c.service_center || "SIN SC";
        if (!cuenta[sc]) cuenta[sc] = Number(c.n_viajes || 0) || 1;
      }
      cache[k] = cuenta;
    }
    const cuenta = cache[k];
    const scs = Object.keys(cuenta);
    if (!scs.length) return null;
    if (cuenta[scPreferido]) return scPreferido;
    return scs.sort((a, b) => cuenta[b] - cuenta[a])[0];
  };

  // Escribe en la conciliación de una empresa y SC todas las líneas de PNR que
  // le corresponden. Una sola escritura por grupo: si se hiciera una por caso,
  // dos cobros de la misma empresa se pisarían el detalle entre sí.
  const cargarEnConciliacion = async (empresa, sc, lineas) => {
    const { data: motor, error: eRpc } = await sb.rpc("get_conciliacion_terceros_detalle",
      { p_semana: semanaCobro, p_empresa: empresa, p_sc: sc });
    if (eRpc) throw eRpc;
    let actuales = (motor || []).map(d => ({ ...d, _id: lineaId(d), origen: d.origen || "motor" }));

    const { data: conc } = await sb.from("conciliaciones_terceros")
      .select("detalle, total_cobros, estado")
      .eq("empresa_nombre", empresa).eq("service_center", sc).eq("semana", semanaCobro).maybeSingle();
    if (conc && Array.isArray(conc.detalle) && conc.detalle.length) {
      actuales = conc.detalle.map(d => ({ ...d, _id: d._id || lineaId(d), origen: d.origen || "motor" }));
    }

    const yaEstan = new Set(actuales.map(lineaId));
    const nuevas = lineas.filter(l => !yaEstan.has(l._id));
    if (!nuevas.length) return 0;

    const filasSC = actuales.concat(nuevas);
    const { inicio } = rangoSemana(semanaCobro);
    const tot = recalcSC(filasSC, Number((conc && conc.total_cobros) || 0));
    const { error: eUp } = await sb.from("conciliaciones_terceros").upsert({
      empresa_nombre: empresa, service_center: sc, semana: semanaCobro,
      semana_inicio: inicio.toISOString().slice(0, 10), estado: "borrador",
      total_neto: tot.neto, iva_16: tot.iva, total_bruto: tot.bruto,
      total_cobros: tot.cobros, liquido_pago: tot.liquido,
      n_viajes: tot.nViajes, n_no_pago: tot.nNoPago,
      detalle: filasSC, tiene_ajustes: true,
      generado_at: new Date().toISOString(),
    }, { onConflict: "empresa_nombre,service_center,semana" });
    if (eUp) throw eUp;

    await sb.from("conciliacion_terceros_ajustes").insert(nuevas.map(l => ({
      empresa_nombre: empresa, service_center: sc, semana: semanaCobro,
      accion: "agregar", origen_linea: "pnr", linea: l,
      motivo: `Cobro de PNR ${l.pnr_case_id} · ${l.pnr_motivo} (guía ${l.pnr_shipment_id || "—"}) por ${money(Math.abs(l.monto))}`
        + (l.service_center_id !== l.pnr_sc_original ? ` — corresponde a ${l.pnr_sc_original}, sin operación esa semana` : ""),
      usuario: quien,
    })));
    return nuevas.length;
  };

  // ── CARRIL B · Publicar al portal ────────────────────────────────────────
  // Escribe solo en cobros_pnr_mx, que es lo que lee el portal del tercero. No
  // toca la prefactura: ese es el carril A, que sigue armándose el lunes.
  //
  // La empresa NO la asigna el analista: la resuelve fn_empresa_de_placa con la
  // fecha de la ruta, igual que el pago. Así el cobro y el pago de una misma
  // placa nunca pueden ir a empresas distintas.
  const publicarAlPortal = async (lista) => {
    const filas = [];
    const sinEmpresa = [];
    for (const f of lista) {
      if (!f.placa) { sinEmpresa.push(`${f.case_id} (sin placa)`); continue; }
      const prep = prepararCobro(f);
      const { data: tid } = await sb.rpc("fn_empresa_de_placa", { p_placa: f.placa });
      if (!tid) { sinEmpresa.push(`${f.case_id} · ${f.placa}`); continue; }
      const { data: emp } = await sb.from("terceros").select("nombre").eq("id", tid).maybeSingle();
      filas.push({
        pnr_id: String(f.case_id),
        empresa_nombre: emp?.nombre || f.empresa,
        service_center: prep.sc,
        semana: String(semanaCobro),
        fecha_ruta: f.fecha_ruta || String(f.facturado_en).slice(0, 10),
        facturado_en: String(f.facturado_en).slice(0, 10),
        driver_name: f.conductor || null,
        placa: f.placa,
        concepto: prep.mot.concepto,
        monto: prep.monto,
        estado: "enviado",
        enviado_a_cobro_en: new Date().toISOString(),
        asignado_por: quien,
      });
    }
    if (!filas.length) return { ok: 0, sinEmpresa };
    const { error } = await sb.from("cobros_pnr_mx").upsert(filas, { onConflict: "pnr_id" });
    if (error) throw error;
    return { ok: filas.length, sinEmpresa };
  };

  // ── CARRIL A · Agregar a la prefactura ───────────────────────────────────
  // Ejecuta un lote de cobros: resuelve el SC de cada uno, agrupa por empresa y
  // SC final, y hace una sola escritura por prefactura.
  const ejecutarCobros = async (lista, scForzado) => {
    const cache = {};
    const grupos = {};
    const sinOperacion = [];
    for (const f of lista) {
      const prep = prepararCobro(f);
      let scFinal = scForzado || null;
      if (!scFinal) {
        try {
          scFinal = await resolverSc(f.empresa, prep.sc, cache);
        } catch (e) {
          console.error("resolver SC:", e); scFinal = null;
        }
      }
      if (!scFinal) { sinOperacion.push(`${f.case_id} (${f.empresa})`); continue; }
      prep.linea.service_center_id = scFinal;
      prep.linea.driver_name = etiquetar(prep.linea, scFinal);
      const fila = {
        pnr_id: String(f.case_id),
        empresa_nombre: f.empresa,
        service_center: scFinal,
        semana: String(semanaCobro),
        fecha_ruta: f.fecha_ruta || String(f.facturado_en).slice(0, 10),
        facturado_en: String(f.facturado_en).slice(0, 10),
        driver_name: f.conductor || null,
        placa: f.placa || null,
        concepto: prep.mot.concepto + (scFinal !== prep.sc ? ` (corresponde a ${prep.sc})` : ""),
        monto: prep.monto,
        estado: "enviado",
        enviado_a_cobro_en: new Date().toISOString(),
        asignado_por: quien,
      };
      const k = f.empresa + "||" + scFinal;
      (grupos[k] = grupos[k] || { empresa: f.empresa, sc: scFinal, lineas: [], filas: [] });
      grupos[k].lineas.push(prep.linea);
      grupos[k].filas.push(fila);
    }

    let ok = 0, movidos = 0;
    const fallidos = [];
    for (const k of Object.keys(grupos)) {
      const g = grupos[k];
      let insertadas = [];
      try {
        // upsert y no insert: el carril B pudo haberlo publicado antes al portal.
        const { error: eIns } = await sb.from("cobros_pnr_mx").upsert(g.filas, { onConflict: "pnr_id" });
        if (eIns) throw eIns;

        // Aviso al supervisor del centro. El caso desaparece de su bitácora
        // cuando la torre lo cierra, así que sin este correo nunca se entera de
        // que terminó en cobro ni de cuánto. No bloquea: si n8n está caído, el
        // cobro ya quedó hecho y el historial igual lo va a mostrar.
        for (const fila of g.filas) {
          try {
            const { data: payload } = await sb.rpc("fn_payload_aviso_pnr", { p_pnr: fila.pnr_id });
            if (payload) {
              await fetch("https://bigticket2026.app.n8n.cloud/webhook/pnr-cobrado-notificar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
            }
          } catch (e) { console.error("No se pudo avisar al supervisor del PNR", fila.pnr_id, e); }
        }
        insertadas = g.filas.map(x => x.pnr_id);
        const n = await cargarEnConciliacion(g.empresa, g.sc, g.lineas);
        ok += n;
        movidos += g.lineas.filter(l => l.service_center_id !== l.pnr_sc_original).length;
      } catch (e) {
        console.error("cobro PNR:", g.empresa, g.sc, e);
        if (insertadas.length) {
          try { await sb.from("cobros_pnr_mx").delete().in("pnr_id", insertadas); } catch (e2) { console.error(e2); }
        }
        fallidos.push(`${g.empresa} · ${g.sc}`);
      }
    }
    return { ok, movidos, fallidos, sinOperacion, nGrupos: Object.keys(grupos).length };
  };

  const publicarUno = async (f) => {
    setGuardando(f.case_id); setMsg(null);
    try {
      const r = await publicarAlPortal([f]);
      if (r.ok) setMsg({ ok: true, txt: `PNR ${f.case_id} publicado al portal del tercero.` });
      else setMsg({ ok: false, txt: `No se pudo resolver la empresa de la placa ${f.placa || "—"}: revisá el inventario de flota.` });
      await cargar(semanaCobro, true);
    } catch (e) { setMsg({ ok: false, txt: "No se pudo publicar: " + (e.message || e) }); }
    setGuardando(null);
  };

  // Fuerza el cobro en un SC elegido por el analista. Sirve cuando la empresa
  // no tiene operación en el SC del PNR, o directamente no operó esa semana.
  const agregarForzando = async (f) => {
    if (!f.empresa) {
      setMsg({ ok: false, txt: `El PNR ${f.case_id} no tiene empresa resuelta.` });
      return;
    }
    const { data: conc } = await sb.from("conciliaciones_terceros")
      .select("service_center, n_viajes, estado")
      .eq("empresa_nombre", f.empresa).eq("semana", semanaCobro);
    const opciones = (conc || []).map(c => `${c.service_center} (${c.n_viajes || 0} viajes, ${c.estado})`);
    const sc = window.prompt(
      `¿En qué SC cobrar el PNR ${f.case_id}?\n\n${f.empresa} · semana ${semanaCobro}\nEl PNR corresponde a ${f.service_center}.\n\n` +
      (opciones.length
        ? `Prefacturas de esta empresa en la semana:\n${opciones.join("\n")}`
        : `Esta empresa NO tiene prefactura en la semana ${semanaCobro}. Si escribís un SC igual, se va a crear una prefactura solo con este descuento y el líquido va a quedar en negativo.`),
      opciones.length ? String(conc[0].service_center) : f.service_center || ""
    );
    if (!sc || !sc.trim()) return;
    setGuardando(f.case_id); setMsg(null);
    const r = await ejecutarCobros([f], sc.trim().toUpperCase());
    setMsg(r.fallidos.length
      ? { ok: false, txt: `No se pudo cobrar en ${r.fallidos.join(", ")}.` }
      : { ok: !!r.ok, txt: r.ok
          ? `PNR ${f.case_id} cobrado en ${sc.trim().toUpperCase()} por decisión del analista. La prefactura volvió a borrador.`
          : `Esa prefactura ya tenía la línea del PNR ${f.case_id}.` });
    setGuardando(null);
    await cargar(semana, true);
  };

  const agregar = async (f) => {
    const porQue = bloqueo(f);
    if (porQue) {
      setMsg({ ok: false, txt: `No se puede cobrar el PNR ${f.case_id}: ${porQue}.` });
      return;
    }
    const monto = Math.abs(Number(f.monto || 0));
    if (!window.confirm(
      `¿Agregar este cobro a la conciliación?\n\n${f.empresa} · ${f.service_center} · se cobra en la semana ${semanaCobro}\nPNR ${f.case_id} · guía ${f.shipment_id || "—"} · ruta ${f.route_id || "—"}\nMonto: -${money(monto)}\n\nSi la empresa no operó en ese SC esa semana, se cobra en otro y queda anotado en la línea.`
    )) return;
    setGuardando(f.case_id); setMsg(null);
    const r = await ejecutarCobros([f]);
    if (r.sinOperacion.length) {
      setMsg({ ok: false, txt: `${f.empresa} no tiene operación en la semana ${semanaCobro}, así que no hay prefactura donde descontar el PNR ${f.case_id}.` });
    } else if (r.fallidos.length) {
      setMsg({ ok: false, txt: `No se pudo agregar el cobro en ${r.fallidos.join(", ")}.` });
    } else if (!r.ok) {
      setMsg({ ok: false, txt: `Esa prefactura ya tenía la línea del PNR ${f.case_id}.` });
    } else {
      setMsg({ ok: true, txt: `PNR ${f.case_id} agregado por -${money(monto)}${r.movidos ? " (cobrado en otro SC por falta de operación)" : ""}. La prefactura volvió a borrador: generala y enviala.` });
    }
    setGuardando(null);
    await cargar(semana, true);
  };

  // Carga de una pasada los pendientes tildados.
  const agregarSeleccionados = async () => {
    const lista = pendientes.filter(f => seleccion[f.case_id] && !bloqueo(f));
    if (!lista.length) {
      setMsg({ ok: false, txt: "No hay casos tildados que se puedan cobrar." });
      return;
    }
    const totalMonto = lista.reduce((a, f) => a + Math.abs(Number(f.monto || 0)), 0);
    if (!window.confirm(
      `¿Agregar ${lista.length} cobros de PNR?\n\nTotal: -${money(totalMonto)}\nSe cobran en la semana ${semanaCobro}.\n\nLas prefacturas afectadas vuelven a borrador y hay que generarlas de nuevo.`
    )) return;
    setGuardando("todos"); setMsg(null);
    const r = await ejecutarCobros(lista);
    setMsg({
      ok: !r.fallidos.length && !r.sinOperacion.length,
      txt: `${r.ok} cobros agregados en ${r.nGrupos - r.fallidos.length} prefacturas.`
        + (r.movidos ? ` ${r.movidos} se cobraron en otro SC por falta de operación.` : "")
        + (r.sinOperacion.length ? ` Sin operación en la semana: ${r.sinOperacion.join(", ")}.` : "")
        + (r.fallidos.length ? ` Fallaron: ${r.fallidos.join(", ")}.` : " Generá y enviá las prefacturas afectadas."),
    });
    setGuardando(null);
    await cargar(semana, true);
  };

  // Deshace un cobro: saca la línea de la conciliación y libera el caso para
  // volver a cobrarlo. Usa la empresa, SC y semana con que se cobró, no las
  // que se ven ahora, porque el inventario de flota pudo haber cambiado.
  // ── Quitar solo del portal (carril B) ────────────────────────────────────
  // Borra el registro de cobros_pnr_mx, que es lo que ve el tercero y lo que
  // alimenta la prefactura diaria. No toca la conciliación semanal: si el cobro
  // también está en el carril A, hay que quitarlo de ahí por separado.
  const quitarDelPortal = async (f, ya) => {
    if (!window.confirm(
      `¿Quitar este cobro del portal del tercero?\n\nPNR ${f.case_id} · ${ya.empresa_nombre} · -${money(ya.monto)}\n\n` +
      `Deja de verse en sus movimientos y sale de la prefactura diaria.\n` +
      `Si también está en la prefactura semanal, hay que quitarlo desde ahí.`
    )) return;
    setGuardando(f.case_id); setMsg(null);
    try {
      const { error } = await sb.from("cobros_pnr_mx").delete().eq("pnr_id", String(f.case_id));
      if (error) throw error;
      setMsg({ ok: true, txt: `PNR ${f.case_id} quitado del portal. El caso vuelve a quedar pendiente.` });
      await cargar(semanaCobro, true);
    } catch (e) { setMsg({ ok: false, txt: "No se pudo quitar: " + (e.message || e) }); }
    setGuardando(null);
  };

  const quitar = async (f, ya) => {
    const sc = ya.service_center;
    const sem = Number(ya.semana);
    const { data: conc } = await sb.from("conciliaciones_terceros")
      .select("detalle, total_cobros, estado")
      .eq("empresa_nombre", ya.empresa_nombre).eq("service_center", sc).eq("semana", sem).maybeSingle();

    const enviada = conc && String(conc.estado || "").toLowerCase() === "enviada";
    if (!window.confirm(
      `¿Quitar este cobro?\n\nPNR ${f.case_id} · ${ya.empresa_nombre} · ${sc} · semana ${sem}\nMonto: -${money(ya.monto)}\n` +
      (enviada ? `\n⚠ Esta prefactura YA FUE ENVIADA al transportista. Va a volver a borrador y hay que generarla y enviarla de nuevo.\n` : "") +
      `\nEl caso vuelve a quedar pendiente y se puede cobrar otra vez.`
    )) return;

    setGuardando(f.case_id); setMsg(null);
    try {
      const idLinea = `pnr|${f.case_id}`;
      if (conc && Array.isArray(conc.detalle) && conc.detalle.length) {
        const quedan = conc.detalle.filter(d => lineaId(d) !== idLinea);
        if (quedan.length !== conc.detalle.length) {
          const { inicio } = rangoSemana(sem);
          const tot = recalcSC(quedan, Number(conc.total_cobros || 0));
          const { error: eUp } = await sb.from("conciliaciones_terceros").upsert({
            empresa_nombre: ya.empresa_nombre, service_center: sc, semana: sem,
            semana_inicio: inicio.toISOString().slice(0, 10), estado: "borrador",
            total_neto: tot.neto, iva_16: tot.iva, total_bruto: tot.bruto,
            total_cobros: tot.cobros, liquido_pago: tot.liquido,
            n_viajes: tot.nViajes, n_no_pago: tot.nNoPago,
            detalle: quedan, tiene_ajustes: true,
            generado_at: new Date().toISOString(),
          }, { onConflict: "empresa_nombre,service_center,semana" });
          if (eUp) throw eUp;

          await sb.from("conciliacion_terceros_ajustes").insert({
            empresa_nombre: ya.empresa_nombre, service_center: sc, semana: sem,
            accion: "eliminar", origen_linea: "pnr",
            linea: conc.detalle.find(d => lineaId(d) === idLinea) || null,
            motivo: `Cobro de PNR ${f.case_id} revertido desde la pestaña PNR`,
            usuario: quien,
          });
        }
      }

      const { error: eDel } = await sb.from("cobros_pnr_mx").delete().eq("pnr_id", String(f.case_id));
      if (eDel) throw eDel;

      setMsg({ ok: true, txt: `Cobro del PNR ${f.case_id} quitado de ${ya.empresa_nombre} · ${sc}. El caso vuelve a estar pendiente.` });
      await cargar(semana, true);
    } catch (e) {
      console.error("quitar cobro PNR:", e);
      setMsg({ ok: false, txt: "No se pudo quitar el cobro: " + (e.message || e) });
    }
    setGuardando(null);
  };

  const exportar = async () => {
    const enc = ["PNR", "Motivo del cobro", "Pasó a cobro", "Monto", "Chofer", "Placa", "SC",
      "ID ruta", "Ruta", "Fecha ruta", "Semana ruta", "Guía", "Empresa transportista",
      "Estado", "Cobrado por", "Cobrado el", "Semana cobro", "Avisos"];
    const datos = [enc];
    const avisos = [["PNR", "Tipo", "Destino", "Fecha", "Horas restantes", "Estado entrega"]];
    for (const f of visibles) {
      const ya = cobrados[String(f.case_id)];
      const m = MOTIVOS[f.sub_cobro] || {};
      datos.push([
        f.case_id, m.label || f.sub_cobro || "", fechaHora(f.facturado_en), Number(f.monto || 0),
        f.conductor || "", f.placa || "", f.service_center || "",
        f.route_id || "", f.route_code || "", f.fecha_ruta ? soloFecha(f.fecha_ruta) : "",
        f.semana_ruta != null ? f.semana_ruta : "", f.shipment_id || "", f.empresa || "",
        ya ? "Cobrado" : "Pendiente", ya ? ya.asignado_por : "",
        ya ? fechaHora(ya.enviado_a_cobro_en) : "", ya ? ya.semana : "",
        (f.avisos || []).length,
      ]);
      for (const a of f.avisos || []) {
        avisos.push([f.case_id, a.tipo || "", a.destino || "", fechaHora(a.creado_en),
          a.horas_restantes != null ? a.horas_restantes : "", a.estado_entrega || ""]);
      }
    }
    await descargarExcelMultihoja(
      [{ nombre: `PNR sem ${semana}`, datos }, { nombre: "Avisos", datos: avisos }],
      `PNR_cobros_sem${semana}.xlsx`
    );
  };

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    if (!q) return filas;
    return filas.filter(f => [f.case_id, f.conductor, f.placa, f.service_center, f.route_id, f.route_code, f.shipment_id, f.empresa]
      .some(v => String(v || "").toUpperCase().includes(q)));
  }, [filas, busqueda]);

  const pendientes = visibles.filter(f => !cobrados[String(f.case_id)] && f.sub_cobro);
  const yaNoCobrables = visibles.filter(f => !cobrados[String(f.case_id)] && !f.sub_cobro).length;
  const totalPend = pendientes.reduce((s, f) => s + Number(f.monto || 0), 0);
  const sinEmpresa = pendientes.filter(f => !f.empresa).length;
  const cobrables = pendientes.filter(f => !bloqueo(f));
  const nSeleccionados = cobrables.filter(f => seleccion[f.case_id]).length;
  const todosTildados = cobrables.length > 0 && nSeleccionados === cobrables.length;
  const nFacturados = pendientes.filter(f => f.sub_cobro === "BILLED").length;
  const nSinComprobante = pendientes.filter(f => f.sub_cobro === "WITHOUT_RECEIPT").length;

  return (
    <div style={{ padding: 24, fontFamily: "Geist, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>PNR — cobro a terceros</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            PNR que se volvieron cobrables en esta semana, por envío a facturación o por quedar sin comprobante cargado. Cada caso aparece en una sola semana. Agregar carga el cobro en la conciliación como línea negativa.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setSemana(s => s - 1)}
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, cursor: "pointer" }}>
          ←
        </button>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#1a3a6b", minWidth: 150, textAlign: "center" }}>
          Semana {semana}
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400 }}>{etiquetaSemana(semana)}</div>
        </div>
        <button onClick={() => setSemana(s => s + 1)}
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, cursor: "pointer" }}>
          →
        </button>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar caso, chofer, placa…"
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 6, width: 220 }} />
        <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
          Cobrar en semana
          <input type="number" value={semanaCobro}
            onChange={e => setSemanaCobro(Number(e.target.value) || semanaCobro)}
            style={{ width: 64, padding: "5px 6px", fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 6 }} />
        </div>
        <button onClick={exportar} disabled={loading || !visibles.length}
          style={{ padding: "7px 14px", fontSize: 11, fontWeight: 600, background: "#fff", color: "#1a3a6b", border: "1px solid #1a3a6b", borderRadius: 6, cursor: (loading || !visibles.length) ? "not-allowed" : "pointer", opacity: (loading || !visibles.length) ? 0.5 : 1 }}>
          Descargar Excel
        </button>
        <button onClick={agregarSeleccionados} disabled={!!guardando || loading || !nSeleccionados}
          title="Agrega los casos tildados que tengan empresa resuelta"
          style={{ padding: "7px 14px", fontSize: 11, fontWeight: 700, background: "#15803d", color: "#fff", border: "none", borderRadius: 6, cursor: (!!guardando || loading || !nSeleccionados) ? "not-allowed" : "pointer", opacity: (!!guardando || loading || !nSeleccionados) ? 0.5 : 1 }}>
          {guardando === "todos" ? "Agregando…" : `Agregar seleccionados (${nSeleccionados})`}
        </button>
        <button onClick={() => cargar(semana)} disabled={loading}
          style={{ padding: "7px 14px", fontSize: 11, fontWeight: 600, background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1 }}>
          {loading ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Pendientes de cobro" valor={pendientes.length} sub={`${visibles.length} cobrables en la semana`} />
        <Kpi label="Enviados a facturación" valor={nFacturados} />
        <Kpi label="Sin comprobante cargado" valor={nSinComprobante} sub={nSinComprobante ? "el supervisor respondió sin foto" : "ninguno esta semana"} />
        <Kpi label="Monto por cobrar" valor={money(totalPend)} sub="suma del valor del paquete" />
        <Kpi label="Sin empresa" valor={sinEmpresa} sub={sinEmpresa ? "requieren revisar la placa" : "todos resueltos"} />
        {yaNoCobrables ? <Kpi label="Ya no cobrables" valor={yaNoCobrables} sub="cambiaron de estado en MELI" /> : null}
      </div>

      {msg ? (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 6, fontSize: 12,
          background: msg.ok ? "#e8f5e9" : "#fdecea", color: msg.ok ? "#1b5e20" : "#7f1d1d",
        }}>{msg.txt}</div>
      ) : null}

      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 54, whiteSpace: "nowrap" }} title="Marca o desmarca todos los pendientes de la lista, incluidos los que no se ven en pantalla">
                <span style={{ fontWeight: 700, color: nSeleccionados ? "#15803d" : "#94a3b8", marginRight: 4 }}>
                  {nSeleccionados}/{cobrables.length}
                </span>
                <input type="checkbox" checked={todosTildados}
                  onChange={e => {
                    const v = e.target.checked; const sel = { ...seleccion };
                    for (const f of cobrables) sel[f.case_id] = v;
                    setSeleccion(sel);
                  }} />
              </th>
              <th style={th}>PNR</th>
              <th style={th}>Motivo del cobro</th>
              <th style={th}>Pasó a cobro</th>
              <th style={{ ...th, textAlign: "right" }}>Monto</th>
              <th style={th}>Chofer</th>
              <th style={th}>Placa</th>
              <th style={th}>SC</th>
              <th style={th}>Ruta</th>
              <th style={th}>Empresa transportista</th>
              <th style={th}>Avisos</th>
              <th style={{ ...th, textAlign: "right" }}>Cobro</th>
            </tr>
          </thead>
          <tbody>
            {!loading && !visibles.length ? (
              <tr><td style={{ ...td, textAlign: "center", color: "#94a3b8", padding: 30 }} colSpan={12}>
                Sin PNR facturados en esta semana.
              </td></tr>
            ) : null}
            {visibles.map(f => {
              const ya = cobrados[String(f.case_id)];
              return (
                <Fragment key={f.case_id}>
                  <tr style={{ background: abierto === f.case_id ? "#f8fafc" : (ya ? "#fbfdfb" : "transparent") }}>
                    <td style={td}>
                      {!ya && !bloqueo(f) ? (
                        <input type="checkbox" checked={!!seleccion[f.case_id]}
                          onChange={e => setSeleccion(s2 => ({ ...s2, [f.case_id]: e.target.checked }))} />
                      ) : null}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {f.case_id}
                      {f.shipment_id ? (
                        <div style={{ fontSize: 9.5, color: "#64748b", fontWeight: 400 }}>guía {f.shipment_id}</div>
                      ) : null}
                      {f.sin_avisos ? (
                        <div style={{ fontSize: 9, color: "#b45309", fontWeight: 600 }}>nació facturado</div>
                      ) : null}
                    </td>
                    <td style={td}><ChipMotivo sub={f.sub_cobro} estadoActual={f.sub_estado} />
                      {!f.sub_cobro ? (
                        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{f.sub_estado || "—"}</div>
                      ) : null}</td>
                    <td style={td}>{fechaHora(f.facturado_en)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(f.monto)}</td>
                    <td style={td}>{f.conductor || "—"}</td>
                    <td style={td}>{f.placa || <span style={{ color: "#b45309" }}>sin placa</span>}</td>
                    <td style={td}>{f.service_center || "—"}</td>
                    <td style={td}>
                      {f.route_id || "—"}
                      <div style={{ fontSize: 9, color: "#94a3b8" }}>
                        {f.route_code || ""}
                      </div>
                      <div style={{ fontSize: 9, color: "#94a3b8" }}>
                        {soloFecha(f.fecha_ruta)}{f.semana_ruta != null ? ` · sem ${f.semana_ruta}` : ""}
                      </div>
                    </td>
                    <td style={td}>
                      {f.empresa
                        ? f.empresa
                        : <span style={{ color: "#b45309", fontWeight: 600 }}>por asignar</span>}
                    </td>
                    <td style={{ ...td, cursor: "pointer" }} onClick={() => setAbierto(abierto === f.case_id ? null : f.case_id)}>
                      {f.sin_avisos
                        ? <span style={{ fontSize: 10, color: "#94a3b8" }}>sin avisos</span>
                        : f.resumen_avisos.map(([tipo, n]) => <ChipResumen key={tipo} label={tipo} n={n} />)}
                      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>
                        {abierto === f.case_id ? "ocultar detalle" : "ver detalle"}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      {ya ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {/* CARRIL B · portal */}
                          <div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: "#92400e" }}>✓ en el portal</div>
                            <div style={{ fontSize: 8.5, color: "#94a3b8" }}>{ya.empresa_nombre}</div>
                            <button onClick={() => quitarDelPortal(f, ya)} disabled={guardando === f.case_id}
                              title="Solo del portal del tercero y de la prefactura diaria."
                              style={{ marginTop: 3, width: "100%", padding: "3px 8px", fontSize: 9.5, fontWeight: 700,
                                borderRadius: 5, border: "1px solid #f59e0b", background: "#fffbeb", color: "#92400e",
                                cursor: guardando === f.case_id ? "not-allowed" : "pointer" }}>
                              {guardando === f.case_id ? "…" : "Quitar del portal"}
                            </button>
                          </div>

                          {/* CARRIL A · prefactura semanal */}
                          <div>
                            {enPrefactura[String(f.case_id)] ? (
                              <>
                                <div style={{ fontSize: 9.5, fontWeight: 700, color: "#1b5e20" }}>✓ en prefactura</div>
                                <div style={{ fontSize: 8.5, color: "#94a3b8" }}>
                                  {ya.service_center} · sem {ya.semana} · {ya.asignado_por}
                                </div>
                                <button onClick={() => quitar(f, ya)} disabled={guardando === f.case_id}
                                  style={{ marginTop: 3, width: "100%", padding: "3px 8px", fontSize: 9.5, fontWeight: 700,
                                    borderRadius: 5, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c",
                                    cursor: guardando === f.case_id ? "not-allowed" : "pointer" }}>
                                  {guardando === f.case_id ? "…" : "Quitar de prefactura"}
                                </button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => agregar(f)} disabled={guardando === f.case_id || !f.empresa || !f.sub_cobro}
                                  title="Agregar como línea negativa a la prefactura de la semana"
                                  style={{ width: "100%", padding: "5px 10px", fontSize: 10.5, fontWeight: 700, borderRadius: 6, border: "none",
                                    background: (f.empresa && f.sub_cobro) ? "#1a3a6b" : "#e4e7ec",
                                    color: (f.empresa && f.sub_cobro) ? "#fff" : "#94a3b8",
                                    cursor: (guardando === f.case_id || !f.empresa || !f.sub_cobro) ? "not-allowed" : "pointer" }}>
                                  {guardando === f.case_id ? "…" : "Agregar a prefactura"}
                                </button>
                                <div style={{ fontSize: 8.5, color: "#94a3b8", textAlign: "center", marginTop: 2 }}>semanal · carril A</div>
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {/* CARRIL B · portal: la empresa la resuelve el modelo diario */}
                          <div>
                            <button onClick={() => publicarUno(f)} disabled={guardando === f.case_id || !f.placa || !f.sub_cobro}
                              title={!f.sub_cobro ? "El caso ya no está en un estado cobrable"
                                : !f.placa ? "Sin placa no se puede resolver la empresa"
                                : "El tercero lo ve hoy en su portal. La empresa se resuelve por la placa, igual que el pago."}
                              style={{
                                width: "100%", padding: "5px 10px", fontSize: 10.5, fontWeight: 700, borderRadius: 6,
                                border: "1px solid #f59e0b",
                                background: (f.placa && f.sub_cobro) ? "#fffbeb" : "#f8fafc",
                                color: (f.placa && f.sub_cobro) ? "#92400e" : "#94a3b8",
                                cursor: (guardando === f.case_id || !f.placa || !f.sub_cobro) ? "not-allowed" : "pointer",
                              }}>
                              {guardando === f.case_id ? "…" : "Publicar al portal"}
                            </button>
                            <div style={{ fontSize: 8.5, color: "#94a3b8", textAlign: "center", marginTop: 2 }}>diario · carril B</div>
                          </div>

                          {/* CARRIL A · prefactura del lunes: la empresa la asigna el analista */}
                          <div>
                            <button onClick={() => agregar(f)} disabled={guardando === f.case_id || !f.empresa || !f.sub_cobro}
                              title={!f.sub_cobro ? "El caso ya no está en un estado cobrable" : (!f.empresa ? "Falta resolver la empresa transportista" : "Agregar como línea negativa a la prefactura de la semana")}
                              style={{
                                width: "100%", padding: "5px 10px", fontSize: 10.5, fontWeight: 700, borderRadius: 6, border: "none",
                                background: (f.empresa && f.sub_cobro) ? "#1a3a6b" : "#e4e7ec", color: (f.empresa && f.sub_cobro) ? "#fff" : "#94a3b8",
                                cursor: (guardando === f.case_id || !f.empresa || !f.sub_cobro) ? "not-allowed" : "pointer",
                              }}>
                              {guardando === f.case_id ? "…" : "Agregar a prefactura"}
                            </button>
                            <div style={{ fontSize: 8.5, color: "#94a3b8", textAlign: "center", marginTop: 2 }}>semanal · carril A</div>
                            <div onClick={() => guardando ? null : agregarForzando(f)}
                              title="Elegir a mano el SC donde se descuenta"
                              style={{ marginTop: 2, fontSize: 9, color: "#1a3a6b", textDecoration: "underline", cursor: guardando ? "default" : "pointer", textAlign: "center" }}>
                              forzar SC
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                  {abierto === f.case_id ? (
                    <tr>
                      <td colSpan={12} style={{ padding: "10px 14px 14px 14px", background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>
                          Historial de avisos
                        </div>
                        <DetalleAvisos lista={f.avisos} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
