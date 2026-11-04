// ═══════════════════════════════════════════════════════════════════════════
// ACEPTACIÓN DE RUTAS · CHILE  (módulo propio del Brain)
// Por SC y por día de ruta: rutas totales, aceptadas, rechazadas, canceladas y
// pendientes, y si el SC cumplió con aceptar todo antes de las 20:30 del día
// anterior (regla de Bigticket; MELI da 24 h).
//
// Fuentes en bigticket-cl (las llena el vigilante aceptacion-cl del VPS de Chile,
// que lee los pedidos de MELI cada 5 minutos):
//   • vw_aceptacion_sc_dia   → una fila por SC y día de ruta, con el corte de las 20:30
//   • cl_aceptacion_avisos   → correos enviados por rutas sin aceptar después del corte
//
// Regla de cumplimiento: un SC cumple si todas las rutas que MELI ofreció antes
// del corte quedaron aceptadas a esa hora. Las canceladas por MELI no cuentan;
// una rechazada cuenta como no aceptada. Las rutas aceptadas antes de que
// existiera el vigilante (4-nov-2026) no tienen hora: quedan como "Sin dato".
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from "react";

const NAVY = "#1a3a6b";
const VERDE = "#0d8043";
const ROJO = "#b42318";
const AMBAR = "#a16207";
const AZUL = "#2563eb";
const GRIS = "#8a94a6";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";
const PAGINA_MELI = "https://envios.adminml.com/logistics/travel-requests/last-mile";

