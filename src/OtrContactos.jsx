// ═══════════════════════════════════════════════════════════════════════════
// OtrContactos.jsx — Indicadores Operacionales MX › Contactos OTR
// Mantenedor de los correos de los OTR de MELI por SC (otr_contactos_mx).
// A ellos va el correo de Cancelación que se dispara cuando el supervisor la
// registra en su bitácora. Abajo, los últimos correos de No Show y Cancelación
// (correos_nosal_log) y el modo de envío (prueba / activo / apagado).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { sb } from "./shared";

const NAVY = "#002E5D", ORANGE = "#FF6600", MUTED = "#64748b";
const card = { background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: 18, marginBottom: 18 };
const th = { textAlign: "left", fontSize: 11.5, color: "#fff", background: NAVY, padding: "9px 10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" };
const td = { padding: "8px 10px", borderBottom: "1px solid #eef0f3", fontSize: 13, verticalAlign: "middle" };
const inp = { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 9px", fontSize: 13 };
const btn = (bg, fg = "#fff") => ({ background: bg, color: fg, border: bg === "#fff" ? "1px solid #cbd5e1" : "none", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" });
const fechaHora = (x) => (x ? new Date(x).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const correoOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());

export default function OtrContactos({ usuario }) {
  const [filas, setFilas] = useState(null);
  const [edit, setEdit] = useState({});          // id → { nombre, email, telefono }
  const [nuevo, setNuevo] = useState({ sc: "", nombre: "", email: "", telefono: "" });
  const [filtro, setFiltro] = useState("");
  const [msg, setMsg] = useState("");
  const [modo, setModo] = useState(null);
  const [log, setLog] = useState([]);
  const quien = usuario?.email || window.__PERFIL_EMAIL || "brain";

  const cargar = async () => {
    const [c, m, l] = await Promise.all([
      sb.from("otr_contactos_mx").select("*").order("sc").order("email"),
      sb.from("correos_nosal_config").select("valor").eq("clave", "modo").maybeSingle(),
      sb.from("correos_nosal_log").select("*").order("creado_at", { ascending: false }).limit(40),
    ]);
    if (c.error) { setMsg("No se pudo cargar: " + c.error.message); setFilas([]); return; }
    setFilas(c.data || []); setModo(m.data?.valor || null); setLog(l.data || []);
  };
  useEffect(() => { cargar(); }, []);

  const visibles = useMemo(() => (filas || []).filter((f) => !filtro || `${f.sc} ${f.nombre} ${f.email}`.toLowerCase().includes(filtro.toLowerCase())), [filas, filtro]);
  const scsSinOtr = useMemo(() => {
    const con = new Set((filas || []).filter((f) => f.activo).map((f) => f.sc));
    return [...new Set((filas || []).map((f) => f.sc))].filter((s) => !con.has(s));
  }, [filas]);

  const guardar = async (f) => {
    const e = edit[f.id];
    if (!correoOk(e.email)) { setMsg("El correo no es válido."); return; }
    const { error } = await sb.from("otr_contactos_mx").update({ nombre: e.nombre.trim(), email: e.email.trim().toLowerCase(), telefono: e.telefono.trim(), actualizado_por: quien, actualizado_at: new Date().toISOString() }).eq("id", f.id);
    if (error) { setMsg("No se pudo guardar: " + error.message); return; }
    setEdit((p) => { const n = { ...p }; delete n[f.id]; return n; }); setMsg(`Correo del OTR de ${f.sc} actualizado.`); cargar();
  };
  const activar = async (f, v) => {
    const { error } = await sb.from("otr_contactos_mx").update({ activo: v, actualizado_por: quien, actualizado_at: new Date().toISOString() }).eq("id", f.id);
    if (error) { setMsg("No se pudo cambiar: " + error.message); return; }
    setMsg(v ? `${f.email} vuelve a recibir los correos de ${f.sc}.` : `${f.email} ya no recibe los correos de ${f.sc}.`); cargar();
  };
  const agregar = async () => {
    const sc = nuevo.sc.trim().toUpperCase();
    if (!sc || !correoOk(nuevo.email)) { setMsg("Para agregar, indica el SC y un correo válido."); return; }
    const { error } = await sb.from("otr_contactos_mx").insert({ sc, nombre: nuevo.nombre.trim(), email: nuevo.email.trim().toLowerCase(), telefono: nuevo.telefono.trim(), actualizado_por: quien });
    if (error) { setMsg(error.message.includes("duplicate") ? "Ese correo ya está cargado para ese SC." : "No se pudo agregar: " + error.message); return; }
    setNuevo({ sc: "", nombre: "", email: "", telefono: "" }); setMsg(`OTR agregado a ${sc}.`); cargar();
  };
  const cambiarModo = async (v) => {
    if (v === "activo" && !window.confirm("¿Activar los correos reales? Desde ahora llegarán a los transportistas, a los OTR de MELI y a las copias.")) return;
    const { error } = await sb.from("correos_nosal_config").update({ valor: v }).eq("clave", "modo");
    if (error) { setMsg("No se pudo cambiar el modo: " + error.message); return; }
    setModo(v); setMsg(`Modo de envío: ${v}.`);
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Correos de No Show y Cancelación</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>Se envían solos cuando el supervisor registra el caso en su bitácora (No Salidas a Ruta), desde supervisor@bigticket.mx.</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: MUTED }}>Modo:</span>
            {["prueba", "activo", "apagado"].map((v) => (
              <button key={v} onClick={() => cambiarModo(v)} style={btn(modo === v ? (v === "activo" ? "#16a34a" : v === "prueba" ? ORANGE : "#64748b") : "#fff", modo === v ? "#fff" : NAVY)}>
                {v === "prueba" ? "Prueba" : v === "activo" ? "Activo" : "Apagado"}</button>
            ))}
          </div>
        </div>
        {modo === "prueba" && <div style={{ marginTop: 10, fontSize: 12.5, color: "#9a3412", background: "#FFF4EC", borderRadius: 8, padding: "8px 12px" }}>En modo prueba todos los correos llegan solo al correo de prueba, con la lista real de destinatarios dentro del correo.</div>}
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Contactos OTR por SC</div>
          <input placeholder="Buscar SC, nombre o correo" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ ...inp, width: 260 }} />
        </div>
        {msg && <div style={{ marginBottom: 10, fontSize: 13, color: NAVY, background: "#eef2f7", borderRadius: 8, padding: "8px 12px" }}>{msg}</div>}
        {scsSinOtr.length > 0 && <div style={{ marginBottom: 10, fontSize: 12.5, color: "#b91c1c" }}>Sin OTR activo: {scsSinOtr.join(", ")}. Sus cancelaciones no tendrán destinatario.</div>}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead><tr><th style={{ ...th, borderRadius: "8px 0 0 8px" }}>SC</th><th style={th}>Nombre</th><th style={th}>Correo</th><th style={th}>Teléfono</th><th style={th}>Actualizado</th><th style={{ ...th, borderRadius: "0 8px 8px 0" }} /></tr></thead>
            <tbody>
              {filas === null ? <tr><td style={td} colSpan={6}>Cargando…</td></tr> : visibles.map((f) => {
                const e = edit[f.id];
                return (
                  <tr key={f.id} style={{ opacity: f.activo ? 1 : 0.5 }}>
                    <td style={{ ...td, fontWeight: 700, color: NAVY }}>{f.sc}</td>
                    <td style={td}>{e ? <input style={inp} value={e.nombre} onChange={(x) => setEdit((p) => ({ ...p, [f.id]: { ...e, nombre: x.target.value } }))} /> : (f.nombre || "—")}</td>
                    <td style={td}>{e ? <input style={inp} value={e.email} onChange={(x) => setEdit((p) => ({ ...p, [f.id]: { ...e, email: x.target.value } }))} /> : f.email}</td>
                    <td style={td}>{e ? <input style={inp} value={e.telefono} onChange={(x) => setEdit((p) => ({ ...p, [f.id]: { ...e, telefono: x.target.value } }))} /> : (f.telefono || "—")}</td>
                    <td style={{ ...td, fontSize: 12, color: MUTED }}>{fechaHora(f.actualizado_at)}{f.actualizado_por ? ` · ${f.actualizado_por}` : ""}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                      {e ? (<>
                        <button style={btn(NAVY)} onClick={() => guardar(f)}>Guardar</button>{" "}
                        <button style={btn("#fff", NAVY)} onClick={() => setEdit((p) => { const n = { ...p }; delete n[f.id]; return n; })}>Cancelar</button>
                      </>) : (<>
                        <button style={btn("#fff", NAVY)} onClick={() => setEdit((p) => ({ ...p, [f.id]: { nombre: f.nombre || "", email: f.email || "", telefono: f.telefono || "" } }))}>Editar</button>{" "}
                        <button style={btn("#fff", f.activo ? "#b91c1c" : "#16a34a")} onClick={() => activar(f, !f.activo)}>{f.activo ? "Desactivar" : "Activar"}</button>
                      </>)}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td style={td}><input style={inp} placeholder="SC" value={nuevo.sc} onChange={(e) => setNuevo({ ...nuevo, sc: e.target.value })} /></td>
                <td style={td}><input style={inp} placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></td>
                <td style={td}><input style={inp} placeholder="correo@mercadolibre.com.mx" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} /></td>
                <td style={td}><input style={inp} placeholder="Teléfono" value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} /></td>
                <td style={td} />
                <td style={{ ...td, textAlign: "right" }}><button style={btn(ORANGE)} onClick={agregar}>+ Agregar</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Últimos correos enviados</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
            <thead><tr><th style={{ ...th, borderRadius: "8px 0 0 8px" }}>Fecha ruta</th><th style={th}>SC</th><th style={th}>Tipo</th><th style={th}>Iba a</th><th style={th}>Enviado a</th><th style={th}>Estado</th><th style={{ ...th, borderRadius: "0 8px 8px 0" }}>Detalle</th></tr></thead>
            <tbody>
              {log.length === 0 ? <tr><td style={td} colSpan={7}>Todavía no hay correos.</td></tr> : log.map((l) => (
                <tr key={l.id}>
                  <td style={td}>{l.fecha}</td>
                  <td style={{ ...td, fontWeight: 700, color: NAVY }}>{l.sc}</td>
                  <td style={td}>{l.motivo === "no_show" ? "No Show" : "Cancelación"}</td>
                  <td style={{ ...td, fontSize: 12 }}>{l.para || "—"}</td>
                  <td style={{ ...td, fontSize: 12 }}>{l.enviado_a || "—"}{l.modo === "prueba" && <span style={{ color: ORANGE, fontWeight: 700 }}> · prueba</span>}</td>
                  <td style={{ ...td, fontWeight: 700, color: l.estado === "enviado" ? "#16a34a" : l.estado === "error" ? "#b91c1c" : MUTED }}>{l.estado}{l.enviado_at ? ` · ${fechaHora(l.enviado_at)}` : ""}</td>
                  <td style={{ ...td, fontSize: 12, color: MUTED, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.detalle || ""}>{l.asunto || ""}{l.detalle ? ` · ${l.detalle}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
