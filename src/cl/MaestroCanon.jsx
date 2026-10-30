// ═══════════════════════════════════════════════════════════════════════════
// MaestroCanon.jsx — Brain Chile · Maestro de Canon (DispatchTrack)
//
// Lee vw_maestro_canon (migraciones 80-81): una línea por viaje + guía, con las
// 14 columnas del maestro que llenaban los supervisores y las reglas del
// instructivo del 29-10-2026. El recolector canon-maestro-cl (VPS) la actualiza
// cada 20 minutos desde la API de DispatchTrack.
//
// Mientras el analista compara con el maestro manual, lo dudoso se marca como
// alerta: guías sin cerrar, región sin CECO, patente no válida, líneas que no
// cuadran. El maestro trae TODO; las alertas no quitan filas.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";

const NAVY = "#1a3a6b", AMBAR = "#a16207", VERDE = "#0d8043", ROJO = "#b42318";
const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const fmt = (v) => n(v).toLocaleString("es-CL");
const vol = (v) => n(v).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

// Las 14 columnas del maestro manual, en su orden
export const COLUMNAS_MAESTRO = ["idViajes", "FOLIO_GUIA", "servicio", "cecos", "fecha", "patentes", "paradas",
  "cargados", "entregados", "devueltos", "segmentacionZonal", "TIPO", "VOLUMEN", "DIRECCION"];

const ESTADO = {
  delivered: { t: "Entregada", c: VERDE }, partially_delivered: { t: "Parcial", c: AMBAR },
  not_delivered: { t: "No entregada", c: ROJO }, on_route: { t: "En ruta", c: AMBAR },
};
const FINALES = ["delivered", "partially_delivered", "not_delivered"];

const hoyCL = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric",
  month: "2-digit", day: "2-digit" }).format(new Date());

// Patente chilena: 4 letras + 2 números (nueva) o 2 letras + 4 números (antigua)
const patenteValida = (p) => /^([A-Z]{4}\d{2}|[A-Z]{2}\d{4})$/.test(String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));

// Alertas para el analista: no quitan la guía del maestro
export function alertasCanon(r, hoy = hoyCL()) {
  const a = [];
  if (!FINALES.includes(r.estado) && String(r.fecha) < hoy) a.push("Sin cerrar en DispatchTrack");
  if (!r.cecos) a.push("Región sin CECO");
  if (!patenteValida(r.patentes)) a.push("Patente no válida");
  if (FINALES.includes(r.estado) && n(r.cargados) !== n(r.entregados) + n(r.devueltos)) a.push("Líneas no cuadran");
  return a;
}

function Kpi({ titulo, valor, sub, color }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "10px 14px", minWidth: 150, flex: 1 }}>
      <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || NAVY }}>{valor}</div>
      {sub && <div style={{ fontSize: 11.5, color: "#64748b" }}>{sub}</div>}
    </div>
  );
}

