import { useCallback, useEffect, useMemo, useState } from "react";
import { fechaHoyOperativa, sb } from "./shared";

// ═══════════════════════════════════════════════════════════════════
//  CAPACIDAD MX — subpestaña de Indicadores Operacionales MX (Pool)
//  Demanda esperada por site para hoy y los próximos 9 días, contra la
//  capacidad demostrada de cada site.
//  Fuentes (Supabase):
//    v_cap_pronostico_ultimo → última estimación por site, día y flota
//                              (la escribe /opt/capacidad/cap_estimador.py:
//                               cada 30 min hoy y mañana, y a las 23:30 los 9 días)
//    v_cap_techo             → capacidad demostrada: P90 de rutas ejecutadas por
//                              día en las últimas 4 semanas
//    cap_pronostico          → hora de la última estimación
//  Colores: rojo = la SDD supera la capacidad (multa segura si no se cubre);
//           amarillo = la SDD cabe pero el Spot ofrecido la supera (decidir cuánto tomar);
//           verde = todo cabe.
// ═══════════════════════════════════════════════════════════════════

const CAP_DIAS = 10;               // hoy + 9 días
const CAP_ALERTA_MIN = 45;         // el estimador corre cada 30 min: más de 45 es señal de falla
const CAP_NAVY = "#1a3a6b";
const CAP_MUTED = "#5b6474";
const CAP_BORDER = "#e4e7ec";
const CAP_ESTADOS = {
  v: { txt: "Cabe", bg: "#e7f6ec", fg: "#15803d", sub: "#3d4a3f" },
  a: { txt: "Spot excede", bg: "#fff4d6", fg: "#7a4f00", sub: "#5c4300" },
  r: { txt: "SDD no cabe", bg: "#fde8e6", fg: "#b42318", sub: "#7a1a12" },
};
const CAP_LEYENDA = [
  { id: "v", titulo: "Verde, cabe", muestra: "6", bg: "#e7f6ec", fg: "#15803d", borde: "none", outline: "none",
    texto: "La SDD y el Spot esperados entran en la capacidad del site. No hace falta hacer nada." },
  { id: "a", titulo: "Amarillo, el Spot excede", muestra: "9", bg: "#fff4d6", fg: "#7a4f00", borde: "none", outline: "none",
    texto: "La SDD cabe, pero MELI ofrece más Spot del que el site puede hacer. Tomar solo el Spot que tenga unidad confirmada." },
  { id: "r", titulo: "Rojo, la SDD no cabe", muestra: "10", bg: "#fde8e6", fg: "#b42318", borde: "none", outline: "2px solid #b42318",
    texto: "La SDD sola supera la capacidad. Conseguir unidades antes del día o habrá multa por rechazo o por no salir." },
  { id: "g", titulo: "Gris, sin estimación", muestra: "", bg: "#f6f7f9", fg: "#5b6474", borde: "1px dashed #c9ced6", outline: "none",
    texto: "Ese día todavía no se calcula. La estimación de 9 días se hace cada noche a las 23:30." },
];
const CAP_NOMBRE_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const capSumar = (iso, n) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const capDiaSemana = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
// Todo se muestra en rutas enteras: el día normal redondeado y el día malo hacia arriba
const capFmt = (v) => (v == null || Number.isNaN(v) ? "—" : String(Math.round(v)));
const capFmtSigno = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + capFmt(Math.abs(v));

// Nivel de confianza de cada celda, según las pruebas contra el pasado:
//   alta  = casi todo es SDD, o el Spot de hoy ya llegó en su mayoría (acierto ~90% o más)
//   media = Spot de hoy o de mañana (acierto ~60% a 75%)
//   baja  = Spot a 2 o más días (acierto ~40%: solo orden de magnitud)
function capConfianza(c, h) {
  if (c.spot <= 1) return "alta";
  if (h === 0 && c.spotRec >= 0.75 * c.spot) return "alta";
  if (h <= 1) return "media";
  return "baja";
}
const CAP_CONF = {
  alta: { txt: "Alta", fg: "#15803d", texto: "Casi todo es SDD o ya llegó. Acierta 9 de cada 10 veces con ±1 ruta." },
  media: { txt: "Media", fg: "#7a4f00", texto: "Spot de hoy o mañana. Acierto de 60% a 75%: planificar con el número de “hasta”." },
  baja: { txt: "Baja", fg: "#b42318", texto: "Spot a 2 o más días. Acierto cercano a 40%: tomarlo solo como orden de magnitud." },
};

function capEstado(c, techo) {
  if (c.sdd > techo + 1e-9) return "r";
  if (c.total > techo + 1e-9) return "a";
  return "v";
}

