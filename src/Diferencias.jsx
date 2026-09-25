// ═══════════════════════════════════════════════════════════════════════════
// Diferencias.jsx — Bandeja de reclamos que levantan los terceros desde su
// portal, sobre pagos y cobros.
//
// Cada caso tiene folio, líneas (rutas, cobros, o rutas que faltan), evidencia
// y una bitácora completa. El analista resuelve línea por línea: lo aceptado
// no reabre el pasado, viaja como ajuste a la prefactura vigente.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "./shared";

const ESTADOS = {
  abierta:     { l: "Abierta",     bg: "#fef3c7", fg: "#92400e" },
  en_revision: { l: "En revisión", bg: "#dbeafe", fg: "#1e40af" },
  aceptada:    { l: "Aceptada",    bg: "#dcfce7", fg: "#166534" },
  parcial:     { l: "Parcial",     bg: "#e0e7ff", fg: "#3730a3" },
  rechazada:   { l: "Rechazada",   bg: "#fee2e2", fg: "#991b1b" },
  vencida:     { l: "Vencida",     bg: "#f1f5f9", fg: "#64748b" },
};
const TIPO_LINEA = { ruta: "Ruta", cobro: "Cobro", faltante: "Ruta faltante" };
const FASES = {
  supervisor: { l: "Con el supervisor", bg: "#fef3c7", fg: "#92400e" },
  analista:   { l: "Te toca a ti",      bg: "#dbeafe", fg: "#1e40af" },
  cerrada:    { l: "Cerrada",           bg: "#f1f5f9", fg: "#64748b" },
};
const VEREDICTO = {
  aprueba:        { l: "El supervisor RESPALDA el reclamo", bg: "#dcfce7", fg: "#166534" },
  rechaza:        { l: "El supervisor NO lo respalda",      bg: "#fee2e2", fg: "#991b1b" },
  sin_respuesta:  { l: "El supervisor no respondió en 48 h", bg: "#fef3c7", fg: "#92400e" },
};
const venceEn = (iso) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { vencido: true, txt: "SLA vencido" };
  const h = Math.floor(ms / 3600000);
  return { vencido: false, txt: h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h` };
};

const money = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaHora = (s) => s ? new Date(s).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
// ── Qué se reclama, en palabras ─────────────────────────────────────────────
// El tipo de línea solo ("Cobro", "Ruta") no alcanza: el analista y el
// supervisor tienen que leer de una vez si el tercero pide que le paguen algo
// o que le devuelvan un descuento, y qué pasa con la plata si se acepta.
const RECLAMO = {
  ruta:     { t: "Reclama el PAGO de una ruta", d: "Dice que la ruta se le pagó mal. Si se acepta, se le paga la diferencia.", bg: "#dbeafe", fg: "#1e40af", verbo: "pagan" },
  faltante: { t: "Reclama una RUTA QUE NO SE LE PAGÓ", d: "Dice que hizo esta ruta y no le aparece. Si se acepta, se le paga.", bg: "#dbeafe", fg: "#1e40af", verbo: "pagan" },
  cobro:    { t: "Reclama un DESCUENTO que se le aplicó", d: "No está de acuerdo con que se le cobre esto. Si se acepta, se le devuelve.", bg: "#fee2e2", fg: "#991b1b", verbo: "devuelven" },
};

// Los cobros viven en tres tablas y el id solo no dice en cuál. Si la línea
// trae el origen se usa; las anteriores a ese campo eran todas PNR.
const origenCobro = (o) => {
  const x = String(o || "").toLowerCase();
  if (x.includes("show")) return "noshow";
  if (x.includes("merma") || x.includes("robo") || x.includes("extrav") || x.includes("perdid")) return "merma";
  return "pnr";
};
const TABLA_COBRO = { pnr: "cobros_pnr_mx", noshow: "cobros_noshow_mx", merma: "cobros_merma_mx" };

async function cargarCobros(lineas) {
  const porTabla = {};
  for (const l of lineas.filter(l => l.tipo === "cobro" && l.cobro_id != null)) {
    const t = TABLA_COBRO[origenCobro(l.cobro_origen)];
    (porTabla[t] = porTabla[t] || []).push(l.cobro_id);
  }
  const out = {};
  await Promise.all(Object.entries(porTabla).map(async ([tabla, ids]) => {
    const { data } = await sb.from(tabla).select("*").in("id", ids);
    for (const r of (data || [])) out[`${tabla}:${r.id}`] = { ...r, _tabla: tabla };
  }));
  return out;
}
const cobroDe = (cobros, l) => cobros[`${TABLA_COBRO[origenCobro(l.cobro_origen)]}:${l.cobro_id}`] || null;

// Numeración del Brain: ISO + 1, con la fecha de México.
function semanaBrainDe(iso) {
  const d = new Date(String(iso).length <= 10 ? iso + "T12:00:00" : iso);
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dn);
  const ini = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - ini) / 86400000 + 1) / 7) + 1;
}
const hoyMx = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);

// Semana en que el cobro entró a la prefactura del tercero.
const semanaCobro = (c) => c?.semana || c?.aplicado_semana || (c?.facturado_en ? String(semanaBrainDe(c.facturado_en)) : null);

const dias = (s) => s ? Math.floor((Date.now() - new Date(s).getTime()) / 86400000) : 0;

export default function Diferencias({ usuario }) {
  const [filtro, setFiltro] = useState("pendientes");
  const [casos, setCasos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [sel, setSel] = useState(null);   // caso abierto (con líneas y eventos)
  const quien = (usuario && (usuario.email || usuario.nombre)) || "brain";

  const cargar = useCallback(async () => {
    setCargando(true);
    let q = sb.from("diferencias")
      .select("*, terceros(nombre), diferencias_lineas(id, tipo, estado, monto_ref)")
      .order("creada_at", { ascending: false });
    if (filtro === "pendientes") q = q.in("estado", ["abierta", "en_revision"]);
    else if (filtro !== "todas") q = q.eq("estado", filtro);
    const { data, error } = await q;
    if (error) console.error(error);
    setCasos(data || []);
    setCargando(false);
  }, [filtro]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrir = async (caso) => {
    const [lin, ev, adj] = await Promise.all([
      sb.from("diferencias_lineas").select("*").eq("diferencia_id", caso.id),
      sb.from("diferencias_eventos").select("*").eq("diferencia_id", caso.id).order("created_at"),
      sb.from("diferencias_adjuntos").select("*").eq("diferencia_id", caso.id),
    ]);
    const lineas = lin.data || [];

    // El comentario del tercero no basta para decidir: se trae lo que el motor
    // calculó para esa ruta y quién era el supervisor del centro ese día.
    const rutas = lineas.filter(l => l.id_ruta).map(l => l.id_ruta);
    let detalleRuta = {};
    if (rutas.length) {
      const { data } = await sb.from("tarifado_mx")
        .select("id_ruta, fecha, placa, driver_name, service_center_id, ns_pct, pct_visitado, ns_categoria, km_pago, tiene_auxiliar, monto_auxiliar, pago_neto, tarifa_base, empresa_nombre")
        .in("id_ruta", rutas);
      for (const r of (data || [])) detalleRuta[r.id_ruta] = r;
    }
    const scs = [...new Set([...Object.values(detalleRuta).map(r => r.service_center_id), caso.service_center].filter(Boolean))];
    let supervisores = {};
    if (scs.length) {
      const { data } = await sb.from("padron_sc_supervisor").select("sc, supervisor, email").in("sc", scs);
      for (const r of (data || [])) supervisores[r.sc] = r;
    }
    const cobros = await cargarCobros(lineas);
    setSel({ ...caso, lineas, eventos: ev.data || [], adjuntos: adj.data || [], detalleRuta, supervisores, cobros });
  };

  const pendientes = casos.filter(c => ["abierta", "en_revision"].includes(c.estado)).length;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>Diferencias</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            Reclamos de los terceros sobre pagos y cobros. Lo aceptado entra como ajuste en la prefactura vigente.
          </div>
        </div>
        {pendientes > 0 && (
          <span style={{ background: "#fef3c7", color: "#92400e", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 14 }}>
            {pendientes} sin resolver
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {[["pendientes", "Sin resolver"], ["aceptada", "Aceptadas"], ["parcial", "Parciales"],
          ["rechazada", "Rechazadas"], ["todas", "Todas"]].map(([id, l]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{
              padding: "6px 14px", borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1px solid " + (filtro === id ? "#1a3a6b" : "#e4e7ec"),
              background: filtro === id ? "#1a3a6b" : "#fff", color: filtro === id ? "#fff" : "#64748b",
            }}>{l}</button>
        ))}
        <button onClick={cargar} style={{ padding: "6px 14px", borderRadius: 16, fontSize: 12, border: "1px solid #e4e7ec", background: "#fff", color: "#64748b", cursor: "pointer" }}>
          ↻ Actualizar
        </button>
      </div>

      {cargando ? (
        <div style={{ color: "#94a3b8", fontSize: 13, padding: 40, textAlign: "center" }}>Cargando…</div>
      ) : casos.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          No hay diferencias {filtro === "pendientes" ? "sin resolver" : "en este filtro"}.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "70px 1.6fr 90px 1fr 110px 110px 100px", gap: 10, padding: "9px 14px", background: "#f8fafc", fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>
            <span>Folio</span><span>Empresa</span><span>SC</span><span>Líneas</span>
            <span style={{ textAlign: "right" }}>Reclamado</span><span>Fase</span><span>SLA</span>
          </div>
          {casos.map(c => {
            const e = ESTADOS[c.estado] || ESTADOS.abierta;
            const d = dias(c.creada_at);
            const sinResolver = ["abierta", "en_revision"].includes(c.estado);
            return (
              <button key={c.id} onClick={() => abrir(c)}
                style={{ width: "100%", display: "grid", gridTemplateColumns: "70px 1.6fr 90px 1fr 110px 110px 100px", gap: 10, padding: "11px 14px", borderTop: "1px solid #f1f5f9", background: "#fff", border: "none", borderLeft: "3px solid " + (sinResolver && venceEn(c.fase === "analista" ? c.sla_analista_at : c.sla_supervisor_at)?.vencido ? "#dc2626" : "transparent"), textAlign: "left", fontSize: 12, alignItems: "center", cursor: "pointer" }}>
                <span style={{ fontWeight: 700, color: "#1a3a6b" }}>#{c.folio}</span>
                <span style={{ color: "#334155" }}>{c.terceros?.nombre || "—"}</span>
                <span style={{ color: "#64748b" }}>{c.service_center || "varios"}</span>
                <span style={{ color: "#64748b" }}>
                  {(c.diferencias_lineas || []).length} línea(s)
                  {" · "}
                  {[...new Set((c.diferencias_lineas || []).map(l => ({ ruta: "reclama un pago", faltante: "ruta que falta", cobro: "reclama un descuento" })[l.tipo] || l.tipo))].join(", ")}
                </span>
                <span style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{money(c.monto_reclamado)}</span>
                <span>
                  {sinResolver
                    ? (() => { const f = FASES[c.fase] || FASES.supervisor;
                        return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: f.bg, color: f.fg }}>{f.l}</span>; })()
                    : <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: e.bg, color: e.fg }}>{e.l}</span>}
                </span>
                {(() => {
                  const sla = sinResolver ? venceEn(c.fase === "analista" ? c.sla_analista_at : c.sla_supervisor_at) : null;
                  if (!sla) return <span style={{ color: "#94a3b8" }}>{d === 0 ? "hoy" : `${d} d`}</span>;
                  return <span style={{ color: sla.vencido ? "#dc2626" : "#64748b", fontWeight: sla.vencido ? 700 : 400 }}>{sla.vencido ? "vencido" : `quedan ${sla.txt}`}</span>;
                })()}
              </button>
            );
          })}
        </div>
      )}

      {sel && <DetalleCaso caso={sel} quien={quien} onCerrar={() => setSel(null)} onCambio={async () => { await cargar(); setSel(null); }} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function DetalleCaso({ caso, quien, onCerrar, onCambio }) {
  const { detalleRuta = {}, supervisores = {}, cobros = {} } = caso;
  const [lineas, setLineas] = useState(caso.lineas);
  const [eventos, setEventos] = useState(caso.eventos);
  const [nota, setNota] = useState("");
  const [interna, setInterna] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  const pendientes = lineas.filter(l => l.estado === "pendiente").length;
  const reconocido = lineas.reduce((s, l) => s + Number(l.monto_reconocido || 0), 0);

  const evento = async (tipo, detalle, visible = true) =>
    sb.from("diferencias_eventos").insert({ diferencia_id: caso.id, tipo, detalle, actor: quien, visible_tercero: visible });

  const resolverLinea = async (l, estado) => {
    let monto = null, resolucion = "";
    if (estado === "aceptada") {
      const pregunta = l.tipo === "cobro"
        ? `Aceptar el reclamo del descuento (${l.concepto || "cobro " + l.cobro_id}).\n\nMonto a DEVOLVER al tercero — entra como abono en la prefactura de la semana ${semanaBrainDe(hoyMx())}:`
        : `Aceptar el reclamo de pago (${TIPO_LINEA[l.tipo]} ${l.id_ruta || l.placa}).\n\nMonto a PAGAR al tercero — entra como abono en la prefactura de la semana ${semanaBrainDe(hoyMx())}:`;
      const m = prompt(pregunta, l.monto_ref || "");
      if (m === null) return;
      monto = Number(String(m).replace(/[^\d.\-]/g, ""));
      if (!isFinite(monto)) { alert("Monto inválido."); return; }
    }
    resolucion = prompt(`Respuesta para el tercero (la va a leer en su portal):`, "");
    if (resolucion === null) return;
    if (!resolucion.trim()) { alert("La respuesta es obligatoria: un 'rechazado' sin explicación mata el canal."); return; }

    setTrabajando(true);
    const { error } = await sb.from("diferencias_lineas")
      .update({ estado, monto_reconocido: monto, resolucion: resolucion.trim() }).eq("id", l.id);
    if (error) { alert("No se pudo guardar: " + error.message); setTrabajando(false); return; }
    // Aceptar sin generar el ajuste es aceptar en el papel: el tercero lee
    // "aceptada" y no le llega la plata. El movimiento se crea acá mismo, en
    // la fecha de hoy — entra en la semana donde efectivamente se paga, y la
    // semana que originó el reclamo (ya enviada) no se mueve.
    if (estado === "aceptada" && monto) {
      const hoy = hoyMx();   // en UTC, después de las 18 h de México ya sería mañana
      const sc = (l.id_ruta && detalleRuta[l.id_ruta]?.service_center_id) || caso.service_center;
      if (!sc) {
        alert("No se pudo determinar el centro de servicio del ajuste.\n\nLa línea quedó aceptada pero SIN ajuste: créalo a mano en la prefactura.");
      } else {
        const { error: eAj } = await sb.from("ajustes_pago_mx").insert({
          tercero_id: caso.tercero_id, service_center: sc,
          fecha: hoy, fecha_origen: l.fecha, monto,
          concepto: l.tipo === "cobro"
            ? `Devolución diferencia #${caso.folio} · ${l.concepto || "cobro " + l.cobro_id}${l.fecha ? ` · ruta del ${l.fecha}` : ""}`
            : `Diferencia #${caso.folio} · ${TIPO_LINEA[l.tipo]}${l.id_ruta ? ` ${l.id_ruta}` : ""}${l.fecha ? ` del ${l.fecha}` : ""}`,
          diferencia_id: caso.id, linea_id: l.id, creado_por: quien,
        });
        if (eAj) alert("La línea quedó aceptada, pero NO se generó el ajuste:\n\n" + eAj.message + "\n\nCréalo a mano en la prefactura.");
        else await evento("ajuste_generado", `${money(monto)} en la prefactura de ${sc} · ${hoy}`);
      }
    }

    await evento(estado === "aceptada" ? "linea_aceptada" : "linea_rechazada",
      `${TIPO_LINEA[l.tipo]} ${l.id_ruta || l.placa || ""}: ${resolucion.trim()}${monto ? ` · ${money(monto)}` : ""}`);
    const { data } = await sb.from("diferencias_lineas").select("*").eq("diferencia_id", caso.id);
    setLineas(data || []);
    const { data: ev } = await sb.from("diferencias_eventos").select("*").eq("diferencia_id", caso.id).order("created_at");
    setEventos(ev || []);
    setTrabajando(false);
  };

  const cerrarCaso = async () => {
    const acept = lineas.filter(l => l.estado === "aceptada").length;
    const rech = lineas.filter(l => l.estado === "rechazada").length;
    const estado = acept === 0 ? "rechazada" : rech === 0 ? "aceptada" : "parcial";
    // Los ajustes se crean con la fecha de hoy, así que entran en la semana en
    // curso: se propone esa y el analista solo la confirma.
    const semana = prompt(`Cerrar la diferencia #${caso.folio} como ${estado.toUpperCase()}.\n\n${acept} aceptada(s) · ${rech} rechazada(s) · ${money(reconocido)} reconocido\n\n¿En qué semana de prefactura entra el ajuste? (vacío si no aplica)`, acept > 0 ? String(semanaBrainDe(hoyMx())) : "");
    if (semana === null) return;
    setTrabajando(true);
    const { error } = await sb.from("diferencias").update({
      estado, fase: "cerrada", monto_reconocido: reconocido, ajuste_semana: semana.trim() || null,
      resuelta_por: quien, resuelta_at: new Date().toISOString(),
    }).eq("id", caso.id);
    if (error) { alert("No se pudo cerrar: " + error.message); setTrabajando(false); return; }
    await evento("cerrada", `Cerrada como ${estado}${semana.trim() ? ` · ajuste en semana ${semana.trim()}` : ""} · ${money(reconocido)} reconocido`);
    setTrabajando(false);
    onCambio();
  };

  const agregarNota = async () => {
    if (!nota.trim()) return;
    await evento("comentario", nota.trim(), !interna);
    const { data: ev } = await sb.from("diferencias_eventos").select("*").eq("diferencia_id", caso.id).order("created_at");
    setEventos(ev || []); setNota("");
  };

  const verAdjunto = async (a) => {
    const { data } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(a.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else alert("No se pudo abrir el adjunto.");
  };

  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(760px, 100%)", background: "#f8fafc", height: "100%", overflowY: "auto" }}>
        <div style={{ background: "#1a3a6b", color: "#fff", padding: "16px 20px", position: "sticky", top: 0, zIndex: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Diferencia #{caso.folio}</div>
              <div style={{ fontSize: 12.5, color: "#b8c6de", marginTop: 2 }}>
                {caso.terceros?.nombre} · {caso.service_center || "varios SC"} · abierta {fechaHora(caso.creada_at)}
              </div>
            </div>
            <button onClick={onCerrar} style={{ background: "#24457a", color: "#fff", border: "none", borderRadius: 6, width: 30, height: 30, fontSize: 16, cursor: "pointer" }}>×</button>
          </div>
        </div>

        <div style={{ padding: 18 }}>
          {/* Lo que dijo el supervisor: la mitad del expediente */}
          {caso.fase === "supervisor" ? (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12.5, color: "#92400e" }}>
              <b>Esperando al supervisor.</b> El caso llega a ti cuando él respalde o rechace el
              reclamo, o cuando venzan sus 48 h{caso.sla_supervisor_at ? ` (vence ${fechaHora(caso.sla_supervisor_at)})` : ""}.
            </div>
          ) : caso.supervisor_veredicto ? (
            (() => {
              const v = VEREDICTO[caso.supervisor_veredicto] || VEREDICTO.sin_respuesta;
              return (
                <div style={{ background: v.bg, border: "1px solid " + v.fg + "33", borderRadius: 8, padding: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: v.fg }}>{v.l}</div>
                  {caso.supervisor_nota && (
                    <div style={{ fontSize: 12.5, color: "#334155", marginTop: 5 }}>{caso.supervisor_nota}</div>
                  )}
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 5 }}>
                    {caso.supervisor_por || "—"} · {fechaHora(caso.supervisor_at)}
                    {caso.sla_analista_at && ` · tu SLA vence ${fechaHora(caso.sla_analista_at)}`}
                  </div>
                </div>
              );
            })()
          ) : null}

          {/* Líneas */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
            Qué reclama ({lineas.length})
          </div>
          {lineas.map(l => {
            const resuelta = l.estado !== "pendiente";
            return (
              <div key={l.id} style={{ background: "#fff", border: "1px solid " + (resuelta ? "#e4e7ec" : "#fcd34d"), borderRadius: 8, padding: 12, marginBottom: 8 }}>
                {(() => {
                  const r = RECLAMO[l.tipo] || RECLAMO.ruta;
                  return (
                    <div style={{ background: r.bg, borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: r.fg }}>{r.t}{l.monto_ref != null ? ` · ${money(l.monto_ref)}` : ""}</div>
                      <div style={{ fontSize: 11.5, color: "#334155", marginTop: 2 }}>{r.d}</div>
                    </div>
                  );
                })()}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 3, background: "#e2e8f0", color: "#475569" }}>
                      {TIPO_LINEA[l.tipo]}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginLeft: 8 }}>{l.placa || "—"}</span>
                    <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 8 }}>
                      {l.id_ruta ? `Ruta ${l.id_ruta}` : l.cobro_id ? `Cobro ${l.cobro_id}` : ""} · {l.tipo === "cobro" ? "ruta del " : ""}{l.fecha || "sin fecha"}
                    </span>
                  </div>
                  <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                    {l.monto_ref != null ? money(l.monto_ref) : "—"}
                  </span>
                </div>

                {(() => {
                  const d = l.id_ruta ? detalleRuta[l.id_ruta] : null;
                  const sup = supervisores[d?.service_center_id || caso.service_center];
                  if (!d && !sup) return null;
                  return (
                    <div style={{ marginTop: 8, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: "8px 10px", fontSize: 11.5 }}>
                      <div style={{ fontWeight: 700, color: "#075985", marginBottom: 4 }}>Lo que dice el sistema</div>
                      {d ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "4px 14px", color: "#334155" }}>
                          <span><b>Ruta</b> {d.id_ruta}</span>
                          <span><b>Día</b> {d.fecha}</span>
                          <span><b>Placa</b> {d.placa}</span>
                          <span><b>SC</b> {d.service_center_id}</span>
                          <span><b>Chofer</b> {d.driver_name || "—"}</span>
                          <span><b>Empresa</b> {d.empresa_nombre || "sin asignar"}</span>
                          <span><b>NS</b> {d.ns_pct != null ? Number(d.ns_pct).toFixed(1) + "%" : "—"}</span>
                          <span><b>Visitado</b> {d.pct_visitado != null ? Number(d.pct_visitado).toFixed(1) + "%" : "—"}</span>
                          <span><b>Categoría NS</b> {d.ns_categoria || "—"}</span>
                          <span><b>KM pago</b> {d.km_pago ?? "—"}</span>
                          <span><b>Tarifa base</b> {d.tarifa_base != null ? money(d.tarifa_base) : "—"}</span>
                          <span><b>Ayudante</b> {d.tiene_auxiliar ? money(d.monto_auxiliar) : "no"}</span>
                          <span><b>Pago neto</b> {money(d.pago_neto)}</span>
                        </div>
                      ) : (
                        <div style={{ color: "#b45309" }}>
                          Esta ruta no está en el tarifado de ese día — puede ser justamente lo que reclama.
                        </div>
                      )}
                      {sup && (
                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #bae6fd", color: "#075985" }}>
                          <b>Supervisor de {sup.sc}:</b> {sup.supervisor}{sup.email ? ` · ${sup.email}` : ""}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {l.tipo === "cobro" && <DetalleCobro l={l} c={cobroDe(cobros, l)} />}

                {!resuelta && <SiSeAcepta l={l} c={l.tipo === "cobro" ? cobroDe(cobros, l) : null} />}

                <div style={{ marginTop: 8, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 10px", fontSize: 12.5, color: "#334155" }}>
                  <b style={{ color: "#92400e" }}>Dice el tercero:</b> {l.comentario}
                </div>

                {resuelta ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: l.estado === "aceptada" ? "#166534" : "#991b1b" }}>
                    <b>{l.estado === "aceptada" ? "Aceptada" : "Rechazada"}{l.monto_reconocido ? ` · ${money(l.monto_reconocido)}` : ""}:</b> {l.resolucion}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <button onClick={() => resolverLinea(l, "aceptada")} disabled={trabajando}
                      style={{ border: "none", background: "#16a34a", color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                      Aceptar
                    </button>
                    <button onClick={() => resolverLinea(l, "rechazada")} disabled={trabajando}
                      style={{ border: "1px solid #fca5a5", background: "#fff", color: "#991b1b", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                      Rechazar
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Evidencia */}
          {caso.adjuntos.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", margin: "14px 0 8px" }}>
                Evidencia <span style={{ fontWeight: 400, fontSize: 11, color: "#94a3b8" }}>· la marcada [supervisor] la subió él en la Bitácora</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {caso.adjuntos.map(a => (
                  <button key={a.id} onClick={() => verAdjunto(a)}
                    style={{ border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, padding: "7px 12px", fontSize: 12, color: "#1a3a6b", cursor: "pointer" }}>
                    📎 {a.nombre || "adjunto"}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Cerrar */}
          {["abierta", "en_revision"].includes(caso.estado) && caso.fase === "analista" && (
            <button onClick={cerrarCaso} disabled={pendientes > 0 || trabajando}
              style={{ width: "100%", marginTop: 14, padding: "11px", borderRadius: 6, border: "none", background: pendientes > 0 ? "#cbd5e1" : "#1a3a6b", color: "#fff", fontSize: 13, fontWeight: 700, cursor: pendientes > 0 ? "not-allowed" : "pointer" }}>
              {pendientes > 0 ? `Falta resolver ${pendientes} línea(s)` : `Cerrar la diferencia · ${money(reconocido)} reconocido`}
            </button>
          )}

          {/* Bitácora */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", margin: "18px 0 8px" }}>Bitácora del caso</div>
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}>
            {eventos.map(ev => (
              <div key={ev.id} style={{ padding: "9px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "#334155" }}>
                    {ev.tipo.replace(/_/g, " ")}
                    {!ev.visible_tercero && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, background: "#e2e8f0", color: "#64748b", padding: "1px 6px", borderRadius: 3 }}>INTERNA</span>}
                  </span>
                  <span style={{ color: "#94a3b8", fontSize: 11 }}>{fechaHora(ev.created_at)}</span>
                </div>
                {ev.detalle && <div style={{ color: "#64748b", marginTop: 3 }}>{ev.detalle}</div>}
                <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>{ev.actor}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "flex-start" }}>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
              placeholder="Agregar una nota al caso…"
              style={{ flex: 1, border: "1px solid #e4e7ec", borderRadius: 6, padding: "8px 10px", fontSize: 12.5, resize: "vertical" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button onClick={agregarNota} style={{ border: "none", background: "#1a3a6b", color: "#fff", fontSize: 12, fontWeight: 600, borderRadius: 4, padding: "8px 14px", cursor: "pointer" }}>
                Agregar
              </button>
              <label style={{ fontSize: 10.5, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
                <input type="checkbox" checked={interna} onChange={e => setInterna(e.target.checked)} /> interna
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Qué es el descuento que reclama: sale de la tabla de cobros, no del texto
// del tercero.
function DetalleCobro({ l, c }) {
  const caja = { marginTop: 8, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: "8px 10px", fontSize: 11.5 };
  if (!c) return (
    <div style={caja}>
      <div style={{ fontWeight: 700, color: "#075985", marginBottom: 4 }}>Lo que dice el sistema</div>
      <div style={{ color: "#b45309" }}>No se encontró el cobro {l.cobro_id}. Puede haberse quitado de la prefactura después del reclamo.</div>
    </div>
  );
  const esPnr = c._tabla === "cobros_pnr_mx";
  const esNoShow = c._tabla === "cobros_noshow_mx";
  const concepto = esPnr ? (c.concepto || "PNR") : esNoShow ? "No show" : (c.motivo || "Paquete perdido");
  const sem = semanaCobro(c);
  return (
    <div style={caja}>
      <div style={{ fontWeight: 700, color: "#075985", marginBottom: 4 }}>Lo que dice el sistema</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "4px 14px", color: "#334155" }}>
        <span><b>Qué se cobró</b> {concepto}</span>
        {esPnr && <span><b>PNR</b> {c.pnr_id}</span>}
        {(c.shipment_id || c.guia) && <span><b>Guía</b> {c.shipment_id || c.guia}</span>}
        <span><b>{esNoShow ? "Día" : "Ruta del"}</b> {c.fecha_ruta || c.fecha_hecho || c.fecha || "—"}</span>
        <span><b>Placa</b> {c.placa || "—"}</span>
        {c.driver_name && <span><b>Chofer</b> {c.driver_name}</span>}
        <span><b>SC</b> {c.service_center || "—"}</span>
        <span><b>Monto</b> {money(c.monto)}</span>
        {c.facturado_en && <span><b>Pasó a facturación</b> {c.facturado_en}</span>}
        <span><b>Cobrado en</b> {sem ? `semana ${sem}` : "—"}</span>
        {c.asignado_por && <span><b>Lo cargó</b> {c.asignado_por}</span>}
        {c.justificacion && <span><b>Justificación</b> {c.justificacion}</span>}
      </div>
      {esPnr && /factur/i.test(c.concepto || "") && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #bae6fd", color: "#b45309" }}>
          <b>PNR facturado por MELI:</b> por regla no tiene reverso. Si lo devuelves al tercero, la plata la pone
          Bigticket, salvo que también se le reclame a MELI.
        </div>
      )}
    </div>
  );
}

// Qué pasa con la plata si el analista acepta, antes de que apriete el botón.
function SiSeAcepta({ l, c }) {
  const hoy = hoyMx();
  const semHoy = String(semanaBrainDe(hoy));
  const r = RECLAMO[l.tipo] || RECLAMO.ruta;
  const semCobro = c ? semanaCobro(c) : null;
  const semOrigen = l.fecha ? String(semanaBrainDe(l.fecha)) : null;
  let extra = "";
  if (l.tipo === "cobro" && semCobro) {
    extra = semCobro === semHoy
      ? ` El cobro también está en la semana ${semCobro}: en esa prefactura el descuento y la devolución se anulan.`
      : ` El cobro se aplicó en la semana ${semCobro}, que no se toca: la devolución llega en la ${semHoy}.`;
  } else if (semOrigen && semOrigen !== semHoy) {
    extra = ` La semana ${semOrigen} de la ruta no se toca.`;
  }
  return (
    <div style={{ marginTop: 8, background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 6, padding: "8px 10px", fontSize: 11.5, color: "#475569" }}>
      <b style={{ color: "#1a3a6b" }}>Si lo aceptas:</b> se le {r.verbo} {l.monto_ref != null ? money(l.monto_ref) : "el monto que reconozcas"} como
      abono en la prefactura de la semana {semHoy} ({l.tipo === "cobro" && c?.service_center ? c.service_center : "su centro"}).{extra}
    </div>
  );
}
