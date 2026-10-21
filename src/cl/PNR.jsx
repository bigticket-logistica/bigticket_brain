// ═══════════════════════════════════════════════════════════════════════════
// PNR · CHILE
// Reclamos de "paquete no recibido" de MELI Chile. Los captura pnr-cl.cjs en
// el VPS de Chile cada 5 minutos y los deja en bigticket-cl:
//   pnr_casos_cl      una fila por caso (upsert por case_id)
//   pnr_historial_cl  cada cambio de estado (trigger trg_pnr_historial_cl)
//   pnr_avisos_cl     avisos por caso y canal: "correo" (casilla postventa)
//                     y "brain" (la analista lo vio en esta pestaña)
//
// Mismo modelo de lectura que Posventa MX en The Eyes: las tarjetas responden
// a una sola pregunta —quién tiene que mover— y los nombres de estado son los
// de la planilla de la analista, sin reinterpretar.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, Fragment } from "react";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";

const NAVY = "#1a3a6b";
const NAVY_T = "#eef2f8";
const ORANGE = "#F47B20";
const ORANGE_T = "#fdf1e6";
const PENAL = "#b8651c";
const PENAL_T = "#fdf3e8";
const LADRILLO = "#9e3b1b";
const LADRILLO_T = "#faece6";
const VERDE = "#1f7a5c";
const VERDE_T = "#e9f3ef";
const GRIS = "#8a94a6";

const SLA_H = 48;               // plazo que se puso la torre (MELI da 72 h)
const REFRESCO_MS = 60 * 1000;  // el VPS captura cada 5 min; acá se relee cada 1

async function api(path, opciones) {
  const o = opciones || {};
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    method: o.method || "GET",
    headers: Object.assign({
      apikey: CL_KEY,
      Authorization: `Bearer ${CL_KEY}`,
      "Content-Type": "application/json",
    }, o.headers || {}),
    body: o.body,
  });
  if (!r.ok) throw new Error(`La consulta falló (HTTP ${r.status}). ${(await r.text()).slice(0, 250)}`);
  const texto = await r.text();
  if (!texto || !texto.trim()) return true;
  try { return JSON.parse(texto); } catch (e) { return true; }
}

// Los ocho estados de MELI con el nombre de la planilla de la analista.
const ESTADOS_PNR = [
  { clave: "WAITING_RECEIPT",  etiqueta: "Esperando comprobante",   corto: "Esperando compr.", motivo: "Pendiente de resolución", grupo: "responder" },
  { clave: "TO_BILL",          etiqueta: "Con Penalidad",           corto: "Con penalidad",    motivo: "Pendiente de resolución, con probabilidad de pasar a cobro 50%", grupo: "penalidad" },
  { clave: "UPLOADED_RECEIPT", etiqueta: "Comprobante Cargado",     corto: "Compr. cargado",   motivo: "Respuesta enviada a mandante", grupo: "meli" },
  { clave: "ASSIGNED",         etiqueta: "Pendiente de revisión",   corto: "Pend. revisión",   motivo: "Pendiente de revisión por Mercado Libre", grupo: "meli" },
  { clave: "ON_REVIEW",        etiqueta: "En Revisión",             corto: "En revisión",      motivo: "En revisión por Mercado Libre", grupo: "meli" },
  { clave: "WITHOUT_RECEIPT",  etiqueta: "Sin Comprobante Cargado", corto: "Sin comprobante",  motivo: "Sin respuesta, sin respaldo", grupo: "sinrespaldo" },
  { clave: "NOT_BILLED",       etiqueta: "Anulado",                 corto: "Anulado",          motivo: "Reclamo cerrado por cliente o por Mercado Libre", grupo: "cerrado" },
  { clave: "BILLED",           etiqueta: "Enviado a Facturación",   corto: "A facturación",    motivo: "Pasa a cobro", grupo: "cerrado" },
];
const POR_ESTADO = Object.fromEntries(ESTADOS_PNR.map((e) => [e.clave, e]));

const COLOR_ESTADO = {
  WAITING_RECEIPT: ORANGE, TO_BILL: PENAL, UPLOADED_RECEIPT: NAVY, ASSIGNED: NAVY,
  ON_REVIEW: NAVY, WITHOUT_RECEIPT: LADRILLO, NOT_BILLED: VERDE, BILLED: LADRILLO,
};