async function api(path) {
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, { headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}` } });
  if (!r.ok) throw new Error(`La consulta falló (HTTP ${r.status}). ${(await r.text()).slice(0, 250)}`);
  return r.json();
}

// ── Fechas y horas en Chile ─────────────────────────────────────────────────
const TZ = "America/Santiago";
const hoyChile = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sumarDias = (iso, d) => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const diaTexto = (f) => `${DIAS[new Date(f + "T12:00:00Z").getUTCDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`;
const diaCorto = (f) => `${DIAS_CORTOS[new Date(f + "T12:00:00Z").getUTCDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`;
const hora = (ts) => {
  if (!ts) return "—";
  try { return new Intl.DateTimeFormat("es-CL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)); }
  catch (e) { return "—"; }
};
const fechaHora = (ts) => {
  if (!ts) return "—";
  try { return new Intl.DateTimeFormat("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)); }
  catch (e) { return "—"; }
};
const duracion = (ms) => {
  const min = Math.max(0, Math.round(ms / 60000)), h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
};
const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));

// ── Estado de cumplimiento de un SC en un día ───────────────────────────────
const ESTADOS = {
  en_plazo:  { rotulo: "En plazo",   color: AZUL,  fondo: "#eaf1ff" },
  cumple:    { rotulo: "Cumple",     color: VERDE, fondo: "#e7f6ee" },
  no_cumple: { rotulo: "No cumple",  color: ROJO,  fondo: "#fdecec" },
  sin_dato:  { rotulo: "Sin dato",   color: GRIS,  fondo: "#f1f5f9" },
};
function estadoDe(f, ahora) {
  if (!f.corte || ahora < new Date(f.corte).getTime()) return "en_plazo";
  if (n(f.sin_aceptar_al_corte) > 0) return "no_cumple";
  if (n(f.sin_hora) > 0) return "sin_dato";
  return "cumple";
}

function Etiqueta({ estado, extra }) {
  const e = ESTADOS[estado];
  return (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                   color: e.color, background: e.fondo, whiteSpace: "nowrap" }}>
      {e.rotulo}{extra ? ` · ${extra}` : ""}
    </span>
  );
}

function Tarjeta({ titulo, valor, color, sub }) {
  return (
    <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "12px 16px", minWidth: 130, flex: 1 }}>
      <div style={{ fontSize: 11.5, color: "#667085", fontWeight: 600 }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || NAVY, marginTop: 2 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: "#8a94a6", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function descargarCSV(nombre, filas, columnas) {
  if (!filas.length) return;
  const esc = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cuerpo = [columnas.map((c) => esc(c.titulo)).join(";"), ...filas.map((f) => columnas.map((c) => esc(c.valor(f))).join(";"))].join("\r\n");
  const blob = new Blob(["\uFEFF" + cuerpo], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const th = { padding: "8px 10px", fontSize: 11.5, fontWeight: 700, color: "#475467", textAlign: "center", borderBottom: "1px solid #e4e7ec", whiteSpace: "nowrap", background: "#f8f9fb" };
const td = { padding: "8px 10px", fontSize: 13, textAlign: "center", borderBottom: "0.5px solid #eef0f3", whiteSpace: "nowrap" };
const DIAS_HISTORIAL = 14;

export default function ModuloAceptacionCL() {
  const hoy = hoyChile();
  const [fecha, setFecha] = useState(sumarDias(hoy, 1));   // por defecto, las rutas de mañana (su corte es hoy a las 20:30)
  const [filas, setFilas] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [ahora, setAhora] = useState(Date.now());
  const [actualizado, setActualizado] = useState(null);

  const cargar = async () => {
    setError("");
    try {
      const desde = sumarDias(hoy, -(DIAS_HISTORIAL - 2)), hasta = sumarDias(hoy, 1);
      const [dia, hist, av] = await Promise.all([
        api(`vw_aceptacion_sc_dia?fecha_ruta=eq.${fecha}&order=facility_id`),
        api(`vw_aceptacion_sc_dia?select=fecha_ruta,facility_id,nombre,totales,canceladas,sin_aceptar_al_corte,sin_hora,corte&fecha_ruta=gte.${desde}&fecha_ruta=lte.${hasta}&order=fecha_ruta`),
        api(`cl_aceptacion_avisos?fecha_ruta=eq.${fecha}&order=enviado_at`),
      ]);
      setFilas(dia || []); setHistorial(hist || []); setAvisos(av || []);
      setActualizado(new Date());
    } catch (e) { setError(e.message || String(e)); }
    finally { setCargando(false); }
  };
  useEffect(() => { setCargando(true); cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, [fecha]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(t); }, []);

  // El corte de la fecha elegida: 20:30 del día anterior (lo trae la vista; si no hay filas, se muestra igual)
  const corte = filas[0]?.corte || null;
  const corteCerrado = corte ? ahora >= new Date(corte).getTime() : false;

  const conEstado = useMemo(() => filas.map((f) => ({ ...f, estado: estadoDe(f, ahora) }))
    .sort((a, b) => ["no_cumple", "en_plazo", "sin_dato", "cumple"].indexOf(a.estado) - ["no_cumple", "en_plazo", "sin_dato", "cumple"].indexOf(b.estado)
      || (a.nombre || a.facility_id).localeCompare(b.nombre || b.facility_id)), [filas, ahora]);

  const tot = useMemo(() => conEstado.reduce((t, f) => ({
    totales: t.totales + n(f.totales), aceptadas: t.aceptadas + n(f.aceptadas), rechazadas: t.rechazadas + n(f.rechazadas),
    canceladas: t.canceladas + n(f.canceladas), pendientes: t.pendientes + n(f.pendientes),
    cumplen: t.cumplen + (f.estado === "cumple" ? 1 : 0), noCumplen: t.noCumplen + (f.estado === "no_cumple" ? 1 : 0),
  }), { totales: 0, aceptadas: 0, rechazadas: 0, canceladas: 0, pendientes: 0, cumplen: 0, noCumplen: 0 }), [conEstado]);

  // Historial: SC × día de ruta
  const hist = useMemo(() => {
    const fechas = [...new Set(historial.map((h) => h.fecha_ruta))].sort();
    const porSc = new Map();
    for (const h of historial) {
      const k = h.facility_id;
      if (!porSc.has(k)) porSc.set(k, { facility_id: k, nombre: h.nombre, dias: {} });
      porSc.get(k).dias[h.fecha_ruta] = { ...h, estado: estadoDe(h, ahora) };
    }
    const scs = [...porSc.values()].sort((a, b) => (a.nombre || a.facility_id).localeCompare(b.nombre || b.facility_id));
    for (const s of scs) {
      const cerrados = Object.values(s.dias).filter((d) => d.estado === "cumple" || d.estado === "no_cumple");
      s.cumplidos = cerrados.filter((d) => d.estado === "cumple").length;
      s.medidos = cerrados.length;
    }
    return { fechas, scs };
  }, [historial, ahora]);

  const exportar = () => descargarCSV(`aceptacion_rutas_${fecha}`, conEstado, [
    { titulo: "Fecha ruta", valor: () => fecha },
    { titulo: "SC", valor: (f) => f.nombre || f.facility_id },
    { titulo: "Código MELI", valor: (f) => f.facility_id },
    { titulo: "CECO", valor: (f) => f.ceco || "" },
    { titulo: "Totales", valor: (f) => n(f.totales) },
    { titulo: "Aceptadas", valor: (f) => n(f.aceptadas) },
    { titulo: "Rechazadas", valor: (f) => n(f.rechazadas) },
    { titulo: "Canceladas", valor: (f) => n(f.canceladas) },
    { titulo: "Pendientes", valor: (f) => n(f.pendientes) },
    { titulo: "Sin aceptar al corte", valor: (f) => n(f.sin_aceptar_al_corte) },
    { titulo: "Última aceptación", valor: (f) => fechaHora(f.ultima_aceptacion) },
    { titulo: "Estado 20:30", valor: (f) => ESTADOS[f.estado].rotulo },
  ]);

  const botonDia = (f, texto) => (
    <button onClick={() => setFecha(f)}
      style={{ padding: "6px 12px", fontSize: 12.5, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
               border: fecha === f ? `1px solid ${NAVY}` : "0.5px solid #d0d5dd", background: fecha === f ? "#eef2ff" : "#fff",
               color: fecha === f ? NAVY : "#475467", fontWeight: fecha === f ? 700 : 500 }}>{texto}</button>
  );

  return (
    <div style={{ padding: "18px 20px", maxWidth: 1300, margin: "0 auto" }}>
      {/* Encabezado */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>Aceptación de Rutas</div>
          <div style={{ fontSize: 12.5, color: "#667085", marginTop: 3, maxWidth: 720 }}>
            Rutas de MELI por SC. MELI da 24 h para aceptar, pero en Bigticket todas las rutas deben quedar aceptadas
            antes de las <b>20:30 del día anterior</b>. Se actualiza cada 5 minutos.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {botonDia(hoy, "Hoy")}
          {botonDia(sumarDias(hoy, 1), "Mañana")}
          <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)}
            style={{ padding: "5px 8px", fontSize: 12.5, borderRadius: 8, border: "0.5px solid #d0d5dd", fontFamily: "inherit" }} />
          <button onClick={exportar} disabled={!conEstado.length}
            style={{ padding: "6px 12px", fontSize: 12.5, borderRadius: 8, border: "0.5px solid #d0d5dd", background: "#fff", cursor: "pointer", fontFamily: "inherit", color: NAVY }}>
            ⬇ Descargar
          </button>
        </div>
      </div>

      {/* Corte */}
      <div style={{ background: corteCerrado ? (tot.noCumplen ? "#fdecec" : "#e7f6ee") : "#eaf1ff", border: "0.5px solid #e4e7ec",
                    borderRadius: 12, padding: "10px 16px", marginBottom: 14, fontSize: 13, color: "#344054",
                    display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span>
          Rutas del <b>{diaTexto(fecha)}</b> · corte: <b>{diaTexto(sumarDias(fecha, -1))} a las 20:30</b>
          {corte && !corteCerrado && <> · faltan <b>{duracion(new Date(corte).getTime() - ahora)}</b>{tot.pendientes ? <> y hay <b style={{ color: ROJO }}>{tot.pendientes} por aceptar</b></> : null}</>}
          {corte && corteCerrado && <> · corte cerrado: <b style={{ color: tot.noCumplen ? ROJO : VERDE }}>{tot.cumplen} de {conEstado.length} SC cumplieron</b></>}
        </span>
        <span style={{ color: "#8a94a6", fontSize: 12 }}>
          {actualizado ? `Actualizado ${hora(actualizado)}` : ""} · <a href={PAGINA_MELI} target="_blank" rel="noreferrer" style={{ color: AZUL }}>Pedidos de vehículos en MELI</a>
        </span>
      </div>

      {error && <div style={{ background: "#fdecec", color: ROJO, padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {/* Totales */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Tarjeta titulo="Rutas totales" valor={tot.totales} />
        <Tarjeta titulo="Aceptadas" valor={tot.aceptadas} color={VERDE} sub={tot.totales ? `${Math.round((tot.aceptadas * 100) / tot.totales)} %` : null} />
        <Tarjeta titulo="Rechazadas" valor={tot.rechazadas} color={tot.rechazadas ? ROJO : NAVY} sub="incluye vencidas" />
        <Tarjeta titulo="Canceladas" valor={tot.canceladas} color={GRIS} sub="canceladas por MELI" />
        <Tarjeta titulo="Pendientes" valor={tot.pendientes} color={tot.pendientes ? AMBAR : NAVY} />
        <Tarjeta titulo="SC que cumplen" valor={corteCerrado ? `${tot.cumplen}/${conEstado.length}` : "—"} color={corteCerrado ? (tot.noCumplen ? ROJO : VERDE) : GRIS}
          sub={corteCerrado ? "todo aceptado a las 20:30" : "se mide al cierre del corte"} />
      </div>

      {/* Tabla por SC */}
      <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflowX: "auto", marginBottom: 18 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>SC</th>
              <th style={th}>Totales</th><th style={th}>Aceptadas</th><th style={th}>Rechazadas</th>
              <th style={th}>Canceladas</th><th style={th}>Pendientes</th><th style={th}>Última aceptación</th>
              <th style={th}>Antes de las 20:30</th>
            </tr>
          </thead>
          <tbody>
            {cargando && !conEstado.length && <tr><td style={{ ...td, color: GRIS }} colSpan={8}>Cargando…</td></tr>}
            {!cargando && !conEstado.length && <tr><td style={{ ...td, color: GRIS }} colSpan={8}>MELI todavía no ofrece rutas para el {diaTexto(fecha)}.</td></tr>}
            {conEstado.map((f) => (
              <tr key={f.facility_id}>
                <td style={{ ...td, textAlign: "left" }}>
                  <b style={{ color: NAVY }}>{f.nombre || f.facility_id}</b> <span style={{ color: GRIS, fontSize: 11.5 }}>({f.facility_id})</span>
                </td>
                <td style={{ ...td, fontWeight: 700 }}>{n(f.totales)}</td>
                <td style={{ ...td, color: VERDE, fontWeight: 600 }}>{n(f.aceptadas)}</td>
                <td style={{ ...td, color: n(f.rechazadas) ? ROJO : "#98a2b3" }}>{n(f.rechazadas)}</td>
                <td style={{ ...td, color: "#98a2b3" }}>{n(f.canceladas)}</td>
                <td style={{ ...td, color: n(f.pendientes) ? AMBAR : "#98a2b3", fontWeight: n(f.pendientes) ? 700 : 400 }}>{n(f.pendientes)}</td>
                <td style={td}>{fechaHora(f.ultima_aceptacion)}</td>
                <td style={td}>
                  <Etiqueta estado={f.estado}
                    extra={f.estado === "no_cumple" ? `${n(f.sin_aceptar_al_corte)} sin aceptar`
                         : f.estado === "en_plazo" && n(f.pendientes) ? `${n(f.pendientes)} por aceptar` : null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Historial */}
      <div style={{ fontSize: 15, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Cumplimiento de los últimos días</div>
      <div style={{ fontSize: 12, color: "#667085", marginBottom: 8 }}>
        ✓ todo aceptado antes de las 20:30 · ✗ quedaron rutas sin aceptar (el número) · · sin dato · ⏳ en plazo. El registro parte el 04/11/2026.
      </div>
      <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflowX: "auto", marginBottom: 18 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>SC</th>
              {hist.fechas.map((f) => <th key={f} style={th}>{diaCorto(f)}</th>)}
              <th style={th}>Cumple</th>
            </tr>
          </thead>
          <tbody>
            {!hist.scs.length && <tr><td style={{ ...td, color: GRIS }} colSpan={hist.fechas.length + 2}>Sin datos todavía.</td></tr>}
            {hist.scs.map((s) => (
              <tr key={s.facility_id}>
                <td style={{ ...td, textAlign: "left" }}><b style={{ color: NAVY }}>{s.nombre || s.facility_id}</b></td>
                {hist.fechas.map((f) => {
                  const d = s.dias[f];
                  if (!d) return <td key={f} style={{ ...td, color: "#d0d5dd" }}>—</td>;
                  const marca = { cumple: ["✓", VERDE], no_cumple: [`✗ ${n(d.sin_aceptar_al_corte)}`, ROJO], sin_dato: ["·", GRIS], en_plazo: ["⏳", AZUL] }[d.estado];
                  return <td key={f} style={{ ...td, color: marca[1], fontWeight: 700, cursor: "pointer" }} title={`${d.nombre || d.facility_id} · ${diaTexto(f)} · ${ESTADOS[d.estado].rotulo}`}
                    onClick={() => setFecha(f)}>{marca[0]}</td>;
                })}
                <td style={{ ...td, fontWeight: 700, color: s.medidos ? (s.cumplidos === s.medidos ? VERDE : ROJO) : GRIS }}>
                  {s.medidos ? `${s.cumplidos}/${s.medidos}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Avisos enviados */}
      <div style={{ fontSize: 15, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Avisos enviados por correo · rutas del {diaTexto(fecha)}</div>
      <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr><th style={{ ...th, textAlign: "left" }}>SC</th><th style={th}>Rutas pendientes</th><th style={th}>Enviado</th><th style={{ ...th, textAlign: "left" }}>Destinatarios</th></tr>
          </thead>
          <tbody>
            {!avisos.length && <tr><td style={{ ...td, color: GRIS }} colSpan={4}>No se han enviado avisos para este día.</td></tr>}
            {avisos.map((a) => {
              const sc = filas.find((f) => f.facility_id === a.facility_id);
              return (
                <tr key={a.id}>
                  <td style={{ ...td, textAlign: "left" }}><b style={{ color: NAVY }}>{sc?.nombre || a.facility_id}</b> <span style={{ color: GRIS, fontSize: 11.5 }}>({a.facility_id})</span></td>
                  <td style={td}>{n(a.pendientes)}</td>
                  <td style={td}>{fechaHora(a.enviado_at)}</td>
                  <td style={{ ...td, textAlign: "left", whiteSpace: "normal", fontSize: 12, color: "#475467" }}>{a.destinatarios || "—"}{a.error ? <span style={{ color: ROJO }}> · {a.error}</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