function capAccion(c, techo) {
  if (c.sdd > techo + 1e-9) {
    const n = Math.ceil(c.sdd - techo);
    return `SDD sobre la capacidad: conseguir ${n} unidad${n === 1 ? "" : "es"} o habrá multa`;
  }
  if (c.total > techo + 1e-9) return `El Spot excede en ${capFmt(c.total - techo)}: tomar solo con unidad confirmada`;
  if (c.malo > techo + 1e-9) {
    const n = Math.ceil(c.malo - techo);
    return `Cabe en un día normal; el día malo pide ${n} unidad${n === 1 ? "" : "es"} más`;
  }
  return "Holgado";
}

export default function CapacidadMX() {
  const hoy = fechaHoyOperativa();
  const dias = useMemo(() => Array.from({ length: CAP_DIAS }, (_, i) => capSumar(hoy, i)), [hoy]);
  const [pron, setPron] = useState([]);
  const [techos, setTechos] = useState({});
  const [ultima, setUltima] = useState(null);
  const [diaDet, setDiaDet] = useState(() => capSumar(fechaHoyOperativa(), 1));
  // Filtro de las tarjetas: null | "sdd" | "spot" (qué se muestra) | "rojos" | "exceso" (qué sites)
  const [filtro, setFiltro] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [rP, rT, rU] = await Promise.all([
        sb.from("v_cap_pronostico_ultimo").select("*")
          .gte("fecha_ruta", dias[0]).lte("fecha_ruta", dias[dias.length - 1]).limit(2000),
        sb.from("v_cap_techo").select("*"),
        sb.from("cap_pronostico").select("generado_el").order("generado_el", { ascending: false }).limit(1),
      ]);
      if (rP.error) throw rP.error;
      if (rT.error) throw rT.error;
      if (rU.error) throw rU.error;
      setPron(rP.data || []);
      const t = {};
      // capacidad en rutas enteras, hacia abajo (conservador)
      for (const r of rT.data || []) t[r.facility_id] = Math.floor((Number(r.techo) || 0) + 1e-9);
      setTechos(t);
      setUltima(rU.data?.[0]?.generado_el || null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCargando(false);
    }
  }, [dias]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 60_000);
    return () => clearInterval(t);
  }, [cargar]);

  // celdas[site][fecha] = { sdd, spot, total, malo, sddRec, spotRec, estado }
  const { sites, celdas } = useMemo(() => {
    const m = {};
    for (const r of pron) {
      const s = (m[r.facility_id] = m[r.facility_id] || {});
      const c = (s[r.fecha_ruta] = s[r.fecha_ruta] || { sdd: 0, spot: 0, sddMalo: 0, spotMalo: 0, sddRec: 0, spotRec: 0 });
      // rutas enteras: día normal redondeado, día malo redondeado hacia arriba
      const p50 = Math.round(Number(r.p50) || 0);
      const p90 = Math.max(Math.ceil((Number(r.p90) || 0) - 1e-9), p50);
      if (r.flota === "fija") {
        c.sdd = p50; c.sddMalo = p90; c.sddRec = r.recibidas || 0;
      } else {
        c.spot = p50; c.spotMalo = p90; c.spotRec = r.recibidas || 0;
      }
    }
    for (const [site, porDia] of Object.entries(m)) {
      const techo = techos[site] ?? 0;
      for (const [fecha, c] of Object.entries(porDia)) {
        c.total = c.sdd + c.spot;
        c.malo = Math.max(c.sddMalo + c.spotMalo, c.total);
        c.estado = capEstado(c, techo);
        c.conf = capConfianza(c, dias.indexOf(fecha));
      }
    }
    const lista = Object.keys(m).sort((a, b) => (techos[b] ?? 0) - (techos[a] ?? 0) || a.localeCompare(b));
    return { sites: lista, celdas: m };
  }, [pron, techos, dias]);

  const manana = dias[1];
  const tarjetas = useMemo(() => {
    let sdd = 0, spot = 0, spotRec = 0, exceso = 0, mayor = null;
    const rojos = [];
    for (const site of sites) {
      const c = celdas[site]?.[manana];
      if (!c) continue;
      const techo = techos[site] ?? 0;
      sdd += c.sdd; spot += c.spot; spotRec += c.spotRec;
      const e = Math.max(0, c.total - techo);
      exceso += e;
      if (e > 0 && (!mayor || e > mayor.e)) mayor = { site, e };
      if (c.estado === "r") rojos.push(`${site}: ${capFmt(c.sdd)} SDD contra capacidad de ${capFmt(techo)}`);
    }
    return { sdd, spot, spotRec, exceso, mayor, rojos };
  }, [sites, celdas, techos, manana]);

  const sitesVisibles = useMemo(() => {
    if (filtro === "rojos") return sites.filter((s) => celdas[s]?.[manana]?.estado === "r");
    if (filtro === "exceso") return sites.filter((s) => ["a", "r"].includes(celdas[s]?.[manana]?.estado));
    return sites;
  }, [filtro, sites, celdas, manana]);

  const tocarTarjeta = (f) => {
    const nuevo = filtro === f ? null : f;
    setFiltro(nuevo);
    if (nuevo === "rojos" || nuevo === "exceso") setDiaDet(manana);
  };
  // Qué número muestra cada celda según el filtro
  const valorCelda = (c) => (filtro === "sdd" ? c.sdd : filtro === "spot" ? c.spot : c.total);
  const maloCelda = (c) => (filtro === "sdd" ? c.sddMalo : filtro === "spot" ? c.spotMalo : c.malo);
  const confCelda = (c) => (filtro === "sdd" ? "alta" : c.conf);
  const textoFiltro = {
    sdd: "Mostrando solo la SDD de cada site",
    spot: "Mostrando solo el Spot de cada site",
    rojos: "Mostrando solo los sites con la SDD de mañana sobre su capacidad",
    exceso: "Mostrando solo los sites donde mañana se espera más de lo que pueden hacer",
  };

  const detalle = useMemo(() => sitesVisibles
    .map((site) => {
      const c = celdas[site]?.[diaDet];
      if (!c) return null;
      const techo = techos[site] ?? 0;
      return { site, c, techo, brecha: c.total - techo, accion: capAccion(c, techo) };
    })
    .filter(Boolean)
    .sort((a, b) => b.brecha - a.brecha), [sitesVisibles, celdas, techos, diaDet]);

  const minDesde = ultima ? Math.round((Date.now() - new Date(ultima).getTime()) / 60000) : null;
  const horaUltima = ultima
    ? new Date(ultima).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" })
    : null;
  const etiquetaDia = (f, i) => (i === 0 ? "Hoy" : i === 1 ? "Mañana" : CAP_NOMBRE_DIA[capDiaSemana(f)]);
  const card = { background: "#fff", border: `1px solid ${CAP_BORDER}`, borderRadius: 12, padding: "18px 22px" };
  const th = { padding: "6px 8px", borderBottom: `1px solid ${CAP_BORDER}`, fontWeight: 600 };
  const thNum = { ...th, textAlign: "right" };
  const tdNum = { padding: 8, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ padding: 24, background: "#f0f2f5", minHeight: "100%", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: CAP_NAVY }}>Capacidad MX: demanda esperada y flota</div>
          <div style={{ fontSize: 13, color: CAP_MUTED, marginTop: 4 }}>
            Estimación por site cada 30 minutos (05:00 a 23:00 México) y a 9 días cada noche.{" "}
            {minDesde != null && (
              <b style={{ color: minDesde > CAP_ALERTA_MIN ? "#b42318" : "#15803d" }}>
                Última estimación: {horaUltima}, hace {minDesde} min{minDesde > CAP_ALERTA_MIN ? ". Revisa el proceso en el VPS" : ""}
              </b>
            )}
          </div>
        </div>
      </div>

      {error && <div style={{ ...card, color: "#b42318" }}>No se pudo leer la estimación: {error}. Revisa que existan v_cap_pronostico_ultimo y v_cap_techo.</div>}
      {cargando && <div style={{ ...card, color: CAP_MUTED }}>Cargando…</div>}
      {!cargando && !error && sites.length === 0 && (
        <div style={{ ...card, color: CAP_MUTED }}>Todavía no hay estimaciones. El estimador escribe cada 30 minutos entre las 05:00 y las 23:00 de México.</div>
      )}

      {!cargando && !error && sites.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {[
              { id: "sdd", color: CAP_NAVY, num: CAP_NAVY, titulo: "SDD esperada para mañana",
                valor: Math.round(tarjetas.sdd), pie: "La tarde anterior ya está toda a la vista" },
              { id: "spot", color: "#F47B20", num: "#9a4a0c", titulo: "Spot esperado para mañana",
                valor: `≈ ${Math.round(tarjetas.spot)}`, pie: `${tarjetas.spotRec} ya recibidas; el resto suele llegar hoy y mañana` },
              { id: "rojos", color: "#b42318", num: "#b42318", titulo: "Sites con SDD sobre su capacidad mañana",
                valor: tarjetas.rojos.length, pie: tarjetas.rojos.length ? tarjetas.rojos.join(" · ") : "Ninguno: la SDD cabe en todos" },
              { id: "exceso", color: "#7a4f00", num: "#7a4f00", titulo: "Rutas esperadas sobre la capacidad mañana",
                valor: Math.round(tarjetas.exceso), pie: tarjetas.mayor ? `${capFmt(tarjetas.mayor.e)} en ${tarjetas.mayor.site}: decidir hoy cuánto Spot tomar` : "Todo cabe en un día normal" },
            ].map((t) => {
              const act = filtro === t.id;
              return (
                <button key={t.id} onClick={() => tocarTarjeta(t.id)} aria-pressed={act}
                  style={{ ...card, padding: "14px 16px", borderTop: `4px solid ${t.color}`, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                    background: act ? "#f3f6fb" : "#fff", boxShadow: act ? `inset 0 0 0 2px ${t.color}` : "none" }}>
                  <div style={{ fontSize: 13, color: CAP_MUTED, display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{t.titulo}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: act ? t.num : "#8a93a3", whiteSpace: "nowrap" }}>{act ? "Filtro activo" : "Filtrar"}</span>
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 700, color: t.num, fontVariantNumeric: "tabular-nums" }}>{t.valor}</div>
                  <div style={{ fontSize: 12, color: CAP_MUTED }}>{t.pie}</div>
                </button>
              );
            })}
          </div>

          {filtro && (
            <div style={{ ...card, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", background: "#f3f6fb" }}>
              <span style={{ fontSize: 13, color: CAP_NAVY, fontWeight: 600 }}>{textoFiltro[filtro]}</span>
              <button onClick={() => setFiltro(null)}
                style={{ border: `1px solid ${CAP_NAVY}`, background: "#fff", color: CAP_NAVY, borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                Quitar filtro
              </button>
            </div>
          )}

          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Planificación: hoy y los próximos 9 días</div>
            <div style={{ fontSize: 12, color: CAP_MUTED, marginBottom: 12, lineHeight: 1.5 }}>
              Cada celda muestra las rutas esperadas en un día normal (número grande), cuántas son SDD y cuántas Spot, y hasta cuántas podría pedir MELI en un día exigente.
              La capacidad es lo que el site ejecutó en un día bueno durante las últimas 4 semanas. Toca un día para ver su detalle abajo.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 14 }}>
              {CAP_LEYENDA.map((l) => (
                <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div aria-hidden="true" style={{ flex: "0 0 38px", height: 30, borderRadius: 6, background: l.bg, border: l.borde, outline: l.outline, outlineOffset: -2,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: l.fg }}>{l.muestra}</div>
                  <div style={{ fontSize: 12, color: "#3a414d", lineHeight: 1.4 }}>
                    <b style={{ color: l.fg }}>{l.titulo}.</b> {l.texto}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: "#3a414d", marginBottom: 14, paddingTop: 10, borderTop: "1px solid #f0f1f3" }}>
              <b style={{ color: "#1a1a1a" }}>Nivel de confianza:</b>
              {Object.entries(CAP_CONF).map(([k, v]) => (
                <span key={k} style={{ flex: "1 1 260px" }}><b style={{ color: v.fg }}>{v.txt}.</b> {v.texto}</span>
              ))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: `130px repeat(${CAP_DIAS}, minmax(96px, 1fr))`, gap: 6, minWidth: 1150 }}>
                <div style={{ fontSize: 12, color: CAP_MUTED, fontWeight: 600, padding: "6px 4px" }}>Site y capacidad</div>
                {dias.map((f, i) => (
                  <button key={f} onClick={() => setDiaDet(f)}
                    style={{ border: "none", background: f === diaDet ? "#e8eef7" : "transparent", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", padding: "6px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>{etiquetaDia(f, i)}</div>
                    <div style={{ fontSize: 11, color: CAP_MUTED }}>{f.slice(8, 10)}/{f.slice(5, 7)}</div>
                  </button>
                ))}
                {sitesVisibles.map((site) => (
                  <div key={site} style={{ display: "contents" }}>
                    <div style={{ padding: "8px 4px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{site}</div>
                      <div style={{ fontSize: 11, color: CAP_MUTED }}>capacidad {capFmt(techos[site] ?? 0)}</div>
                    </div>
                    {dias.map((f) => {
                      const c = celdas[site]?.[f];
                      if (!c) {
                        return (
                          <div key={f} style={{ background: "#f6f7f9", border: "1px dashed #c9ced6", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 8px" }}>
                            <span style={{ fontSize: 10, color: CAP_MUTED }}>sin estimación</span>
                          </div>
                        );
                      }
                      const e = CAP_ESTADOS[c.estado];
                      return (
                        <div key={f} title={`${site} ${f}: ${e.txt}. Confianza ${CAP_CONF[confCelda(c)].txt.toLowerCase()}: ${CAP_CONF[confCelda(c)].texto}`}
                          style={{ background: e.bg, borderRadius: 8, padding: "7px 8px", textAlign: "center", outline: c.estado === "r" ? `2px solid ${e.fg}` : "none", outlineOffset: -2 }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: e.fg, fontVariantNumeric: "tabular-nums" }}>{capFmt(valorCelda(c))}</div>
                          <div style={{ fontSize: 10, color: e.sub }}>SDD {capFmt(c.sdd)} · Spot {capFmt(c.spot)}</div>
                          <div style={{ fontSize: 10, color: e.sub }}>hasta {capFmt(maloCelda(c))} · confianza <b>{CAP_CONF[confCelda(c)].txt.toLowerCase()}</b></div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                Detalle por site: {etiquetaDia(diaDet, dias.indexOf(diaDet)).toLowerCase()} {diaDet.slice(8, 10)}/{diaDet.slice(5, 7)}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {dias.map((f, i) => {
                  const act = f === diaDet;
                  return (
                    <button key={f} onClick={() => setDiaDet(f)}
                      style={{ border: `1px solid ${act ? CAP_NAVY : CAP_BORDER}`, background: act ? CAP_NAVY : "#fff", color: act ? "#fff" : "#1a1a1a", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      {i < 2 ? etiquetaDia(f, i) : CAP_NOMBRE_DIA[capDiaSemana(f)].slice(0, 3)} {f.slice(8, 10)}
                    </button>
                  );
                })}
              </div>
            </div>
            {detalle.length === 0 ? (
              <div style={{ fontSize: 13, color: CAP_MUTED }}>
                {filtro && sitesVisibles.length === 0
                  ? "Ningún site cumple este filtro mañana. Quita el filtro para ver todos."
                  : "Ese día todavía no tiene estimación. La de 9 días se calcula cada noche a las 23:30."}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 980 }}>
                  <thead>
                    <tr style={{ color: CAP_MUTED, fontSize: 12, textAlign: "left" }}>
                      <th style={th}>Site</th>
                      <th style={thNum}>SDD</th>
                      <th style={thNum}>Spot recibido</th>
                      <th style={thNum}>Spot por llegar</th>
                      <th style={thNum}>Esperadas / hasta</th>
                      <th style={thNum}>Capacidad</th>
                      <th style={thNum}>Brecha</th>
                      <th style={th}>Confianza</th>
                      <th style={th}>Qué hacer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.map(({ site, c, techo, brecha, accion }) => (
                      <tr key={site} style={{ borderBottom: "1px solid #f0f1f3" }}>
                        <td style={{ padding: 8, fontWeight: 700 }}>{site}</td>
                        <td style={tdNum} title={c.sddRec === 0 && c.sdd > 0 ? "MELI aún no publica la SDD de ese día: se usa la de la semana pasada" : c.sddRec < c.sdd ? `${c.sddRec} ya recibidas` : "Toda recibida"}>
                          {capFmt(c.sdd)}
                          {c.sddRec === 0 && c.sdd > 0
                            ? <span style={{ color: CAP_MUTED, fontSize: 11 }}> (sin publicar)</span>
                            : c.sddRec < c.sdd && <span style={{ color: CAP_MUTED, fontSize: 11 }}> ({c.sddRec} recib.)</span>}
                        </td>
                        <td style={tdNum}>{c.spotRec}</td>
                        <td style={{ ...tdNum, color: CAP_MUTED }}>{capFmt(Math.max(0, c.spot - c.spotRec))}</td>
                        <td style={tdNum}>{capFmt(c.total)} / {capFmt(c.malo)}</td>
                        <td style={tdNum}>{capFmt(techo)}</td>
                        <td style={{ ...tdNum, fontWeight: brecha > 0.05 ? 700 : 400, color: brecha > 0.05 ? "#b42318" : "#15803d" }}>{capFmtSigno(brecha)}</td>
                        <td style={{ padding: 8, fontWeight: 700, color: CAP_CONF[c.conf].fg }} title={CAP_CONF[c.conf].texto}>{CAP_CONF[c.conf].txt}</td>
                        <td style={{ padding: 8, color: "#3a414d" }}>{accion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontSize: 12, color: CAP_MUTED, marginTop: 8, lineHeight: 1.5 }}>
              Brecha: lo esperado en un día normal menos la capacidad del site. Si es positiva, faltan unidades para cubrir todo. El Spot que excede es una oportunidad; la SDD que excede es multa segura si no se cubre.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