const GRUPOS = [
  { clave: "responder",   etiqueta: "Por responder", nota: "falta el comprobante", color: ORANGE,   tinte: ORANGE_T,   reloj: true },
  { clave: "penalidad",   etiqueta: "Con penalidad", nota: "pedir revisión",       color: PENAL,    tinte: PENAL_T,    reloj: true },
  { clave: "meli",        etiqueta: "Con respaldo",  nota: "Mercado Libre revisa", color: NAVY,     tinte: NAVY_T },
  { clave: "sinrespaldo", etiqueta: "Sin respaldo",  nota: "respondido sin foto",  color: LADRILLO, tinte: LADRILLO_T },
  { clave: "cerrado",     etiqueta: "Cerrados",      nota: "anulados y cobrados",  color: VERDE,    tinte: VERDE_T },
];
const POR_GRUPO = Object.fromEntries(GRUPOS.map((g) => [g.clave, g]));

// Un sub_estado que MELI invente mañana cae en "responder": aparece arriba
// pidiendo que alguien lo mire, en vez de esconderse.
const clasificar = (c) => (POR_ESTADO[c.sub_estado] ? POR_ESTADO[c.sub_estado].grupo : "responder");
const esAbierto = (c) => !!POR_GRUPO[clasificar(c)].reloj;