export default function MaestroCanon({ fecha, apiSuave, descargarCSV }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState("guias");
  const [f, setF] = useState({ servicio: "", cecos: "", busca: "", soloAlertas: false });

  const cargar = async () => {
    if (!fecha) return;
    const fallos = [];
    const d = await apiSuave(`vw_maestro_canon?fecha=eq.${fecha}&order=idViajes.asc,FOLIO_GUIA.asc&limit=20000`, null, fallos);
    if (d === null) { setError("No se pudo leer el maestro de Canon" + (fallos.length ? ": " + fallos.join(" | ") : "") + ". ¿Falta correr la migración 80?"); setFilas([]); return; }
    setError(""); setFilas(d);
  };
  useEffect(() => { setFilas(null); cargar(); const t = setInterval(cargar, 5 * 60 * 1000); return () => clearInterval(t); }, [fecha]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (filas === null) return <div style={{ padding: 20, color: "#64748b", fontSize: 13 }}>Cargando el maestro de Canon…</div>;

  const hoy = hoyCL();
  const conAlertas = filas.map((r) => ({ ...r, _alertas: alertasCanon(r, hoy) }));
  const texto = f.busca.trim().toLowerCase();
  const vistaFilas = conAlertas.filter((r) =>
    (!f.servicio || r.servicio === f.servicio) &&
    (!f.cecos || (f.cecos === "_sin" ? !r.cecos : r.cecos === f.cecos)) &&
    (!f.soloAlertas || r._alertas.length) &&
    (!texto || [r.idViajes, r.FOLIO_GUIA, r.patentes, r.conductor, r.DIRECCION, r.comuna]
      .some((c) => String(c ?? "").toLowerCase().includes(texto))));

  const um = vistaFilas.filter((r) => r.servicio === "UM");
  const tr = vistaFilas.filter((r) => r.servicio === "TRONCAL");
  const suma = (lista, c) => lista.reduce((a, r) => a + n(r[c]), 0);
  const rutasIds = [...new Set(vistaFilas.map((r) => r.idViajes))];
  const alertas = vistaFilas.filter((r) => r._alertas.length);
  const cargUM = suma(um, "cargados");

  // Por ruta
  const porRuta = rutasIds.map((id) => {
    const g = vistaFilas.filter((r) => r.idViajes === id);
    return { idViajes: id, patentes: g[0]?.patentes, conductor: g[0]?.conductor,
             um: g.filter((r) => r.servicio === "UM").length, troncal: g.filter((r) => r.servicio === "TRONCAL").length,
             cargados: suma(g, "cargados"), entregados: suma(g, "entregados"), devueltos: suma(g, "devueltos"),
             volumen: suma(g, "VOLUMEN"), cecos: [...new Set(g.map((r) => r.cecos || "sin CECO"))].join(" · "),
             alertas: [...new Set(g.flatMap((r) => r._alertas))] };
  }).sort((a, b) => b.um + b.troncal - (a.um + a.troncal));

  const descargar = () => descargarCSV(`maestro_canon_${fecha}`, vistaFilas,
    COLUMNAS_MAESTRO.map((c) => ({ titulo: c, valor: (r) => (c === "VOLUMEN" ? String(r[c] ?? "").replace(".", ",") : r[c]) })));

  const chip = (k, v, t) => (
    <button key={v} className="mj-btn" onClick={() => setF((x) => ({ ...x, [k]: x[k] === v ? "" : v }))}
            style={f[k] === v ? { background: NAVY, color: "#fff", borderColor: NAVY } : {}}>{t}</button>
  );

  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Maestro de Canon · {fecha} · DispatchTrack</div>
        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginTop: 3, maxWidth: 980 }}>
          Una línea por guía, con las columnas del maestro manual. <strong>Cargados, entregados y devueltos son líneas
          de producto</strong> (3 sábanas iguales = 1 línea) y el volumen es la suma de los productos de la guía.
          TRONCAL cuando el subestado es «Cargado Troncal». Se actualiza solo cada 20 minutos. Las alertas marcan lo que
          conviene revisar al comparar con el maestro manual: no quitan guías.
        </div>
        {error && <div style={{ fontSize: 12, color: ROJO, marginTop: 6 }}>{error}</div>}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <Kpi titulo="Guías UM" valor={fmt(um.length)} sub={`${fmt(tr.length)} troncales · ${fmt(rutasIds.length)} rutas`} />
        <Kpi titulo="Cargados UM" valor={fmt(cargUM)} sub="líneas de producto" />
        <Kpi titulo="Entregados UM" valor={fmt(suma(um, "entregados"))} color={VERDE}
             sub={cargUM ? `${(100 * suma(um, "entregados") / cargUM).toLocaleString("es-CL", { maximumFractionDigits: 1 })}% de lo cargado` : ""} />
        <Kpi titulo="Devueltos UM" valor={fmt(suma(um, "devueltos"))} color={ROJO} sub="líneas no entregadas" />
        <Kpi titulo="Volumen UM" valor={vol(suma(um, "VOLUMEN"))} sub={`troncal ${vol(suma(tr, "VOLUMEN"))}`} />
        <Kpi titulo="Alertas" valor={fmt(alertas.length)} color={alertas.length ? AMBAR : VERDE} sub="guías para revisar" />
      </div>

      <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "10px 16px", marginBottom: 12,
                    display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input className="mj-input" placeholder="Buscar ruta, folio, patente, conductor o dirección…" value={f.busca}
               onChange={(e) => setF((x) => ({ ...x, busca: e.target.value }))} style={{ minWidth: 300, flex: 1 }} />
        {chip("servicio", "UM", "UM")}{chip("servicio", "TRONCAL", "Troncal")}
        {chip("cecos", "C_RM", "C_RM")}{chip("cecos", "C_VIÑA", "C_VIÑA")}{chip("cecos", "_sin", "Sin CECO")}
        <button className="mj-btn" onClick={() => setF((x) => ({ ...x, soloAlertas: !x.soloAlertas }))}
                style={f.soloAlertas ? { background: AMBAR, color: "#fff", borderColor: AMBAR } : {}}>⚠ Solo alertas</button>
        <span style={{ flex: 1 }} />
        <button className="mj-btn" onClick={() => setVista((v) => (v === "guias" ? "rutas" : "guias"))}>
          {vista === "guias" ? "Ver por ruta" : "Ver por guía"}</button>
        <button className="mj-btn" onClick={descargar} disabled={!vistaFilas.length}>Descargar CSV</button>
        <button className="mj-btn" onClick={cargar}>↻ Actualizar</button>
      </div>

      {!filas.length && !error && (
        <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: 18, fontSize: 13, color: "#64748b" }}>
          No hay guías de Canon para el {fecha}.
        </div>
      )}

      {filas.length > 0 && vista === "rutas" && (
        <div style={{ overflowX: "auto" }}>
          <table className="mj-tabla">
            <thead><tr><th>ID viaje</th><th>Patente</th><th>Conductor</th><th>CECO</th><th className="num">Guías UM</th>
              <th className="num">Troncal</th><th className="num">Carg.</th><th className="num">Entr.</th><th className="num">Dev.</th>
              <th className="num">Volumen</th><th>Alertas</th></tr></thead>
            <tbody>
              {porRuta.map((r) => (
                <tr key={r.idViajes}>
                  <td style={{ fontWeight: 700 }}>{r.idViajes}</td>
                  <td style={{ fontWeight: 700, color: patenteValida(r.patentes) ? undefined : AMBAR }}>{r.patentes || "—"}</td>
                  <td>{r.conductor || "—"}</td><td>{r.cecos}</td>
                  <td className="num">{fmt(r.um)}</td><td className="num">{fmt(r.troncal)}</td>
                  <td className="num">{fmt(r.cargados)}</td><td className="num" style={{ color: VERDE }}>{fmt(r.entregados)}</td>
                  <td className="num" style={{ color: r.devueltos ? ROJO : "#cbd5e1" }}>{fmt(r.devueltos)}</td>
                  <td className="num">{vol(r.volumen)}</td>
                  <td style={{ fontSize: 11.5, color: AMBAR }}>{r.alertas.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filas.length > 0 && vista === "guias" && (
        <div style={{ overflowX: "auto" }}>
          <table className="mj-tabla">
            <thead><tr>
              <th>ID viaje</th><th>Folio guía</th><th>Servicio</th><th>CECO</th><th>Patente</th><th>Conductor</th>
              <th className="num">Par.</th><th className="num">Carg.</th><th className="num">Entr.</th><th className="num">Dev.</th>
              <th>Seg. zonal</th><th>Tipo</th><th className="num">Volumen</th><th>Dirección</th><th>Estado</th><th>Alertas</th>
            </tr></thead>
            <tbody>
              {vistaFilas.slice(0, 3000).map((r) => (
                <tr key={`${r.idViajes}-${r.FOLIO_GUIA}`} style={r._alertas.length ? { background: "#fffbeb" } : {}}>
                  <td style={{ fontWeight: 700 }}>{r.idViajes}</td>
                  <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{r.FOLIO_GUIA}</td>
                  <td>{r.servicio === "TRONCAL" ? <span style={{ color: NAVY, fontWeight: 700 }}>Troncal</span> : "UM"}</td>
                  <td>{r.cecos || <span style={{ color: AMBAR }}>sin CECO</span>}</td>
                  <td style={{ fontWeight: 700 }}>{r.patentes || "—"}</td>
                  <td style={{ fontSize: 12 }}>{r.conductor || "—"}</td>
                  <td className="num">{r.paradas}</td>
                  <td className="num">{fmt(r.cargados)}</td>
                  <td className="num" style={{ color: VERDE }}>{fmt(r.entregados)}</td>
                  <td className="num" style={{ color: n(r.devueltos) ? ROJO : "#cbd5e1" }}>{fmt(r.devueltos)}</td>
                  <td style={{ fontSize: 12 }}>{r.segmentacionZonal}</td><td style={{ fontSize: 12 }}>{r.TIPO}</td>
                  <td className="num">{vol(r.VOLUMEN)}</td>
                  <td style={{ fontSize: 12, maxWidth: 320 }}>{r.DIRECCION || "—"}</td>
                  <td style={{ fontSize: 12, color: (ESTADO[r.estado] || {}).c || "#64748b", whiteSpace: "nowrap" }}
                      title={r.subestado || ""}>{(ESTADO[r.estado] || {}).t || r.estado || "—"}{r.subestado ? ` · ${r.subestado}` : ""}</td>
                  <td style={{ fontSize: 11.5, color: AMBAR }}>{r._alertas.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {vistaFilas.length > 3000 && (
            <div style={{ fontSize: 12, color: "#64748b", padding: 8 }}>
              Se muestran 3.000 de {fmt(vistaFilas.length)} guías: usa los filtros o descarga el CSV para verlas todas.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
