import { useEffect, useMemo, useState } from "react";
import { fechaHoyOperativa, sb } from "./shared";

// ═══════════════════════════════════════════════════════════════════
//  MALLA DE TURNOS MX
//  Grupo fijo (sale 6 días, descanso rotativo) + reserva para los picos, por SC.
//  Se calcula sola cada vez que se abre, con los datos que el Brain ya guarda:
//   · Demanda: pedidos de MELI de las últimas 12 semanas (mx_pedidos_estado)
//   · Flota: vehículos que trabajaron las últimas 2 semanas (vs_rutas_ejecutadas)
//   · Empresa, tipo y estado: inventario de flota de Terceros (inventario_flota)
//   · Supervisor: supervisores_bt
// ═══════════════════════════════════════════════════════════════════

const NAVY = "#1a3a6b", MUTED = "#5b6474", BORDER = "#e4e7ec";
const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const ANCLA = "2026-11-02"; // lunes desde el que se cuenta la rotación de descansos
// SC que comparten vehículos: se planifican como un solo grupo
const GRUPOS_JUNTOS = [["SMX10", "SMX20", "SMX22", "SMXRV1"], ["SMX2", "SMX9"]];
const EXCLUIR = ["SIL1", "SLT1", "SBB1", "SRM1", "SRM2", "SRM3", "SRM4", "SAR1", "SLS1", "SVP3", "ERM2", "ERM4", "ERM5", "EXB1", "EXB2"];
const SEMANAS_DEMANDA = 12, DIAS_FLOTA = 14, MIN_RUTAS_SEMANA = 7;

const sumarDias = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lunesDe = iso => { const d = new Date(iso + "T12:00:00Z"); const w = (d.getUTCDay() + 6) % 7; return sumarDias(iso, -w); };
const diaSemana = iso => (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7;
const fechaCorta = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const normPlaca = p => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^SDD/, "");
const grupoDe = sc => { const g = GRUPOS_JUNTOS.find(x => x.includes(sc)); return g ? g.join(" · ") : sc; };
const percentil = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };

async function traerTodo(tabla, cols, filtro) {
  const out = [];
  for (let pag = 0; ; pag += 1000) {
    let q = sb.from(tabla).select(cols).range(pag, pag + 999);
    q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabla}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Arma la malla de un grupo para la semana que empieza en "lunes"
function armarMalla(g, lunes) {
  const { base, pico } = g;
  const N = Math.max(Math.ceil(base.reduce((a, b) => a + b, 0) / 6), Math.max(...base), 0);
  // Descansos: uno por vehículo fijo, en los días con más holgura (menos demanda)
  const descansos = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    let mejor = 0;
    for (let d = 1; d < 7; d++) if ((N - base[d]) - descansos[d] > (N - base[mejor]) - descansos[mejor]) mejor = d;
    descansos[mejor]++;
  }
  const slots = DIAS.flatMap((_, d) => Array(descansos[d]).fill(d));
  const semana = Math.round((new Date(lunes + "T12:00:00Z") - new Date(ANCLA + "T12:00:00Z")) / (7 * 864e5));
  const vehiculos = g.vehiculos;
  const fijos = vehiculos.slice(0, N);
  const reserva = vehiculos.slice(N);
  const filas = [
    ...fijos.map(v => ({ ...v, rol: "Fijo" })),
    ...Array(Math.max(0, N - fijos.length)).fill(0).map((_, i) => ({ placa: "VACANTE", empresa: "Falta un vehículo para el grupo fijo", rol: "Fijo", vacante: true, k: `vf${i}` })),
    ...reserva.map(v => ({ ...v, rol: "Reserva" })),
  ];
  // Días del grupo fijo: T o D según la rotación
  let fi = 0;
  for (const f of filas) {
    f.dias7 = Array(7).fill("—");
    if (f.rol === "Fijo") {
      const d = N ? slots[(((fi + semana) % N) + N) % N] : -1;
      f.dias7 = f.dias7.map((_, i) => (i === d ? "D" : "T"));
      fi++;
    }
  }
  const trabajan = DIAS.map((_, d) => filas.filter(f => f.rol === "Fijo" && f.dias7[d] === "T").length);
  const necesidad = DIAS.map((_, d) => Math.max(0, pico[d] - trabajan[d]));
  // Reserva: se llama por turnos a los vehículos de reserva que hacen falta cada día
  const res = filas.filter(f => f.rol === "Reserva");
  let ptr = res.length ? ((semana * necesidad.reduce((a, b) => a + b, 0)) % res.length + res.length) % res.length : 0;
  const faltaReserva = [0, 0, 0, 0, 0, 0, 0];
  const usos = res.map(() => 0); // nadie de la reserva sale más de 6 días en la semana
  for (let d = 0; d < 7; d++) {
    let k = necesidad[d], vistos = 0;
    while (k > 0 && vistos < res.length) {
      const i = ptr % res.length; ptr++; vistos++;
      if (usos[i] < 6) { res[i].dias7[d] = "R"; usos[i]++; k--; }
    }
    faltaReserva[d] = k;
  }
  const llamados = DIAS.map((_, d) => res.filter(f => f.dias7[d] === "R").length);
  return { N, descansos, filas, trabajan, llamados, necesidad, faltaReserva, vacFijos: Math.max(0, N - fijos.length), reservaMax: Math.max(...necesidad, 0) };
}