const dinero = (v) => "$" + Math.round(Number(v) || 0).toLocaleString("es-CL");
const fechaCL = (ts, conHora = true) => {
  if (!ts) return "—";
  try {
    return new Intl.DateTimeFormat("es-CL", Object.assign({ timeZone: "America/Santiago",
      day: "2-digit", month: "short" }, conHora ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}))
      .format(new Date(ts));
  } catch (e) { return "—"; }
};
const horasMin = (h) => `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;

function Chip({ sub }) {
  const e = POR_ESTADO[sub];
  const color = COLOR_ESTADO[sub] || GRIS;
  return (
    <span title={e ? `${e.etiqueta} · ${e.motivo}` : sub}
      style={{ display: "inline-block", fontSize: 11, fontWeight: 700, color,
        background: color + "14", border: `1px solid ${color}40`, borderRadius: 20,
        padding: "2px 9px", whiteSpace: "nowrap" }}>
      {e ? e.corto : (sub || "—")}
    </span>
  );
}

// Reloj de 48 h. Solo corre en los casos donde nos toca mover a nosotros.
function Reloj({ c, ahora }) {
  if (!esAbierto(c) || !c.fecha_caso) return <span style={{ color: "#cbd5e1" }}>—</span>;
  const transcurrido = (ahora - new Date(c.fecha_caso).getTime()) / 3600000;
  const resta = SLA_H - transcurrido;
  if (resta <= 0) {
    return <span style={{ fontSize: 11.5, fontWeight: 800, color: LADRILLO }}>Vencido +{horasMin(-resta)}</span>;
  }
  const color = resta <= 4 ? LADRILLO : resta <= 12 ? ORANGE : "#475569";
  return (
    <span title={`Quedan ${horasMin(resta)} del plazo de ${SLA_H} h`}
      style={{ fontSize: 12, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>
      {horasMin(resta)}
    </span>
  );
}

function Tarjeta({ grupo, casos, monto, activa, onClick }) {
  return (
    <button onClick={onClick} title={`Ver solo ${grupo.etiqueta.toLowerCase()}`}
      style={{ flex: 1, minWidth: 150, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
        background: activa ? grupo.tinte : "#fff",
        border: `1px solid ${activa ? grupo.color : "#e4e7ec"}`, borderTop: `3px solid ${grupo.color}`,
        borderRadius: 12, padding: "11px 14px", boxShadow: activa ? `inset 0 0 0 1px ${grupo.color}` : "none" }}>
      <div style={{ fontSize: 10.5, color: activa ? grupo.color : "#64748b", letterSpacing: .3,
        textTransform: "uppercase", fontWeight: 700 }}>{grupo.etiqueta}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#1f2937", lineHeight: 1.3 }}>{dinero(monto)}</div>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>{casos} {casos === 1 ? "caso" : "casos"} · {grupo.nota}</div>
    </button>
  );
}

function Dato({ etiqueta, valor }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: GRIS, textTransform: "uppercase", letterSpacing: .4, fontWeight: 700 }}>{etiqueta}</div>
      <div style={{ fontSize: 12.5, color: "#1f2937", marginTop: 2, wordBreak: "break-word" }}>{valor || "—"}</div>
    </div>
  );
}

function Detalle({ c, historial, aviso }) {
  const e = POR_ESTADO[c.sub_estado];
  return (
    <div style={{ padding: "14px 18px", background: "#fbfcfe", borderTop: "1px solid #eef1f5" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 14 }}>
        <Dato etiqueta="Estado" valor={e ? `${e.etiqueta} · ${e.motivo}` : c.sub_estado} />
        <Dato etiqueta="ID de envío" valor={c.shipment_id} />
        <Dato etiqueta="Estación" valor={c.service_center} />
        <Dato etiqueta="Ruta" valor={[c.route_code, c.route_id].filter(Boolean).join(" · ")} />
        <Dato etiqueta="Conductor" valor={c.conductor} />
        <Dato etiqueta="Monto" valor={dinero(c.monto)} />
        <Dato etiqueta="Periodo" valor={c.periodo} />
        <Dato etiqueta="Creado en MELI" valor={fechaCL(c.fecha_caso)} />
        <Dato etiqueta="Detectado por la torre" valor={fechaCL(c.creado_en)} />
        <Dato etiqueta="Correo a postventa" valor={aviso && aviso.correo ? fechaCL(aviso.correo.enviado_en) : "pendiente"} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <a className="pc-btn" href={`https://envios.adminml.com/logistics/case-center/cases/${c.case_id}`}
           target="_blank" rel="noreferrer">Abrir caso en MELI</a>
        {c.route_id && (
          <a className="pc-btn" href={`https://envios.adminml.com/logistics/monitoring-distribution/detail/${c.route_id}?site=MLC`}
             target="_blank" rel="noreferrer">Ver detalle de la ruta</a>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 10, color: GRIS, textTransform: "uppercase", letterSpacing: .4, fontWeight: 700, marginBottom: 6 }}>
          Historial de estados
        </div>
        {!historial ? (
          <div style={{ fontSize: 12, color: GRIS }}>Cargando…</div>
        ) : !historial.length ? (
          <div style={{ fontSize: 12, color: GRIS }}>Sin cambios registrados.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {historial.map((h) => (
              <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ color: GRIS, minWidth: 92, fontVariantNumeric: "tabular-nums" }}>{fechaCL(h.cambiado_en)}</span>
                {h.sub_estado_desde ? <><Chip sub={h.sub_estado_desde} /><span style={{ color: GRIS }}>→</span></> : <span style={{ color: GRIS }}>Nace como</span>}
                <Chip sub={h.sub_estado_hacia} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ModuloPnrCL({ usuario }) {
  const [casos, setCasos] = useState([]);
  const [avisos, setAvisos] = useState({});        // case_id → { brain, correo }
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [ultima, setUltima] = useState(null);
  const [periodo, setPeriodo] = useState("");
  const [grupo, setGrupo] = useState("todos");
  const [sc, setSc] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [abierta, setAbierta] = useState(null);
  const [historiales, setHistoriales] = useState({});
  const [ahora, setAhora] = useState(Date.now());

  const cargar = useCallback(async () => {
    try {
      const [filas, avs] = await Promise.all([
        api("pnr_casos_cl?select=case_id,tipo,fecha_caso,route_code,route_id,service_center,conductor,shipment_id,monto,moneda,estado,sub_estado,periodo,actualizado_en,creado_en&order=fecha_caso.desc&limit=5000"),
        api("pnr_avisos_cl?select=case_id,canal,destino,enviado_en,leido_en,error&limit=10000"),
      ]);
      const mapa = {};
      for (const a of avs || []) {
        mapa[a.case_id] = mapa[a.case_id] || {};
        mapa[a.case_id][a.canal] = a;
      }
      setCasos(filas || []);
      setAvisos(mapa);
      setUltima(new Date());
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(t); }, []);

  const periodos = useMemo(() => [...new Set(casos.map((c) => c.periodo).filter(Boolean))].sort().reverse(), [casos]);
  useEffect(() => { if (!periodo && periodos.length) setPeriodo(periodos[0]); }, [periodos, periodo]);

  const delPeriodo = useMemo(() => casos.filter((c) => !periodo || c.periodo === periodo), [casos, periodo]);
  const scs = useMemo(() => [...new Set(delPeriodo.map((c) => c.service_center).filter(Boolean))].sort(), [delPeriodo]);

  const sinVer = (c) => esAbierto(c) && !(avisos[c.case_id] && avisos[c.case_id].brain && avisos[c.case_id].brain.leido_en);

  const totales = useMemo(() => {
    const t = Object.fromEntries(GRUPOS.map((g) => [g.clave, { casos: 0, monto: 0 }]));
    for (const c of delPeriodo) {
      if (sc !== "todos" && c.service_center !== sc) continue;
      const k = clasificar(c);
      t[k].casos++; t[k].monto += Number(c.monto) || 0;
    }
    return t;
  }, [delPeriodo, sc]);

  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return delPeriodo
      .filter((c) => grupo === "todos" || clasificar(c) === grupo)
      .filter((c) => sc === "todos" || c.service_center === sc)
      .filter((c) => !q || [c.case_id, c.shipment_id, c.conductor, c.route_code, c.route_id, c.service_center]
        .some((v) => v && String(v).toLowerCase().includes(q)))
      .sort((a, b) => {
        // Primero lo que corre reloj, del más urgente al menos; después el resto, más nuevo arriba.
        const ra = esAbierto(a), rb = esAbierto(b);
        if (ra !== rb) return ra ? -1 : 1;
        const fa = new Date(a.fecha_caso || 0).getTime(), fb = new Date(b.fecha_caso || 0).getTime();
        return ra ? fa - fb : fb - fa;
      });
  }, [delPeriodo, grupo, sc, busqueda]);

  const nSinVer = delPeriodo.filter(sinVer).length;

  const marcarVisto = async (ids) => {
    if (!ids.length) return;
    const ts = new Date().toISOString();
    const quien = (usuario && (usuario.email || usuario.nombre)) || "brain";
    setAvisos((prev) => {
      const n = { ...prev };
      for (const id of ids) n[id] = { ...(n[id] || {}), brain: { ...((n[id] || {}).brain || {}), canal: "brain", leido_en: ts, destino: quien } };
      return n;
    });
    try {
      for (let i = 0; i < ids.length; i += 200) {
        await api("pnr_avisos_cl?on_conflict=case_id,canal", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(ids.slice(i, i + 200).map((id) => ({ case_id: id, canal: "brain", leido_en: ts, destino: quien }))),
        });
      }
    } catch (e) {
      setError("No se pudo marcar como visto: " + e.message);
    }
  };

  const abrir = async (c) => {
    const id = c.case_id;
    setAbierta(abierta === id ? null : id);
    if (abierta === id) return;
    if (sinVer(c)) marcarVisto([id]);
    if (!historiales[id]) {
      try {
        const h = await api(`pnr_historial_cl?case_id=eq.${id}&select=id,estado_desde,sub_estado_desde,estado_hacia,sub_estado_hacia,cambiado_en&order=cambiado_en.asc`);
        setHistoriales((p) => ({ ...p, [id]: h || [] }));
      } catch (e) {
        setHistoriales((p) => ({ ...p, [id]: [] }));
      }
    }
  };

  return (
    <div style={{ padding: 0, fontFamily: "'Geist', system-ui, -apple-system, sans-serif" }}>
      <style>{`
        .pc-tabla{width:100%;border-collapse:collapse;font-size:12px;background:#fff;}
        .pc-tabla thead th{position:sticky;top:0;z-index:2;background:${NAVY};color:#fff;font-size:10.5px;
          letter-spacing:.4px;text-transform:uppercase;padding:8px 10px;text-align:left;white-space:nowrap;font-weight:700;}
        .pc-tabla tbody td{padding:8px 10px;border-bottom:1px solid #eef1f5;white-space:nowrap;}
        .pc-tabla tbody tr.pc-fila{cursor:pointer;}
        .pc-tabla tbody tr.pc-fila:hover{background:#f7faff;}
        .pc-tabla .num{text-align:right;font-variant-numeric:tabular-nums;}
        .pc-scroll{max-height:calc(100vh - 360px);overflow:auto;border:1px solid #e6e9ef;border-radius:10px;background:#fff;}
        .pc-input{border:1px solid #dfe4ec;border-radius:8px;padding:6px 10px;font-size:12.5px;font-family:inherit;color:#1f2937;background:#fff;}
        .pc-input:focus{outline:2px solid ${NAVY}22;border-color:${NAVY};}
        .pc-btn{display:inline-block;border:1px solid ${NAVY};background:#fff;color:${NAVY};border-radius:8px;padding:6px 12px;
          font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none;}
        .pc-btn:hover{background:${NAVY};color:#fff;}
        .pc-chip{border:1px solid #dfe4ec;background:#fff;border-radius:20px;padding:4px 11px;font-size:12px;
          cursor:pointer;font-family:inherit;color:#64748b;font-weight:600;}
        .pc-chip.on{background:${NAVY};border-color:${NAVY};color:#fff;}
      `}</style>

      {/* Cabecera */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, letterSpacing: -.3 }}>PNR · Chile</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              Reclamos de paquete no recibido · captura automática cada 5 min · plazo {SLA_H} h
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11.5, color: GRIS, fontWeight: 700 }}>PERIODO</span>
            <select className="pc-input" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
              {periodos.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button className="pc-btn" onClick={cargar}>Actualizar</button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: GRIS, marginTop: 6 }}>
          {ultima ? `Leído a las ${fechaCL(ultima)}` : ""}
        </div>
      </div>

      <div style={{ padding: "16px 24px", background: "#f4f6f9", minHeight: "100%" }}>
        {error && (
          <div style={{ background: LADRILLO_T, border: `1px solid ${LADRILLO}55`, color: LADRILLO, borderRadius: 10,
            padding: "10px 14px", fontSize: 12.5, marginBottom: 12 }}>{error}</div>
        )}

        {cargando ? (
          <div style={{ padding: 40, textAlign: "center", color: GRIS, fontSize: 13 }}>Cargando PNR…</div>
        ) : !casos.length ? (
          <div style={{ padding: 40, textAlign: "center", color: GRIS, fontSize: 13 }}>
            Todavía no hay casos. Revisa que el proceso pnr-cl esté corriendo en el VPS de Chile.
          </div>
        ) : (
          <>
            {/* Tarjetas */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              {GRUPOS.map((g) => (
                <Tarjeta key={g.clave} grupo={g} casos={totales[g.clave].casos} monto={totales[g.clave].monto}
                  activa={grupo === g.clave} onClick={() => setGrupo(grupo === g.clave ? "todos" : g.clave)} />
              ))}
            </div>

            {/* Filtros */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <input className="pc-input" style={{ minWidth: 280 }} value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar caso, envío, conductor o ruta…" />
              <select className="pc-input" value={sc} onChange={(e) => setSc(e.target.value)}>
                <option value="todos">Todas las estaciones</option>
                {scs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {grupo !== "todos" && (
                <button className="pc-chip on" onClick={() => setGrupo("todos")}>{POR_GRUPO[grupo].etiqueta} ✕</button>
              )}
              <span style={{ fontSize: 12, color: GRIS }}>{lista.length} casos</span>
              {nSinVer > 0 && (
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: ORANGE, fontWeight: 700 }}>● {nSinVer} abiertos sin revisar</span>
                  <button className="pc-btn" onClick={() => marcarVisto(delPeriodo.filter(sinVer).map((c) => c.case_id))}>
                    Marcar todos como vistos
                  </button>
                </span>
              )}
            </div>

            {/* Lista */}
            <div className="pc-scroll">
              <table className="pc-tabla">
                <thead>
                  <tr>
                    <th style={{ width: 14 }}></th>
                    <th>Estado</th>
                    <th>Caso</th>
                    <th>Creado</th>
                    <th>Estación</th>
                    <th>Ruta</th>
                    <th>Conductor</th>
                    <th className="num">Monto</th>
                    <th className="num">Plazo</th>
                    <th>Correo</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((c) => {
                    const av = avisos[c.case_id] || {};
                    const nuevo = sinVer(c);
                    return (
                      <Fragment key={c.case_id}>
                        <tr className="pc-fila" onClick={() => abrir(c)}
                          style={{ background: abierta === c.case_id ? "#f2f6fc" : undefined }}>
                          <td title={nuevo ? "Abierto y todavía sin revisar" : ""}>
                            {nuevo && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: ORANGE }} />}
                          </td>
                          <td><Chip sub={c.sub_estado} /></td>
                          <td style={{ fontWeight: nuevo ? 800 : 600, color: NAVY }}>{c.case_id}</td>
                          <td style={{ color: "#475569" }}>{fechaCL(c.fecha_caso)}</td>
                          <td>{c.service_center || "—"}</td>
                          <td style={{ color: "#475569" }}>{c.route_code || c.route_id || "—"}</td>
                          <td>{c.conductor || "—"}</td>
                          <td className="num" style={{ fontWeight: 700 }}>{dinero(c.monto)}</td>
                          <td className="num"><Reloj c={c} ahora={ahora} /></td>
                          <td>
                            {av.correo && !av.correo.error
                              ? <span title={`Enviado ${fechaCL(av.correo.enviado_en)}`} style={{ color: VERDE, fontWeight: 700 }}>✓ Enviado</span>
                              : av.correo && av.correo.error
                                ? <span title={av.correo.error} style={{ color: LADRILLO, fontWeight: 700 }}>Falló</span>
                                : <span style={{ color: "#cbd5e1" }}>—</span>}
                          </td>
                        </tr>
                        {abierta === c.case_id && (
                          <tr>
                            <td colSpan={10} style={{ padding: 0, whiteSpace: "normal" }}>
                              <Detalle c={c} historial={historiales[c.case_id]} aviso={av} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!lista.length && (
                    <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: GRIS }}>Sin casos para este filtro.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
