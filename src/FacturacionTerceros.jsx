// ═══════════════════════════════════════════════════════════════════════════
// FacturacionTerceros.jsx — Las facturas que los terceros suben desde su
// portal, contra cada prefactura enviada.
//
// Tres cosas que el analista necesita ver de un vistazo:
//   · Qué prefacturas enviadas todavía no tienen factura.
//   · De las que sí, cuáles cuadran con el monto y cuáles no.
//   · Qué dice el SAT de cada una: vigente, cancelada o no la encuentra.
//
// El estado del SAT se consulta al subir la factura desde el portal. Si el SAT
// estaba caído o la factura era muy reciente, queda pendiente y el reintento
// la vuelve a tomar — por eso hay un botón para forzar la consulta.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "./shared";

const money = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (s) => s ? new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
const BRAIN_API = "/api/reportes/validar-cfdi";

export default function FacturacionTerceros({ usuario }) {
  const [semana, setSemana] = useState(null);
  const [semanas, setSemanas] = useState([]);
  const [filas, setFilas] = useState(null);
  const [filtro, setFiltro] = useState("todas");
  const [busca, setBusca] = useState("");
  const [validando, setValidando] = useState(null);
  const [sel, setSel] = useState({});        // id de prefactura -> marcada para pagar
  const [pagando, setPagando] = useState(false);
  const [msg, setMsg] = useState(null);

  const cargar = useCallback(async () => {
    setFilas(null);
    // Se parte de las prefacturas enviadas: la pregunta del analista es "¿quién
    // me falta por facturar?", no "¿qué facturas llegaron?".
    let q = sb.from("conciliaciones_terceros")
      .select("id, semana, empresa_nombre, service_center, liquido_pago, enviado_at, tercero_id, pagado_at, pagado_por, pago_referencia")
      .eq("estado", "enviada").not("tercero_id", "is", null)
      .order("semana", { ascending: false });
    if (semana) q = q.eq("semana", semana);
    const { data: prefs } = await q.limit(1000);

    const ids = (prefs || []).map(p => p.id);
    let facts = [];
    if (ids.length) {
      const { data } = await sb.from("facturas_tercero").select("*").in("conciliacion_id", ids);
      facts = data || [];
    }
    const porPref = {};
    for (const f of facts) (porPref[f.conciliacion_id] = porPref[f.conciliacion_id] || []).push(f);

    setFilas((prefs || []).map(p => ({ ...p, facturas: porPref[p.id] || [] })));

    const { data: ws } = await sb.from("conciliaciones_terceros")
      .select("semana").eq("estado", "enviada").order("semana", { ascending: false }).limit(500);
    const lista = [...new Set((ws || []).map(w => w.semana))];
    setSemanas(lista);
    // Arranca en la más reciente: el analista revisa la semana que acaba de
    // enviar, no el histórico completo.
    if (semana == null && lista.length) setSemana(lista[0]);
  }, [semana]);

  useEffect(() => { cargar(); }, [cargar]);

  const validar = async (f) => {
    setValidando(f.id); setMsg(null);
    try {
      const r = await fetch(`${BRAIN_API}?factura_id=${f.id}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Sin detalle");
      const res = j.resultados?.[0];
      setMsg(res?.vigente
        ? { ok: true, txt: `El SAT confirma la factura ${f.serie_folio || f.uuid} como vigente.` }
        : { ok: false, txt: `El SAT responde: ${res?.estado || res?.codigo || res?.error || "sin respuesta"}.` });
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo consultar al SAT: " + (e.message || e) }); }
    setValidando(null);
  };

  // El pago es uno por prefactura, así que se marca la prefactura entera y con
  // eso todas sus líneas quedan resueltas en el portal del tercero. Marcar
  // línea por línea sería pedir un trabajo que no refleja cómo ocurre el pago.
  const marcarPagadas = async () => {
    const ids = Object.keys(sel).filter(k => sel[k]).map(Number);
    if (!ids.length) return;
    const filasSel = (filas || []).filter(f => ids.includes(f.id));
    const total = filasSel.reduce((t, f) => t + Number(f.liquido_pago || 0), 0);
    const ref = window.prompt(
      `Marcar ${ids.length} prefactura(s) como pagadas.\n\nTotal: ${money(total)}\n\n` +
      `Referencia de la transferencia (opcional, queda visible para el tercero):`, "");
    if (ref === null) return;

    setPagando(true); setMsg(null);
    try {
      const { error } = await sb.from("conciliaciones_terceros").update({
        pagado_at: new Date().toISOString(),
        pagado_por: (usuario && (usuario.nombre || usuario.email)) || "Brain",
        pago_referencia: ref.trim() || null,
      }).in("id", ids);
      if (error) throw error;
      setMsg({ ok: true, txt: `${ids.length} prefactura(s) marcadas como pagadas por ${money(total)}. El tercero ya lo ve en su portal.` });
      setSel({});
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo marcar el pago: " + (e.message || e) }); }
    setPagando(false);
  };

  const validarPendientes = async () => {
    setValidando("todas"); setMsg(null);
    try {
      const r = await fetch(`${BRAIN_API}?reintentar=1`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Sin detalle");
      setMsg({ ok: true, txt: `${j.revisadas} revisada(s): ${j.vigentes} vigentes, ${j.con_problema} con problema, ${j.sin_respuesta} sin respuesta del SAT.` });
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo consultar al SAT: " + (e.message || e) }); }
    setValidando(null);
  };

  // El estado de cada prefactura se decide por su factura: sin factura, con
  // diferencia de monto, rechazada por el SAT, o conforme.
  const estadoDe = (p) => {
    if (!p.facturas.length) return "sin_factura";
    const f = p.facturas[0];
    if (f.sat_estado && String(f.sat_estado).toLowerCase() !== "vigente") return "sat_problema";
    if (f.diferencia != null && Math.abs(Number(f.diferencia)) > 1) return "descuadre";
    if (!f.uuid) return "sin_xml";
    if (!f.sat_estado) return "sin_validar";
    return "conforme";
  };

  const ESTADOS = {
    sin_factura:  { l: "Sin factura",      bg: "#f1f5f9", fg: "#64748b" },
    sin_xml:      { l: "Sin leer",          bg: "#f1f5f9", fg: "#64748b" },
    sin_validar:  { l: "Falta validar",    bg: "#dbeafe", fg: "#1e40af" },
    descuadre:    { l: "No cuadra",        bg: "#fef3c7", fg: "#92400e" },
    sat_problema: { l: "Rechazada por SAT", bg: "#fee2e2", fg: "#991b1b" },
    conforme:     { l: "Conforme",         bg: "#dcfce7", fg: "#166534" },
  };

  const { visibles, resumen } = useMemo(() => {
    const fs = (filas || []).map(p => ({ ...p, _estado: estadoDe(p) }));
    const r = {};
    for (const p of fs) r[p._estado] = (r[p._estado] || 0) + 1;
    let v = filtro === "todas" ? fs : fs.filter(p => p._estado === filtro);
    const q = busca.trim().toLowerCase();
    if (q) v = v.filter(p => [p.empresa_nombre, p.service_center, p.facturas[0]?.uuid, p.facturas[0]?.serie_folio]
      .some(x => String(x || "").toLowerCase().includes(q)));
    return { visibles: v, resumen: r };
  }, [filas, filtro, busca]);

  const abrir = async (path) => {
    const { data } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const th = { textAlign: "left", padding: "9px 10px", fontSize: 10.5, fontWeight: 700, color: "#64748b", background: "#f8fafc", textTransform: "uppercase", letterSpacing: .4, whiteSpace: "nowrap" };
  const td = { padding: "9px 10px", fontSize: 12, borderBottom: "1px solid #f1f5f9" };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>Facturación de terceros</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2, maxWidth: 680, lineHeight: 1.5 }}>
            Las facturas que suben desde su portal contra cada prefactura enviada. El monto y el RFC
            se comparan al subirla; el estado lo confirma el SAT.
          </div>
        </div>
        {Object.values(sel).some(Boolean) && (
          <button onClick={marcarPagadas} disabled={pagando}
            style={{ padding: "9px 18px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700,
              background: pagando ? "#cbd5e1" : "#16a34a", color: "#fff", marginRight: 8,
              cursor: pagando ? "not-allowed" : "pointer" }}>
            {pagando ? "Marcando…" : `Marcar ${Object.values(sel).filter(Boolean).length} como pagadas`}
          </button>
        )}
        <button onClick={validarPendientes} disabled={validando !== null}
          style={{ padding: "9px 18px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700,
            background: validando ? "#cbd5e1" : "#1a3a6b", color: "#fff",
            cursor: validando ? "not-allowed" : "pointer" }}>
          {validando === "todas" ? "Consultando al SAT…" : "Validar las pendientes"}
        </button>
      </div>

      {msg && (
        <div style={{ background: msg.ok ? "#f0fdf4" : "#fef2f2", color: msg.ok ? "#166534" : "#991b1b",
          border: `1px solid ${msg.ok ? "#86efac" : "#fca5a5"}`, borderRadius: 8,
          padding: "10px 12px", fontSize: 12.5, marginBottom: 12 }}>{msg.txt}</div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <select value={semana || ""} onChange={e => setSemana(e.target.value ? Number(e.target.value) : null)}
          style={{ border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 11px", fontSize: 12.5 }}>
          <option value="">Todas las semanas</option>
          {semanas.map(w => <option key={w} value={w}>Semana {w}</option>)}
        </select>
        {[["todas", "Todas"], ["sin_factura", "Sin factura"], ["descuadre", "No cuadran"],
          ["sat_problema", "SAT"], ["sin_validar", "Por validar"], ["conforme", "Conformes"]].map(([id, l]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{ padding: "6px 13px", borderRadius: 16, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${filtro === id ? "#1a3a6b" : "#e4e7ec"}`,
              background: filtro === id ? "#1a3a6b" : "#fff", color: filtro === id ? "#fff" : "#64748b" }}>
            {l}{resumen[id] ? ` (${resumen[id]})` : ""}
          </button>
        ))}
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Empresa, SC, folio fiscal…"
          style={{ border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 11px", fontSize: 12, minWidth: 220 }} />
      </div>

      {filas === null ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Cargando…</div>
      ) : visibles.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 36, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          Sin prefacturas en este filtro.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, width: 28 }}>
                <input type="checkbox"
                  checked={visibles.length > 0 && visibles.every(p => sel[p.id])}
                  onChange={e => {
                    const n = {};
                    if (e.target.checked) for (const p of visibles) if (!p.pagado_at) n[p.id] = true;
                    setSel(n);
                  }} />
              </th>
              <th style={th}>Sem</th><th style={th}>Empresa</th><th style={th}>SC</th>
              <th style={{ ...th, textAlign: "right" }}>Prefactura</th>
              <th style={{ ...th, textAlign: "right" }}>Factura</th>
              <th style={{ ...th, textAlign: "right" }}>Dif.</th>
              <th style={th}>Folio fiscal</th>
              <th style={{ ...th, textAlign: "center" }}>Monto</th>
              <th style={{ ...th, textAlign: "center" }}>SAT</th>
              <th style={th}>Estado</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {visibles.map(p => {
                const f = p.facturas[0];
                const e = ESTADOS[p._estado];
                return (
                  <tr key={p.id} style={{ background: p.pagado_at ? "#f0fdf4" : "#fff" }}>
                    <td style={td}>
                      {!p.pagado_at && (
                        <input type="checkbox" checked={!!sel[p.id]}
                          onChange={() => setSel(x => ({ ...x, [p.id]: !x[p.id] }))} />
                      )}
                    </td>
                    <td style={{ ...td, color: "#64748b" }}>{p.semana}</td>
                    <td style={{ ...td, fontWeight: 600, color: "#334155" }}>{p.empresa_nombre}</td>
                    <td style={{ ...td, color: "#64748b" }}>{p.service_center}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(p.liquido_pago)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: f?.monto_factura ? "#334155" : "#cbd5e1" }}>
                      {f?.monto_factura != null ? money(f.monto_factura) : "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700,
                      color: f?.diferencia == null ? "#cbd5e1" : Math.abs(Number(f.diferencia)) <= 1 ? "#16a34a" : "#b45309" }}>
                      {f?.diferencia != null ? money(f.diferencia) : "—"}
                    </td>
                    <td style={{ ...td, color: "#94a3b8", fontSize: 10.5 }}>
                      {f?.serie_folio && <div style={{ color: "#334155", fontSize: 11.5 }}>{f.serie_folio}</div>}
                      {f?.uuid || (f ? "sin leer" : "—")}
                      {f?.rfc_emisor && <div>RFC {f.rfc_emisor}</div>}
                    </td>
                    {/* Dos validaciones distintas: que el monto cuadre con la
                        prefactura, y que el SAT reconozca el comprobante. Una
                        puede pasar y la otra no. */}
                    <td style={{ ...td, textAlign: "center", fontSize: 15 }}>
                      {!f ? <span style={{ color: "#cbd5e1" }}>—</span>
                        : f.diferencia == null ? <span title="No se pudo leer el monto" style={{ color: "#94a3b8" }}>?</span>
                        : Math.abs(Number(f.diferencia)) <= 1
                          ? <span title="Cuadra con la prefactura" style={{ color: "#16a34a" }}>✓</span>
                          : <span title={`Difiere en ${money(f.diferencia)}`} style={{ color: "#dc2626" }}>✗</span>}
                    </td>
                    <td style={{ ...td, textAlign: "center", fontSize: 15 }}>
                      {!f ? <span style={{ color: "#cbd5e1" }}>—</span>
                        : !f.sat_estado ? <span title="Todavía sin validar" style={{ color: "#94a3b8" }}>?</span>
                        : String(f.sat_estado).toLowerCase() === "vigente"
                          ? <span title="El SAT la confirma vigente" style={{ color: "#16a34a" }}>✓</span>
                          : <span title={`El SAT responde: ${f.sat_estado}`} style={{ color: "#dc2626" }}>✗</span>}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 10, background: e.bg, color: e.fg, whiteSpace: "nowrap" }}>
                        {e.l}
                      </span>
                      {f?.sat_estado && (
                        <div style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 2 }}>
                          SAT {fecha(f.sat_validado_at)}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                      {p.pagado_at && (
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: "#166534", marginBottom: 3 }}>
                          Pagada {fecha(p.pagado_at)}
                          {p.pago_referencia && <div style={{ fontWeight: 400, color: "#94a3b8" }}>{p.pago_referencia}</div>}
                        </div>
                      )}
                      {f && (
                        <>
                          <button onClick={() => abrir(f.storage_path)}
                            style={{ border: "1px solid #e4e7ec", background: "#fff", color: "#1a3a6b",
                              borderRadius: 5, padding: "4px 10px", fontSize: 10.5, cursor: "pointer" }}>
                            Ver
                          </button>
                          {f.uuid && (
                            <button onClick={() => validar(f)} disabled={validando !== null}
                              style={{ marginLeft: 4, border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b",
                                borderRadius: 5, padding: "4px 10px", fontSize: 10.5, cursor: "pointer" }}>
                              {validando === f.id ? "…" : "SAT"}
                            </button>
                          )}
                        </>
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
