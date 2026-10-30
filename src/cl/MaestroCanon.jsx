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

// ── Comparación con el maestro manual de los supervisores (migración 82) ──
const TIPO_DIF = {
  distinto:        { t: "Con diferencias",  c: AMBAR, d: "La guía está en los dos, con algún valor distinto" },
  solo_automatico: { t: "Solo automático",  c: NAVY,  d: "Está en DispatchTrack y el supervisor no la anotó" },
  solo_manual:     { t: "Solo manual",      c: ROJO,  d: "La anotó el supervisor y no está en DispatchTrack ese día y viaje" },
  otra_ruta:       { t: "En otro viaje",    c: AMBAR, d: "Misma guía y día, en un viaje distinto" },
  igual:           { t: "Iguales",          c: VERDE, d: "Calzan en todo" },
};
const CAMPOS = ["cargados", "entregados", "devueltos", "volumen", "cecos", "servicio", "patente"];

// Lee el Excel de los supervisores en el navegador: una fila por guía, 14 columnas
export async function leerManual(archivo) {
  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await archivo.arrayBuffer());
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error("El archivo no tiene hojas.");
  const enc = [];
  hoja.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { enc[i] = String(c.text || "").trim(); });
  const faltan = ["idViajes", "FOLIO_GUIA", "fecha"].filter((c) => !enc.includes(c));
  if (faltan.length) throw new Error(`No parece el maestro de Canon: faltan las columnas ${faltan.join(", ")}.`);
  const valor = (v) => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);              // las fechas de Excel vienen en UTC
    if (typeof v === "object") return v.result !== undefined ? valor(v.result) : (v.text ?? (v.richText || []).map((x) => x.text).join(""));
    return String(v).trim();
  };
  const filas = [];
  hoja.eachRow((fila, n) => {
    if (n === 1) return;
    const o = {};
    fila.eachCell({ includeEmpty: true }, (c, i) => { if (enc[i]) o[enc[i]] = valor(c.value); });
    if (o.idViajes && o.FOLIO_GUIA && o.fecha) {
      // fecha como texto dd-mm-aaaa o dd/mm/aaaa → aaaa-mm-dd
      const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(o.fecha);
      if (m) o.fecha = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      filas.push(o);
    }
  });
  if (!filas.length) throw new Error("El archivo no trae guías (filas con idViajes, FOLIO_GUIA y fecha).");
  return filas;
}

