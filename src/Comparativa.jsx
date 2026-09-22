// ═══════════════════════════════════════════════════════════════════════════
// Comparativa.jsx — Los dos caminos de la prefactura, lado a lado.
//
// CAMINO A (el que opera hoy): se arma el lunes juntando la semana completa y
// cruzando con el Excel madre. Es lo que se envía y se paga.
//
// CAMINO B (el nuevo): se acumula día a día desde lo que el analista publica.
// Es lo que el tercero ve en su portal cada mañana.
//
// Los dos deberían dar lo mismo, porque los dos salen del tarifado. Cuando no
// cuadran, la causa suele ser una de estas y por eso se muestran por separado:
//   · un SC que no se publicó — está en la prefactura y no en el diario
//   · líneas manuales que el analista agregó en la conciliación
//   · rutas sin tercero_id — entran por nombre a la prefactura, no al diario
//
// Mientras no cuadren de forma consistente, el camino A sigue mandando.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "./shared";

const SEMANA_INICIO = 39;   // hito cero del portal: 14-sep-2026

const money = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const semanaActual = () => {
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dn);
  const ini = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - ini) / 86400000 + 1) / 7) + 1;
};

export default function Comparativa() {
  const [semana, setSemana] = useState(() => Math.max(SEMANA_INICIO, semanaActual()));
  const [semanas, setSemanas] = useState([]);
  const [filas, setFilas] = useState(null);
  const [soloDif, setSoloDif] = useState(true);
  const [err, setErr] = useState(null);

  const cargar = useCallback(async () => {
    setFilas(null); setErr(null);
    try {
      // Una sola fuente: vw_cuadre_prefactura ya compara lo que el tercero ve
      // en su portal contra el neto de su prefactura. Antes esta pantalla
      // armaba su propia comparación y medía cosas distintas de las que
      // miraban las consultas, así que daba otro número.
      const { data, error } = await sb.from("vw_cuadre_prefactura")
        .select("*").eq("semana", semana);
      if (error) throw error;
      setFilas((data || []).map(r => ({
        tercero_id: r.empresa_nombre + "|" + r.service_center,
        empresa: r.empresa_nombre, sc: r.service_center, estado: r.estado,
        tradPagos: r.tradicional == null ? null : Number(r.tradicional),
        diaNeto: r.diario == null ? null : Number(r.diario),
        diaPagos: Number(r.diario_pagos || 0),
        diaCobros: Number(r.diario_cobros || 0),
        diaAjustes: 0,
        rutas: r.rutas_diario,
      })));
    } catch (e) { setErr(e.message || String(e)); setFilas([]); }

    const { data: ws } = await sb.from("conciliaciones_terceros")
      .select("semana").order("semana", { ascending: false }).limit(300);
    setSemanas([...new Set((ws || []).map(w => w.semana))].filter(w => w >= SEMANA_INICIO));
  }, [semana]);

  useEffect(() => { cargar(); }, [cargar]);

  const { visibles, tot } = useMemo(() => {
    const fs = filas || [];
    const dif = (f) => {
      if (f.tradPagos === null || f.diaNeto == null) return null;
      return Number((f.diaNeto - f.tradPagos).toFixed(2));
    };
    // El modelo A —la prefactura del lunes— es la base. Una publicación sin
    // prefactura todavía no es un descuadre: es que el lunes aún no se generó.
    // Contarla como diferencia llenaba la pantalla de casos que no lo son.
    const comparables = fs.filter(f => f.tradPagos !== null);
    const conDif = comparables.filter(f => { const d = dif(f); return d !== null && Math.abs(d) > 0.01; });
    const sinPrefactura = fs.filter(f => f.tradPagos === null);
    return {
      visibles: (soloDif ? conDif : fs).map(f => ({ ...f, dif: dif(f) })),
      tot: {
        trad: comparables.reduce((t, f) => t + (f.tradPagos || 0), 0),
        dia: comparables.reduce((t, f) => t + (f.diaNeto || 0), 0),
        nDif: conDif.length, n: comparables.length,
        sinPref: sinPrefactura.length,
        sinPrefMonto: sinPrefactura.reduce((t, f) => t + (f.diaNeto || 0), 0),
      },
    };
  }, [filas, soloDif]);

  const th = { textAlign: "left", padding: "9px 10px", fontSize: 10.5, fontWeight: 700, color: "#64748b", background: "#f8fafc", textTransform: "uppercase", letterSpacing: .4, whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: 12, borderBottom: "1px solid #f1f5f9" };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>Comparativa de prefacturas</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2, maxWidth: 720, lineHeight: 1.5 }}>
          La prefactura que se arma el lunes contra la que se acumula día a día desde lo publicado.
          Los dos salen del tarifado, así que deberían cuadrar. Lo que no cuadra suele ser un SC sin
          publicar, una línea manual de la conciliación, o una ruta sin empresa en el padrón.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => setSemana(s => Math.max(SEMANA_INICIO, s - 1))}
          disabled={semana <= SEMANA_INICIO}
          style={{ ...btn, opacity: semana <= SEMANA_INICIO ? .4 : 1 }}>‹</button>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", minWidth: 96, textAlign: "center" }}>
          Semana {semana}
        </span>
        <button onClick={() => setSemana(s => s + 1)} style={btn}>›</button>
        <button onClick={cargar} style={{ ...btn, width: "auto", padding: "7px 14px", fontSize: 12 }}>↻ Actualizar</button>
        <label style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
          <input type="checkbox" checked={soloDif} onChange={e => setSoloDif(e.target.checked)} />
          Solo las que no cuadran
        </label>
      </div>

      {err && <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      {filas === null ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Cargando…</div>
      ) : filas.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          Sin datos para la semana {semana}. La prefactura del lunes todavía no se generó, o no hay días publicados.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
            <Kpi label="Prefactura del lunes" valor={money(tot.trad)} />
            <Kpi label="Acumulado diario" valor={money(tot.dia)} />
            <Kpi label="Diferencia" valor={money(tot.dia - tot.trad)}
              color={Math.abs(tot.dia - tot.trad) < 0.01 ? "#16a34a" : "#dc2626"} />
            <Kpi label="No cuadran" valor={`${tot.nDif} de ${tot.n}`}
              color={tot.nDif === 0 ? "#16a34a" : "#b45309"} />
          </div>

          {tot.sinPref > 0 && (
            <div style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 10,
              padding: "11px 14px", marginBottom: 12, fontSize: 12.5, color: "#64748b", lineHeight: 1.5 }}>
              <b style={{ color: "#1a3a6b" }}>{tot.sinPref} publicación(es) sin prefactura todavía</b>, por {money(tot.sinPrefMonto)}.
              No son descuadres: el lunes todavía no se generó la prefactura de esas empresas.
            </div>
          )}

          {visibles.length === 0 ? (
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: 24, textAlign: "center", color: "#166534", fontSize: 13, fontWeight: 700 }}>
              Los dos caminos cuadran en las {tot.n} prefacturas de la semana.
            </div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Empresa</th><th style={th}>SC</th><th style={th}>Estado</th>
                  <th style={{ ...th, textAlign: "right" }}>Lunes</th>
                  <th style={{ ...th, textAlign: "right" }}>Diario</th>
                  <th style={{ ...th, textAlign: "center" }}>Rutas</th>
                  <th style={{ ...th, textAlign: "right" }}>Diferencia</th>
                  <th style={th}>Qué pasa</th>
                </tr></thead>
                <tbody>
                  {visibles.map(f => {
                    const soloLunes = f.diaNeto == null;
                    const soloDiario = f.tradPagos === null;
                    // Un espejo exacto entre dos empresas del mismo SC es la
                    // firma de una placa asignada distinto en cada modelo: no
                    // falta plata, está en el bolsillo equivocado.
                    const espejo = f.dif != null && visibles.some(o =>
                      o !== f && o.sc === f.sc && o.dif != null &&
                      Math.abs(Number(o.dif) + Number(f.dif)) < 0.01);
                    const nota = soloLunes ? "Está en la prefactura del lunes y no en el acumulado: ese día o SC no se publicó."
                      : soloDiario ? "Está publicada y no tiene prefactura del lunes todavía."
                      : espejo ? "Hay otra empresa del mismo centro con la diferencia inversa: la misma placa está asignada a empresas distintas en cada modelo. Revisa el padrón."
                      : (f.dif > 0 ? "El diario tiene de más: rutas publicadas que la prefactura no incluyó, o una línea que la conciliación excluyó."
                                   : "La prefactura tiene de más: línea manual, rutas consolidadas, o viajes que no llegaron a publicarse.");
                    return (
                      <tr key={`${f.tercero_id}|${f.sc}`}>
                        <td style={{ ...td, fontWeight: 600, color: "#334155" }}>{f.empresa}</td>
                        <td style={{ ...td, color: "#64748b" }}>{f.sc}</td>
                        <td style={{ ...td, color: "#94a3b8", fontSize: 11 }}>{f.estado || "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: soloDiario ? "#cbd5e1" : "#334155" }}>
                          {soloDiario ? "—" : money(f.tradPagos)}
                        </td>
                        <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: soloLunes ? "#cbd5e1" : "#334155" }}>
                          {soloLunes ? "—" : money(f.diaNeto)}
                          {!soloLunes && (f.diaCobros || f.diaAjustes) ? (
                            <div style={{ fontSize: 9.5, color: "#94a3b8" }}>
                              {money(f.diaPagos)} viajes
                              {f.diaCobros ? ` · ${money(f.diaCobros)} cobros` : ""}
                              {f.diaAjustes ? ` · ${money(f.diaAjustes)} ajustes` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ ...td, textAlign: "center", color: "#94a3b8" }}>{f.rutas ?? "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                          color: f.dif === null ? "#b45309" : f.dif > 0 ? "#16a34a" : "#dc2626" }}>
                          {f.dif === null ? "—" : money(f.dif)}
                        </td>
                        <td style={{ ...td, fontSize: 11, color: "#64748b", maxWidth: 300, lineHeight: 1.4 }}>{nota}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, valor, color }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 10.5, color: "#94a3b8", textTransform: "uppercase", letterSpacing: .4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, color: color || "#1a3a6b", fontVariantNumeric: "tabular-nums" }}>{valor}</div>
    </div>
  );
}

const btn = { border: "1px solid #e4e7ec", background: "#fff", color: "#1a3a6b", borderRadius: 8, width: 32, height: 32, fontSize: 15, fontWeight: 700, cursor: "pointer" };
