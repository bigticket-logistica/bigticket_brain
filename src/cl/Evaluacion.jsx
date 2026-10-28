// ═══════════════════════════════════════════════════════════════════════════
// POSTVENTA CHILE · BIGGY VS EJECUTIVA
//
// Para la jefa del área: compara lo que decide el Biggy con lo que decide la
// ejecutiva, y le permite marcar quién tenía razón y dejar un comentario.
//   · Clasificación de formularios (canon_casos_cl: biggy vs ejecutiva)
//   · Revisión de respuestas de supervisores (Bitácora y sombra sobre Pipefy)
// Las evaluaciones van a postventa_evaluacion_cl. canon-cl.cjs lee las
// correcciones de clasificación con comentario y se las pasa al Biggy como
// ejemplos, así que cada comentario ajusta su criterio.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback } from "react";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";

const C = {
  navy: "#1a3a6b", navyTenue: "#eef2f8", naranja: "#F47B20",
  verde: "#1f7a5c", verdeTenue: "#e7f4ee", ambar: "#a35d0f", ambarTenue: "#fdf3e3",
  rojo: "#b42318", rojoTenue: "#fdecea", gris: "#6b7280", grisTenue: "#f1f3f6",
  fondo: "#f4f5f7", borde: "#e3e6eb", texto: "#1f2937", suave: "#4b5563", tenue: "#9aa3af",
};
const FUENTE = "'Geist', system-ui, -apple-system, sans-serif";
const TZ = "America/Santiago";

async function api(path, op) {
  const o = op || {};
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    method: o.method || "GET",
    headers: Object.assign({ apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" }, o.headers || {}),
    body: o.body,
  });
  if (!r.ok) throw new Error(`La consulta falló (HTTP ${r.status}). ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t && t.trim() ? JSON.parse(t) : true;
}
const fecha = (iso) => (iso ? new Intl.DateTimeFormat("es-CL", { timeZone: TZ, day: "2-digit", month: "short" }).format(new Date(iso)) : "—");

const CLAS = {
  supervisor: "Entrega (supervisor)", consulta: "Consulta de estado", mandante: "Producto (Canon)",
  comentario: "Comentario", revision_manual: "Revisión manual",
};
const ORDEN_CLAS = ["supervisor", "consulta", "mandante", "comentario", "revision_manual"];
const VEREDICTOS_CLAS = [["biggy", "Tenía razón el Biggy", C.verde], ["ejecutiva", "Tenía razón la ejecutiva", C.navy], ["ambos", "Ambas sirven", C.gris], ["ninguno", "Ninguno", C.rojo]];
const VEREDICTOS_REV = [["justa", "Revisión justa", C.verde], ["exagerada", "Demasiado exigente", C.ambar], ["blanda", "Debió ser más exigente", C.rojo]];
const CALIF = { correcta: ["Correcta", C.verde], incompleta: ["Incompleta", C.ambar], fuera_de_lugar: ["Fuera de lugar", C.rojo] };

const control = { fontSize: 13, padding: "8px 11px", borderRadius: 9, border: `1px solid ${C.borde}`, background: "#fff", fontFamily: FUENTE, color: C.texto };

function Tarjeta({ titulo, valor, nota, color }) {
  return (
    <div style={{ flex: 1, minWidth: 160, background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 14, padding: "12px 16px" }}>
      <div style={{ fontSize: 12.5, color: C.suave }}>{titulo}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: color || C.texto, lineHeight: 1.25 }}>{valor}</div>
      {nota && <div style={{ fontSize: 11.5, color: C.tenue }}>{nota}</div>}
    </div>
  );
}

// Formulario de evaluación de un caso: veredicto + comentario.
function Evaluar({ opciones, previa, onGuardar }) {
  const [ver, setVer] = useState(previa ? previa.veredicto : "");
  const [com, setCom] = useState(previa ? previa.comentario || "" : "");
  const [estado, setEstado] = useState("");
  const guardar = async () => {
    if (!ver) { setEstado("Elige un veredicto."); return; }
    setEstado("Guardando…");
    try { await onGuardar(ver, com.trim()); setEstado("Guardado ✓"); } catch (e) { setEstado(e.message); }
  };
  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.borde}`, paddingTop: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {opciones.map(([k, et, col]) => (
          <button key={k} onClick={() => setVer(k)}
            style={{ ...control, cursor: "pointer", fontWeight: 600, borderColor: ver === k ? col : C.borde,
              background: ver === k ? col : "#fff", color: ver === k ? "#fff" : C.texto }}>{et}</button>
        ))}
      </div>
      <textarea value={com} onChange={(e) => setCom(e.target.value)} rows={2}
        placeholder="Comentario para ajustar al Biggy (por qué, qué regla debería seguir)…"
        style={{ ...control, width: "100%", boxSizing: "border-box", marginTop: 8, resize: "vertical" }} />
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 6 }}>
        {estado && <span style={{ fontSize: 12, color: estado.endsWith("✓") ? C.verde : C.suave }}>{estado}</span>}
        <button onClick={guardar} style={{ ...control, cursor: "pointer", background: C.navy, color: "#fff", borderColor: C.navy, fontWeight: 700 }}>
          {previa ? "Actualizar evaluación" : "Guardar evaluación"}
        </button>
      </div>
    </div>
  );
}

