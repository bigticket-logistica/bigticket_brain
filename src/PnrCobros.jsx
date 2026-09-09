import { useEffect, useMemo, useState } from "react";
import { sb } from "./shared";

// ─── PNR — Cobro a terceros ─────────────────────────────────────────
// Lista los PNR que pasaron a facturación en la semana, con placa,
// empresa transportista sugerida y el historial de avisos.
// Solo lectura: no inserta en cobros_pnr_mx todavía.

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

function ChipAviso({ label, ts }) {
  const ok = !!ts;
  return (
    <span title={ok ? fechaHora(ts) : "sin aviso"}
      style={{
        display: "inline-block", padding: "1px 6px", marginRight: 4, marginBottom: 2,
        fontSize: 9, fontWeight: 600, borderRadius: 4,
        background: ok ? "#e8f5e9" : "#f1f3f6", color: ok ? "#1b5e20" : "#94a3b8",
      }}>
      {label}
    </span>
  );
}

export default function PnrCobrosMX() {
  const [semana, setSemana] = useState(() => semanaInventario(new Date().toISOString()));
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => { cargar(semana); }, [semana]);

  const cargar = async (sem) => {
    setLoading(true); setMsg(null);
    try {
      const { inicio, fin } = rangoSemana(sem);
      const desde = inicio.toISOString();
      const hasta = new Date(fin.getTime() + 86400000).toISOString();

      // 1) transiciones a facturación dentro de la semana
      const { data: hist, error: e1 } = await sb.from("pnr_historial_mx")
        .select("case_id, creado_en").eq("sub_a", "BILLED")
        .gte("creado_en", desde).lt("creado_en", hasta)
        .order("creado_en", { ascending: true });
      if (e1) throw e1;

      // un caso se cobra una sola vez: si hay más de una transición, vale la primera
      const facturadoEn = {};
      for (const h of hist || []) if (!facturadoEn[h.case_id]) facturadoEn[h.case_id] = h.creado_en;
      const ids = Object.keys(facturadoEn).map(Number);
      if (!ids.length) { setFilas([]); setLoading(false); return; }

      // 2) datos del caso
      const { data: casos, error: e2 } = await sb.from("pnr_casos_mx")
        .select("case_id, monto, moneda, conductor, service_center, route_code, route_id, tercero_id, avisado_inicial_en, avisado_24h_en, avisado_final_cond_en, avisado_final_sup_en")
        .in("case_id", ids);
      if (e2) throw e2;

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

      const out = (casos || []).map(c => {
        const j = jornada[c.route_id] || {};
        const semRuta = semanaInventario(j.fecha);
        const placa = j.placa || null;
        const empresa = (placa && semRuta != null)
          ? (empSem[semRuta + "||" + normalizarPlaca(placa)] || null) : null;
        return {
          ...c,
          facturado_en: facturadoEn[c.case_id],
          placa,
          fecha_ruta: j.fecha || null,
          semana_ruta: semRuta,
          empresa,
          sin_avisos: !c.avisado_inicial_en && !c.avisado_24h_en && !c.avisado_final_cond_en && !c.avisado_final_sup_en,
        };
      }).sort((a, b) => String(b.facturado_en).localeCompare(String(a.facturado_en)));

      setFilas(out);
    } catch (e) {
      console.error("PNR cobros:", e);
      setMsg("No se pudo cargar la semana: " + (e.message || e));
      setFilas([]);
    }
    setLoading(false);
  };

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    if (!q) return filas;
    return filas.filter(f => [f.case_id, f.conductor, f.placa, f.service_center, f.route_code, f.empresa]
      .some(v => String(v || "").toUpperCase().includes(q)));
  }, [filas, busqueda]);

  const total = visibles.reduce((s, f) => s + Number(f.monto || 0), 0);
  const sinEmpresa = visibles.filter(f => !f.empresa).length;

  return (
    <div style={{ padding: 24, fontFamily: "Geist, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>PNR — cobro a terceros</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            Casos que pasaron a facturación en la semana. La empresa se resuelve con el inventario de flota de la semana de la ruta.
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
        <button onClick={() => cargar(semana)} disabled={loading}
          style={{ padding: "7px 14px", fontSize: 11, fontWeight: 600, background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1 }}>
          {loading ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Casos facturados" valor={visibles.length} />
        <Kpi label="Monto a cobrar" valor={money(total)} sub="suma del valor del paquete" />
        <Kpi label="Sin empresa" valor={sinEmpresa} sub={sinEmpresa ? "requieren asignación manual" : "todos resueltos"} />
      </div>

      {msg ? (
        <div style={{ padding: 10, marginBottom: 12, background: "#fdecea", color: "#7f1d1d", borderRadius: 6, fontSize: 12 }}>{msg}</div>
      ) : null}

      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>PNR</th>
              <th style={th}>Facturado</th>
              <th style={{ ...th, textAlign: "right" }}>Monto</th>
              <th style={th}>Chofer</th>
              <th style={th}>Placa</th>
              <th style={th}>SC</th>
              <th style={th}>Ruta</th>
              <th style={th}>Empresa transportista</th>
              <th style={th}>Avisos</th>
            </tr>
          </thead>
          <tbody>
            {!loading && !visibles.length ? (
              <tr><td style={{ ...td, textAlign: "center", color: "#94a3b8", padding: 30 }} colSpan={9}>
                Sin PNR facturados en esta semana.
              </td></tr>
            ) : null}
            {visibles.map(f => (
              <tr key={f.case_id}>
                <td style={{ ...td, fontWeight: 600 }}>
                  {f.case_id}
                  {f.sin_avisos ? (
                    <div style={{ fontSize: 9, color: "#b45309", fontWeight: 600 }}>nació facturado</div>
                  ) : null}
                </td>
                <td style={td}>{fechaHora(f.facturado_en)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(f.monto)}</td>
                <td style={td}>{f.conductor || "—"}</td>
                <td style={td}>{f.placa || <span style={{ color: "#b45309" }}>sin placa</span>}</td>
                <td style={td}>{f.service_center || "—"}</td>
                <td style={td}>
                  {f.route_code || "—"}
                  <div style={{ fontSize: 9, color: "#94a3b8" }}>
                    {soloFecha(f.fecha_ruta)}{f.semana_ruta != null ? ` · sem ${f.semana_ruta}` : ""}
                  </div>
                </td>
                <td style={td}>
                  {f.empresa
                    ? f.empresa
                    : <span style={{ color: "#b45309", fontWeight: 600 }}>por asignar</span>}
                </td>
                <td style={td}>
                  <ChipAviso label="inicial" ts={f.avisado_inicial_en} />
                  <ChipAviso label="24h" ts={f.avisado_24h_en} />
                  <ChipAviso label="final chofer" ts={f.avisado_final_cond_en} />
                  <ChipAviso label="final sup" ts={f.avisado_final_sup_en} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