function CompararManual({ fecha, api, descargarCSV }) {
  const [desde, setDesde] = useState(fecha);
  const [hasta, setHasta] = useState(fecha);
  const [filas, setFilas] = useState(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [filtro, setFiltro] = useState({ tipo: "", campo: "", busca: "" });

  const comparar = async (d = desde, h = hasta) => {
    setOcupado("comparar"); setError("");
    try {
      const r = await api("rpc/comparar_canon", { method: "POST", body: JSON.stringify({ p_desde: d, p_hasta: h }) });
      setFilas(r || []);
    } catch (e) { setError("No se pudo comparar: " + e.message + " (¿falta la migración 82?)"); }
    finally { setOcupado(""); }
  };
  useEffect(() => { setDesde(fecha); setHasta(fecha); comparar(fecha, fecha); }, [fecha]);   // eslint-disable-line react-hooks/exhaustive-deps

  const subir = async (archivo) => {
    if (!archivo) return;
    setOcupado("subir"); setError(""); setMsg("");
    try {
      const todas = await leerManual(archivo);
      const dias = [...new Set(todas.map((f) => f.fecha))].sort();
      if (!window.confirm(`Se cargarán ${todas.length.toLocaleString("es-CL")} guías de ${dias.length} días ` +
            `(${dias[0]} a ${dias[dias.length - 1]}).\n\nLos días que ya estaban cargados se reemplazan por los del archivo.\n\n¿Continuar?`)) return;
      // por días completos, en tandas de hasta ~3.000 guías (subir un día reemplaza ese día)
      const porDia = dias.map((d) => todas.filter((f) => f.fecha === d));
      let tanda = [], total = 0;
      const enviar = async () => {
        if (!tanda.length) return;
        const r = await api("rpc/cargar_maestro_canon_manual", { method: "POST", body: JSON.stringify({ filas: tanda, p_usuario: "brain" }) });
        total += (r && r.filas) || 0; tanda = [];
      };
      for (const d of porDia) { if (tanda.length + d.length > 3000) await enviar(); tanda = tanda.concat(d); }
      await enviar();
      setMsg(`Maestro manual cargado: ${total.toLocaleString("es-CL")} guías de ${dias.length} días.`);
      setDesde(dias[0]); setHasta(dias[dias.length - 1]);
      await comparar(dias[0], dias[dias.length - 1]);
    } catch (e) { setError(e.message); }
    finally { setOcupado(""); }
  };

  const cuenta = (t) => (filas || []).filter((r) => r.tipo === t).length;
  const texto = filtro.busca.trim().toLowerCase();
  const vistas = (filas || []).filter((r) => r.tipo !== "igual" &&
    (!filtro.tipo || r.tipo === filtro.tipo) &&
    (!filtro.campo || (r.diferencias || []).includes(filtro.campo)) &&
    (!texto || [r.id_ruta, r.folio, r.a_patente, r.m_patente, r.conductor, r.direccion].some((c) => String(c ?? "").toLowerCase().includes(texto))));
  const total = (filas || []).length;
  const iguales = cuenta("igual");
  const par = (a, m, esVol) => {
    const fa = esVol ? (a == null ? "—" : vol(a)) : (a ?? "—"), fm = esVol ? (m == null ? "—" : vol(m)) : (m ?? "—");
    return String(fa) === String(fm) ? <span style={{ color: "#94a3b8" }}>{fa}</span>
      : <span><b style={{ color: NAVY }}>{fa}</b> <span style={{ color: "#94a3b8" }}>·</span> <b style={{ color: ROJO }}>{fm}</b></span>;
  };

  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Comparar con el maestro manual de los supervisores</div>
        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginTop: 3, maxWidth: 980 }}>
          Sube el Excel que llenan los supervisores (las 14 columnas de siempre). El Brain lo cruza con el automático guía por
          guía, por día, viaje y folio (sin importar los ceros a la izquierda). Solo última milla: el manual no trae troncales.
          Subir un día de nuevo lo reemplaza. En cada fila, <b style={{ color: NAVY }}>azul es el automático</b> y{" "}
          <b style={{ color: ROJO }}>rojo es el manual</b>.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <label className="mj-btn" style={{ cursor: "pointer", background: NAVY, color: "#fff", borderColor: NAVY, opacity: ocupado === "subir" ? 0.6 : 1 }}>
            {ocupado === "subir" ? "Leyendo y cargando…" : "⬆ Subir maestro manual (.xlsx)"}
            <input type="file" accept=".xlsx" style={{ display: "none" }} disabled={ocupado === "subir"}
                   onChange={(e) => { const a = e.target.files && e.target.files[0]; e.target.value = ""; subir(a); }} />
          </label>
          <span style={{ fontSize: 12, color: "#64748b" }}>Comparar del</span>
          <input className="mj-input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <span style={{ fontSize: 12, color: "#64748b" }}>al</span>
          <input className="mj-input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          <button className="mj-btn" onClick={() => comparar()} disabled={ocupado === "comparar"}>
            {ocupado === "comparar" ? "Comparando…" : "Comparar"}</button>
          <span style={{ flex: 1 }} />
          <button className="mj-btn" disabled={!vistas.length}
                  onClick={() => descargarCSV(`diferencias_canon_${desde}_${hasta}`, vistas, [
                    { titulo: "fecha", campo: "fecha" }, { titulo: "idViajes", campo: "id_ruta" }, { titulo: "FOLIO_GUIA", campo: "folio" },
                    { titulo: "tipo", valor: (r) => (TIPO_DIF[r.tipo] || {}).t || r.tipo },
                    { titulo: "diferencias", valor: (r) => (r.diferencias || []).join(" · ") },
                    { titulo: "viaje manual", campo: "ruta_manual" },
                    ...["patente", "cecos", "servicio", "cargados", "entregados", "devueltos", "volumen"].flatMap((c) => [
                      { titulo: `${c} automático`, valor: (r) => (c === "volumen" && r[`a_${c}`] != null ? String(r[`a_${c}`]).replace(".", ",") : r[`a_${c}`]) },
                      { titulo: `${c} manual`, valor: (r) => (c === "volumen" && r[`m_${c}`] != null ? String(r[`m_${c}`]).replace(".", ",") : r[`m_${c}`]) }]),
                    { titulo: "estado", campo: "estado" }, { titulo: "conductor", campo: "conductor" }])}>Descargar diferencias</button>
        </div>
        {msg && <div style={{ fontSize: 12, color: VERDE, marginTop: 6 }}>✓ {msg}</div>}
        {error && <div style={{ fontSize: 12, color: ROJO, marginTop: 6 }}>{error}</div>}
      </div>

      {filas !== null && !total && !error && (
        <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: 18, fontSize: 13, color: "#64748b" }}>
          No hay maestro manual cargado para {desde === hasta ? `el ${desde}` : `del ${desde} al ${hasta}`}. Súbelo con el botón de arriba.
        </div>
      )}

      {total > 0 && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <Kpi titulo="Guías comparadas" valor={fmt(total)}
                 sub={`${(100 * iguales / total).toLocaleString("es-CL", { maximumFractionDigits: 1 })}% calzan exacto`} color={NAVY} />
            {["distinto", "solo_automatico", "solo_manual", "otra_ruta"].map((t) => (
              <div key={t} onClick={() => setFiltro((x) => ({ ...x, tipo: x.tipo === t ? "" : t }))} style={{ cursor: "pointer", flex: 1, minWidth: 150 }}
                   title={TIPO_DIF[t].d}>
                <Kpi titulo={TIPO_DIF[t].t + (filtro.tipo === t ? " ✓" : "")} valor={fmt(cuenta(t))} sub={TIPO_DIF[t].d} color={TIPO_DIF[t].c} />
              </div>
            ))}
          </div>

          <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "10px 16px", marginBottom: 12,
                        display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>Diferencia en:</span>
            {CAMPOS.map((c) => {
              const nC = (filas || []).filter((r) => (r.diferencias || []).includes(c)).length;
              return nC ? (
                <button key={c} className="mj-btn" onClick={() => setFiltro((x) => ({ ...x, campo: x.campo === c ? "" : c }))}
                        style={filtro.campo === c ? { background: AMBAR, color: "#fff", borderColor: AMBAR } : {}}>{c} ({fmt(nC)})</button>
              ) : null;
            })}
            <input className="mj-input" placeholder="Buscar viaje, folio, patente, conductor…" value={filtro.busca}
                   onChange={(e) => setFiltro((x) => ({ ...x, busca: e.target.value }))} style={{ minWidth: 260, flex: 1 }} />
          </div>

          {!vistas.length ? (
            <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: 18, fontSize: 13, color: VERDE }}>
              {total === iguales ? "✓ El automático y el manual calzan en todas las guías." : "No hay diferencias con estos filtros."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="mj-tabla">
                <thead><tr><th>Fecha</th><th>ID viaje</th><th>Folio guía</th><th>Tipo</th><th>Diferencia en</th>
                  <th>Patente</th><th>CECO</th><th className="num">Carg.</th><th className="num">Entr.</th><th className="num">Dev.</th>
                  <th className="num">Volumen</th><th>Estado (DispatchTrack)</th></tr></thead>
                <tbody>
                  {vistas.slice(0, 3000).map((r) => (
                    <tr key={`${r.fecha}-${r.id_ruta}-${r.folio}-${r.tipo}`}>
                      <td style={{ whiteSpace: "nowrap" }}>{r.fecha}</td>
                      <td style={{ fontWeight: 700 }}>{r.id_ruta}{r.ruta_manual ? <div style={{ fontSize: 11, color: ROJO }}>manual: {r.ruta_manual}</div> : null}</td>
                      <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{r.folio}</td>
                      <td style={{ color: (TIPO_DIF[r.tipo] || {}).c, fontWeight: 700, whiteSpace: "nowrap" }} title={(TIPO_DIF[r.tipo] || {}).d}>
                        {(TIPO_DIF[r.tipo] || {}).t || r.tipo}</td>
                      <td style={{ fontSize: 12 }}>{(r.diferencias || []).join(" · ")}</td>
                      <td style={{ fontSize: 12 }}>{par(r.a_patente, r.m_patente)}</td>
                      <td style={{ fontSize: 12 }}>{par(r.a_cecos, r.m_cecos)}</td>
                      <td className="num">{par(r.a_cargados, r.m_cargados)}</td>
                      <td className="num">{par(r.a_entregados, r.m_entregados)}</td>
                      <td className="num">{par(r.a_devueltos, r.m_devueltos)}</td>
                      <td className="num">{par(r.a_volumen, r.m_volumen, true)}</td>
                      <td style={{ fontSize: 12, color: (ESTADO[r.estado] || {}).c || "#64748b", whiteSpace: "nowrap" }}>
                        {(ESTADO[r.estado] || {}).t || r.estado || "—"}{r.subestado ? ` · ${r.subestado}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {vistas.length > 3000 && <div style={{ fontSize: 12, color: "#64748b", padding: 8 }}>Se muestran 3.000 de {fmt(vistas.length)}: usa los filtros o descarga las diferencias.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MaestroCanon({ fecha, api, apiSuave, descargarCSV }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState("guias");   // guias · rutas · comparar
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

      {vista !== "comparar" && <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <Kpi titulo="Guías UM" valor={fmt(um.length)} sub={`${fmt(tr.length)} troncales · ${fmt(rutasIds.length)} rutas`} />
        <Kpi titulo="Cargados UM" valor={fmt(cargUM)} sub="líneas de producto" />
        <Kpi titulo="Entregados UM" valor={fmt(suma(um, "entregados"))} color={VERDE}
             sub={cargUM ? `${(100 * suma(um, "entregados") / cargUM).toLocaleString("es-CL", { maximumFractionDigits: 1 })}% de lo cargado` : ""} />
        <Kpi titulo="Devueltos UM" valor={fmt(suma(um, "devueltos"))} color={ROJO} sub="líneas no entregadas" />
        <Kpi titulo="Volumen UM" valor={vol(suma(um, "VOLUMEN"))} sub={`troncal ${vol(suma(tr, "VOLUMEN"))}`} />
        <Kpi titulo="Alertas" valor={fmt(alertas.length)} color={alertas.length ? AMBAR : VERDE} sub="guías para revisar" />
      </div>}

      <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "10px 16px", marginBottom: 12,
                    display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {vista !== "comparar" && <>
        <input className="mj-input" placeholder="Buscar ruta, folio, patente, conductor o dirección…" value={f.busca}
               onChange={(e) => setF((x) => ({ ...x, busca: e.target.value }))} style={{ minWidth: 300, flex: 1 }} />
        {chip("servicio", "UM", "UM")}{chip("servicio", "TRONCAL", "Troncal")}
        {chip("cecos", "C_RM", "C_RM")}{chip("cecos", "C_VIÑA", "C_VIÑA")}{chip("cecos", "_sin", "Sin CECO")}
        <button className="mj-btn" onClick={() => setF((x) => ({ ...x, soloAlertas: !x.soloAlertas }))}
                style={f.soloAlertas ? { background: AMBAR, color: "#fff", borderColor: AMBAR } : {}}>⚠ Solo alertas</button>
        </>}
        <span style={{ flex: 1 }} />
        {[["guias", "Por guía"], ["rutas", "Por ruta"], ["comparar", "Comparar con manual"]].map(([k, t]) => (
          <button key={k} className="mj-btn" onClick={() => setVista(k)}
                  style={vista === k ? { background: NAVY, color: "#fff", borderColor: NAVY } : {}}>{t}</button>
        ))}
        {vista !== "comparar" && <>
        <button className="mj-btn" onClick={descargar} disabled={!vistaFilas.length}>Descargar CSV</button>
        <button className="mj-btn" onClick={cargar}>↻ Actualizar</button>
        </>}
      </div>

      {vista === "comparar" && <CompararManual fecha={fecha} api={api} descargarCSV={descargarCSV} />}

      {vista !== "comparar" && !filas.length && !error && (
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