export default function EvaluacionBiggy({ usuario }) {
  const [casos, setCasos] = useState([]);
  const [tareas, setTareas] = useState([]);
  const [evals, setEvals] = useState({});
  const [error, setError] = useState("");
  const [tema, setTema] = useState("clasificacion");
  const [filtro, setFiltro] = useState("pendientes");

  const cargar = useCallback(async () => {
    try {
      const [c, t, e] = await Promise.all([
        api("canon_casos_cl?select=card_id,canal,creado_en,pedido,motivo,texto,titulo,respuesta,biggy_clasificacion,biggy_razon,ejecutiva_clasificacion,revision_calificacion,revision_falta,revision_razon,revision_de&order=creado_en.desc&limit=2000"),
        api("postventa_tareas_cl?revision_calificacion=not.is.null&select=id,card_id,ceco,titulo,que_pide,respuesta,revision_calificacion,revision_falta,revision_razon,revisada_en&order=revisada_en.desc&limit=500"),
        api("postventa_evaluacion_cl?select=*&order=creado_en"),
      ]);
      setCasos(c || []); setTareas(t || []);
      const m = {}; for (const x of e || []) m[`${x.tema}:${x.card_id}`] = x;   // la última evaluación manda
      setEvals(m); setError("");
    } catch (er) { setError(er.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = (temaG, cardId) => async (veredicto, comentario) => {
    await api("postventa_evaluacion_cl", { method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ card_id: cardId, tema: temaG, veredicto, comentario: comentario || null,
        autor: (usuario && (usuario.nombre || usuario.email)) || "Brain" }) });
    await cargar();
  };

  // ── Clasificación ──
  const comparables = useMemo(() => casos.filter((c) => c.canal === "formulario" && c.biggy_clasificacion && c.biggy_clasificacion !== "error" && c.ejecutiva_clasificacion), [casos]);
  const sinManual = comparables.filter((c) => c.biggy_clasificacion !== "revision_manual");
  const iguales = sinManual.filter((c) => c.biggy_clasificacion === c.ejecutiva_clasificacion).length;
  const diferencias = comparables.filter((c) => c.biggy_clasificacion !== c.ejecutiva_clasificacion);
  const evalClas = diferencias.map((c) => evals[`clasificacion:${c.card_id}`]).filter(Boolean);
  const matriz = useMemo(() => {
    const m = {};
    for (const c of comparables) { const k = `${c.ejecutiva_clasificacion}|${c.biggy_clasificacion}`; m[k] = (m[k] || 0) + 1; }
    return m;
  }, [comparables]);

  // ── Revisión de respuestas: tareas reales + sombra sobre respuestas de Pipefy ──
  const revisiones = useMemo(() => [
    ...tareas.map((t) => ({ clave: `tarea${t.id}`, origen: "Bitácora", fecha: t.revisada_en, titulo: t.titulo, pide: t.que_pide, respuesta: t.respuesta,
      calif: t.revision_calificacion, falta: t.revision_falta, razon: t.revision_razon, ceco: t.ceco })),
    ...casos.filter((c) => c.revision_calificacion && c.revision_de === c.respuesta && c.revision_calificacion !== "correcta")
      .map((c) => ({ clave: c.card_id, origen: "Pipefy (sombra)", fecha: c.creado_en, titulo: c.titulo, pide: c.texto, respuesta: c.respuesta,
        calif: c.revision_calificacion, falta: c.revision_falta, razon: c.revision_razon })),
  ], [tareas, casos]);
  const evalRev = revisiones.map((r) => evals[`revision:${r.clave}`]).filter(Boolean);

  const listaClas = diferencias.filter((c) => filtro === "todos" || (filtro === "pendientes" ? !evals[`clasificacion:${c.card_id}`] : !!evals[`clasificacion:${c.card_id}`]));
  const listaRev = revisiones.filter((r) => filtro === "todos" || (filtro === "pendientes" ? !evals[`revision:${r.clave}`] : !!evals[`revision:${r.clave}`]));
  const cuenta = (lista, f) => lista.filter(f).length;

  return (
    <div style={{ fontFamily: FUENTE, color: C.texto }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>Biggy vs ejecutiva</div>
          <div style={{ fontSize: 13.5, color: C.suave }}>Compara las decisiones del Biggy con las de la ejecutiva. Cada evaluación con comentario ajusta su criterio.</div>
        </div>
        <div style={{ display: "flex", background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 4 }}>
          {[["clasificacion", "Clasificación"], ["revision", "Revisión de respuestas"]].map(([k, et]) => (
            <button key={k} onClick={() => setTema(k)} style={{ fontFamily: FUENTE, fontSize: 13.5, fontWeight: tema === k ? 700 : 500, border: "none", cursor: "pointer",
              borderRadius: 9, padding: "8px 14px", background: tema === k ? C.navy : "transparent", color: tema === k ? "#fff" : C.texto }}>{et}</button>
          ))}
        </div>
      </div>
      {error && <div style={{ background: C.rojoTenue, color: C.rojo, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {tema === "clasificacion" ? (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <Tarjeta titulo="Coinciden" valor={sinManual.length ? `${Math.round((iguales * 100) / sinManual.length)}%` : "—"} nota={`${iguales} de ${sinManual.length} formularios`} color={C.verde} />
            <Tarjeta titulo="Diferencias" valor={diferencias.length} nota="incluye las que el Biggy mandó a revisión manual" color={C.ambar} />
            <Tarjeta titulo="Evaluadas por ti" valor={`${evalClas.length}/${diferencias.length}`} nota="diferencias con veredicto" />
            <Tarjeta titulo="Quién tenía razón" valor={`${cuenta(evalClas, (e) => e.veredicto === "biggy")} · ${cuenta(evalClas, (e) => e.veredicto === "ejecutiva")}`} nota="Biggy · ejecutiva" color={C.navy} />
          </div>

          <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 14, padding: "12px 16px", marginBottom: 14, overflowX: "auto" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Cómo clasificó cada uno <span style={{ fontWeight: 400, color: C.suave }}>· filas: ejecutiva · columnas: Biggy</span></div>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 620 }}>
              <thead><tr><th />{ORDEN_CLAS.map((b) => <th key={b} style={{ padding: "4px 10px", color: C.suave, fontWeight: 600, textAlign: "center" }}>{CLAS[b]}</th>)}</tr></thead>
              <tbody>
                {ORDEN_CLAS.filter((e) => e !== "revision_manual").map((e) => (
                  <tr key={e}>
                    <td style={{ padding: "4px 10px", color: C.suave, fontWeight: 600 }}>{CLAS[e]}</td>
                    {ORDEN_CLAS.map((b) => {
                      const n = matriz[`${e}|${b}`] || 0;
                      return <td key={b} style={{ padding: "6px 10px", textAlign: "center", fontWeight: n ? 700 : 400,
                        background: !n ? "#fff" : e === b ? C.verdeTenue : C.ambarTenue, color: !n ? C.tenue : e === b ? C.verde : C.ambar,
                        border: `1px solid ${C.borde}` }}>{n || "·"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <Tarjeta titulo="Respuestas revisadas" valor={revisiones.length} nota="Bitácora + no correctas en Pipefy (sombra)" />
          <Tarjeta titulo="Evaluadas por ti" valor={`${evalRev.length}/${revisiones.length}`} />
          <Tarjeta titulo="Revisión justa" valor={cuenta(evalRev, (e) => e.veredicto === "justa")} color={C.verde} />
          <Tarjeta titulo="Demasiado exigente" valor={cuenta(evalRev, (e) => e.veredicto === "exagerada")} color={C.ambar} />
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[["pendientes", "Por evaluar"], ["evaluados", "Evaluados"], ["todos", "Todos"]].map(([k, et]) => (
          <button key={k} onClick={() => setFiltro(k)} style={{ ...control, cursor: "pointer", borderRadius: 999, fontWeight: 600,
            background: filtro === k ? C.navy : "#fff", color: filtro === k ? "#fff" : C.texto, borderColor: filtro === k ? C.navy : C.borde }}>{et}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 900 }}>
        {tema === "clasificacion" && listaClas.slice(0, 60).map((c) => (
          <div key={c.card_id} style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Pedido {c.pedido || "—"}</div>
              <div style={{ fontSize: 12, color: C.tenue }}>{fecha(c.creado_en)} · el cliente marcó "{c.motivo || "—"}"</div>
            </div>
            <div style={{ marginTop: 8, background: C.grisTenue, borderRadius: 10, padding: "10px 12px", fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{c.texto || "—"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              <div style={{ border: `1px solid ${C.borde}`, borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ fontSize: 11.5, color: C.suave, fontWeight: 600 }}>EJECUTIVA</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{CLAS[c.ejecutiva_clasificacion] || c.ejecutiva_clasificacion}</div>
              </div>
              <div style={{ border: `1px solid ${C.borde}`, borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ fontSize: 11.5, color: C.suave, fontWeight: 600 }}>BIGGY</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.naranja }}>{CLAS[c.biggy_clasificacion] || c.biggy_clasificacion}</div>
                {c.biggy_razon && <div style={{ fontSize: 12.5, color: C.suave, marginTop: 2 }}>{c.biggy_razon}</div>}
              </div>
            </div>
            <Evaluar opciones={VEREDICTOS_CLAS} previa={evals[`clasificacion:${c.card_id}`]} onGuardar={guardar("clasificacion", c.card_id)} />
          </div>
        ))}

        {tema === "revision" && listaRev.slice(0, 60).map((r) => {
          const [et, col] = CALIF[r.calif] || [r.calif, C.gris];
          return (
            <div key={r.clave} style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{r.titulo || "Caso de postventa"}</div>
                <div style={{ fontSize: 12, color: C.tenue }}>{r.origen}{r.ceco ? ` · ${r.ceco}` : ""} · {fecha(r.fecha)}</div>
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, color: C.suave, maxHeight: 90, overflow: "auto", whiteSpace: "pre-wrap" }}><b>Qué se pidió:</b> {String(r.pide || "—").slice(0, 600)}</div>
              <div style={{ marginTop: 8, background: C.grisTenue, borderRadius: 10, padding: "10px 12px", fontSize: 13.5, whiteSpace: "pre-wrap" }}><b>Respuesta del supervisor:</b> {r.respuesta || "—"}</div>
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <b>El Biggy la calificó:</b> <span style={{ color: col, fontWeight: 700 }}>{et}</span>
                {r.falta && <span> · falta: {r.falta}</span>}
                {r.razon && <div style={{ color: C.suave, fontSize: 12.5, marginTop: 2 }}>{r.razon}</div>}
              </div>
              <Evaluar opciones={VEREDICTOS_REV} previa={evals[`revision:${r.clave}`]} onGuardar={guardar("revision", r.clave)} />
            </div>
          );
        })}

        {((tema === "clasificacion" && !listaClas.length) || (tema === "revision" && !listaRev.length)) && (
          <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 14, padding: 24, textAlign: "center", color: C.suave }}>
            {filtro === "pendientes" ? "No quedan casos por evaluar. ¡Al día!" : "No hay casos en esta lista."}
          </div>
        )}
      </div>
    </div>
  );
}