export default function MallaTurnosMX() {
  const hoy = fechaHoyOperativa();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [grupoSel, setGrupoSel] = useState(null);
  const [semanaSel, setSemanaSel] = useState(0);
  const [verComo, setVerComo] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const desdeDem = sumarDias(lunesDe(hoy), -7 * SEMANAS_DEMANDA), hastaDem = sumarDias(hoy, -1);
        const desdeFlota = sumarDias(hoy, -DIAS_FLOTA), hastaFlota = sumarDias(hoy, -1);
        const [ped, rutas, inv, sup] = await Promise.all([
          traerTodo("mx_pedidos_estado", "facility_id, fecha_ruta, status, tipo", q => q.gte("fecha_ruta", desdeDem).lte("fecha_ruta", hastaDem).neq("status", "canceled").order("request_id")),
          traerTodo("vs_rutas_ejecutadas", "fecha, svc, placa_norm", q => q.gte("fecha", desdeFlota).lte("fecha", hastaFlota).order("fecha")),
          traerTodo("inventario_flota", "placa, empresa, tipo, status", q => q),
          sb.from("supervisores_bt").select("nombre, scs_asignados").eq("activo", true).then(r => r.data || []),
        ]);
        if (vivo) setDatos({ ped, rutas, inv, sup, desdeDem, hastaDem, desdeFlota, hastaFlota });
      } catch (e) { if (vivo) setError(e.message); }
    })();
    return () => { vivo = false; };
  }, [hoy]);

  const grupos = useMemo(() => {
    if (!datos) return [];
    const { ped, rutas, inv, sup, desdeDem, hastaDem } = datos;
    // Demanda por grupo y fecha
    const porFecha = {};
    for (const p of ped) {
      if (!p.facility_id || EXCLUIR.includes(p.facility_id) || p.status === "pending") continue;
      const g = grupoDe(p.facility_id), k = `${g}|${p.fecha_ruta}`;
      const x = (porFecha[k] = porFecha[k] || { reg: 0, urg: 0 });
      if (p.tipo === "urgent") x.urg++; else x.reg++;
    }
    const fechas = []; for (let f = desdeDem; f <= hastaDem; f = sumarDias(f, 1)) fechas.push(f);
    const nombresG = [...new Set(Object.keys(porFecha).map(k => k.split("|")[0]))];
    // Flota: días trabajados por placa y SC
    const diasPlaca = {};
    for (const r of rutas) {
      if (!r.placa_norm || EXCLUIR.includes(r.svc)) continue;
      const k = `${r.placa_norm}|${r.svc}`;
      (diasPlaca[k] = diasPlaca[k] || new Set()).add(r.fecha);
    }
    const porPlaca = {};
    for (const [k, set] of Object.entries(diasPlaca)) {
      const [p, sc] = k.split("|");
      const x = (porPlaca[p] = porPlaca[p] || { placa: p, total: 0, mejorSc: sc, mejorN: 0 });
      x.total += set.size;
      if (set.size > x.mejorN) { x.mejorN = set.size; x.mejorSc = sc; }
    }
    const invMap = {};
    for (const v of inv) invMap[normPlaca(v.placa)] = v;
    const supMap = {};
    for (const s of sup) for (const sc of (Array.isArray(s.scs_asignados) ? s.scs_asignados : [])) (supMap[sc] = supMap[sc] || []).push(s.nombre);

    return nombresG.map(nombre => {
      const scs = nombre.split(" · ");
      const base = [], pico = [];
      for (let d = 0; d < 7; d++) {
        const reg = [], urg = [];
        for (const f of fechas) if (diaSemana(f) === d) { const x = porFecha[`${nombre}|${f}`] || { reg: 0, urg: 0 }; reg.push(x.reg); urg.push(x.urg); }
        const prom = reg.reduce((a, b) => a + b, 0) / Math.max(1, reg.length);
        const promUrg = urg.reduce((a, b) => a + b, 0) / Math.max(1, urg.length);
        base.push(Math.floor(prom));
        pico.push(Math.ceil(percentil(reg, 0.8) + promUrg));
      }
      const vehiculos = Object.values(porPlaca).filter(v => grupoDe(v.mejorSc) === nombre)
        .map(v => { const i = invMap[v.placa] || {}; return { placa: v.placa, dias: v.total, empresa: i.empresa || "No está en el inventario", tipo: i.tipo || "—", estado: i.status ? i.status : (i.placa ? "ACTIVO" : "—"), k: v.placa }; })
        .sort((a, b) => b.dias - a.dias);
      const supervisores = [...new Set(scs.flatMap(sc => supMap[sc] || []))];
      return { nombre, scs, base, pico, vehiculos, supervisor: supervisores.join(" · ") || "—" };
    }).filter(g => g.base.reduce((a, b) => a + b, 0) >= MIN_RUTAS_SEMANA)
      .sort((a, b) => b.base.reduce((x, y) => x + y, 0) - a.base.reduce((x, y) => x + y, 0));
  }, [datos]);

  const lunesBase = lunesDe(hoy);
  const semanas = [0, 1, 2, 3].map(i => sumarDias(lunesBase, 7 * i));
  const lunes = semanas[semanaSel];
  const resumen = useMemo(() => grupos.map(g => ({ g, m: armarMalla(g, lunes) })), [grupos, lunes]);
  const sel = resumen.find(x => x.g.nombre === grupoSel) || resumen[0];

  const card = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "18px 22px" };
  const th = { padding: "7px 8px", fontSize: 11, color: MUTED, fontWeight: 600, textAlign: "center", borderBottom: `1px solid ${BORDER}` };
  const td = { padding: "6px 8px", fontSize: 12, textAlign: "center", borderBottom: "1px solid #f0f1f3" };
  const color = v => v === "T" ? { background: "#dbe7fb", color: NAVY, fontWeight: 700 } : v === "D" ? { background: "#eeeeee", color: MUTED } : v === "R" ? { background: "#fde5d4", color: "#9a3c06", fontWeight: 700 } : { color: "#c4c8cf" };

  if (error) return <div style={{ ...card, color: "#b42318" }}>No se pudo cargar la malla: {error}</div>;
  if (!datos) return <div style={{ ...card, color: MUTED }}>Calculando la malla con los datos de MELI…</div>;

  const tot = resumen.reduce((a, { m }) => ({ fijo: a.fijo + m.N, vacF: a.vacF + m.vacFijos, res: a.res + m.reservaMax, vacR: a.vacR + Math.max(...m.faltaReserva, 0) }), { fijo: 0, vacF: 0, res: 0, vacR: 0 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>Malla de turnos</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
              Grupo fijo que sale 6 días con descanso rotativo, y reserva para los días pico. Se recalcula sola cada vez que se abre: demanda de las últimas {SEMANAS_DEMANDA} semanas ({fechaCorta(datos.desdeDem)} al {fechaCorta(datos.hastaDem)}) y flota que trabajó del {fechaCorta(datos.desdeFlota)} al {fechaCorta(datos.hastaFlota)}.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {semanas.map((s, i) => (
              <button key={s} onClick={() => setSemanaSel(i)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${i === semanaSel ? NAVY : BORDER}`, background: i === semanaSel ? NAVY : "#fff", color: i === semanaSel ? "#fff" : NAVY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {i === 0 ? "Esta semana" : `Semana del ${fechaCorta(s)}`}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          {[["Grupo fijo necesario", tot.fijo, NAVY], ["Vacantes del grupo fijo", tot.vacF, tot.vacF ? "#b42318" : "#15803d"], ["Reserva necesaria (día más alto de cada SC)", tot.res, "#9a3c06"], ["Reserva que falta conseguir", tot.vacR, tot.vacR ? "#b42318" : "#15803d"]].map(([t, v, c]) => (
            <div key={t} style={{ flex: "1 1 180px", background: "#f6f7f9", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 12, color: MUTED }}>{t}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: c }}>{v}</div>
            </div>
          ))}
        </div>
        <button onClick={() => setVerComo(!verComo)} style={{ marginTop: 12, background: "none", border: "none", color: NAVY, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}>{verComo ? "▾" : "▸"} Cómo se calcula</button>
        {verComo && (
          <div style={{ fontSize: 13, color: "#2b3038", lineHeight: 1.6, marginTop: 6 }}>
            <b>1. Demanda:</b> para cada SC y día de la semana se toman las rutas regulares que ofreció MELI en las últimas {SEMANAS_DEMANDA} semanas. <b>Base</b> = el promedio, redondeado hacia abajo (lo que llega casi siempre). <b>Pico</b> = el nivel que se supera 1 de cada 5 días, más los urgentes.<br />
            <b>2. Grupo fijo:</b> rutas base de la semana ÷ 6 días de trabajo. Así, cada vehículo fijo tiene trabajo los 6 días que le toca salir.<br />
            <b>3. Descansos:</b> uno por vehículo, en los días de menos demanda. Cada semana, cada vehículo avanza un lugar en la lista, para que nadie tenga siempre el mismo día.<br />
            <b>4. Quién es fijo:</b> los vehículos que más días trabajaron en las últimas 2 semanas. El resto queda como reserva. Si no alcanzan, aparece una <b>vacante</b>.<br />
            <b>5. Reserva:</b> cada día se llama, por turnos, a los vehículos de reserva que faltan para llegar al pico.<br />
            <b>6. Regla de aceptación:</b> cada día se acepta hasta la capacidad (fijos que trabajan + reserva llamada), primero SDD, después Spot y al final urgentes.<br />
            Los SC que comparten vehículos se planifican juntos: {GRUPOS_JUNTOS.map(g => g.join(", ")).join(" · ")}.
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Resumen por SC · semana del {fechaCorta(lunes)}</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead><tr>
              {["SC", "Supervisor", "Vehículos que trabajaron", "Grupo fijo", "Vacantes fijo", "Reserva necesaria", "Reserva disponible", "Reserva que falta", "Rutas base / semana", "Rutas pico / semana", ""].map(h => <th key={h} style={{ ...th, textAlign: h === "SC" || h === "Supervisor" ? "left" : "center" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {resumen.map(({ g, m }) => {
                const resDisp = m.filas.filter(f => f.rol === "Reserva").length, faltaR = Math.max(...m.faltaReserva, 0);
                const activo = sel && sel.g.nombre === g.nombre;
                return (
                  <tr key={g.nombre} onClick={() => setGrupoSel(g.nombre)} style={{ cursor: "pointer", background: activo ? "#eef3fc" : "transparent" }}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{g.nombre}</td>
                    <td style={{ ...td, textAlign: "left", color: MUTED }}>{g.supervisor}</td>
                    <td style={td}>{g.vehiculos.length}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{m.N}</td>
                    <td style={{ ...td, color: m.vacFijos ? "#b42318" : "#15803d", fontWeight: 700 }}>{m.vacFijos || "—"}</td>
                    <td style={td}>{m.reservaMax}</td>
                    <td style={td}>{resDisp}</td>
                    <td style={{ ...td, color: faltaR ? "#9a3c06" : "#15803d", fontWeight: 700 }}>{faltaR || "—"}</td>
                    <td style={td}>{g.base.reduce((a, b) => a + b, 0)}</td>
                    <td style={td}>{g.pico.reduce((a, b) => a + b, 0)}</td>
                    <td style={{ ...td, color: NAVY, fontWeight: 600 }}>Ver malla ›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {sel && (() => {
        const { g, m } = sel;
        const fechasSem = DIAS.map((_, d) => sumarDias(lunes, d));
        return (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Malla de {g.nombre} · semana del {fechaCorta(lunes)}</div>
              <div style={{ fontSize: 12, color: MUTED }}>Supervisor: {g.supervisor} · T = trabaja · D = descansa · R = reserva llamada</div>
            </div>
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead><tr>
                  {["Placa", "Empresa", "Tipo", "Inventario", "Días trab. (2 sem)", "Rol"].map(h => <th key={h} style={{ ...th, textAlign: "left" }}>{h}</th>)}
                  {fechasSem.map((f, d) => <th key={f} style={th}>{DIAS[d]} {f.slice(8, 10)}</th>)}
                </tr></thead>
                <tbody>
                  {m.filas.map(f => (
                    <tr key={f.k}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 700, color: f.vacante ? "#b42318" : "#1f2937" }}>{f.placa}</td>
                      <td style={{ ...td, textAlign: "left", color: f.vacante ? "#b42318" : MUTED, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.empresa}</td>
                      <td style={{ ...td, textAlign: "left" }}>{f.tipo || ""}</td>
                      <td style={{ ...td, textAlign: "left", color: f.estado === "INACTIVO" ? "#9a3c06" : MUTED, fontWeight: f.estado === "INACTIVO" ? 700 : 400 }} title={f.estado === "INACTIVO" ? "Figura INACTIVO en el inventario de flota, pero trabajó según MELI. Revisar con Terceros." : ""}>{f.estado || ""}</td>
                      <td style={td}>{f.dias ?? ""}</td>
                      <td style={{ ...td, textAlign: "left", fontWeight: 600, color: f.rol === "Fijo" ? NAVY : "#9a3c06" }}>{f.rol}</td>
                      {f.dias7.map((v, d) => <td key={d} style={{ ...td, ...color(v) }}>{v}</td>)}
                    </tr>
                  ))}
                  {[
                    ["Fijos que trabajan", m.trabajan, {}],
                    ["Reserva llamada", m.llamados, {}],
                    ["Capacidad del día", DIAS.map((_, d) => m.trabajan[d] + m.llamados[d]), { fontWeight: 800 }],
                    ["Rutas base (pronóstico)", g.base, { color: MUTED }],
                    ["Rutas pico (pronóstico)", g.pico, { color: MUTED }],
                    ["Faltan para el pico", DIAS.map((_, d) => Math.max(0, g.pico[d] - m.trabajan[d] - m.llamados[d])), { color: "#b42318", fontWeight: 800 }],
                  ].map(([t, vals, st]) => (
                    <tr key={t} style={{ background: "#fafafa" }}>
                      <td colSpan={6} style={{ ...td, textAlign: "right", fontWeight: 700, color: NAVY }}>{t}</td>
                      {vals.map((v, d) => <td key={d} style={{ ...td, ...st }}>{v || (t === "Faltan para el pico" ? "—" : v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
