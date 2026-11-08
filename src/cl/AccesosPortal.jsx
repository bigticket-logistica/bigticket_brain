// ═══════════════════════════════════════════════════════════════════════════
// cl/AccesosPortal.jsx — Mantenedor de claves del Portal Transportista Chile.
//
// Cada empresa (del Maestro de Certificación) entra al portal con su RUT y una
// clave. Aquí se crean, restablecen, envían por correo y bloquean.
// Datos: vw_portal_accesos_cl · fn_portal_cl_clave · fn_portal_cl_bloquear
// (Supabase Chile). Las funciones exigen el PIN de administración, que vive solo
// en el Vault: se escribe aquí y no se guarda.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";
const C = { navy: "#002E5D", naranja: "#FF6600", borde: "#e4e7ec", suave: "#475569", tenue: "#94a3b8", fondo: "#f4f6f9", rojo: "#9e3b1b", rojoT: "#faece6", verde: "#1f7a5c", verdeT: "#e9f3ef" };
async function api(path, o = {}) {
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, { method: o.method || "GET", headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" }, body: o.body });
  if (!r.ok) { let m = await r.text(); try { m = JSON.parse(m).message || m; } catch { /* texto */ } throw new Error(String(m).slice(0, 300)); }
  const t = await r.text(); return t && t.trim() ? JSON.parse(t) : true;
}
const rpc = (fn, a) => api(`rpc/${fn}`, { method: "POST", body: JSON.stringify(a) });
const fh = (s) => s ? new Date(s).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const inp = { border: `1px solid ${C.borde}`, borderRadius: 8, padding: "7px 10px", fontSize: 13, fontFamily: "inherit" };
const btn = (t) => ({ border: t === "sec" ? `1px solid ${C.borde}` : "none", background: t === "sec" ? "#fff" : t === "rojo" ? C.rojo : t === "naranja" ? C.naranja : C.navy, color: t === "sec" ? C.navy : "#fff", borderRadius: 8, padding: "6px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" });

export default function AccesosPortalCL({ usuario }) {
  const quien = usuario?.email || usuario?.nombre || "brain";
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");
  const [pin, setPin] = useState("");
  const [f, setF] = useState({ texto: "", estado: "activas", acceso: "todos" });
  const [enviar, setEnviar] = useState(false);   // apagado: el envío se activa cuando el portal esté listo
  const [busy, setBusy] = useState("");
  const [resultado, setResultado] = useState(null);   // { rut, empresa, clave, enviada, enviada_a }
  const [lote, setLote] = useState(null);             // resultados de la creación masiva

  const cargar = () => api("vw_portal_accesos_cl?select=*&order=empresa").then((d) => { setFilas(d); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  const vis = useMemo(() => (filas || []).filter((x) => {
    if (f.estado === "activas" && x.estado !== "ACTIVA") return false;
    if (f.acceso === "con" && !x.tiene_acceso) return false;
    if (f.acceso === "sin" && x.tiene_acceso) return false;
    if (f.acceso === "bloqueados" && !(x.tiene_acceso && x.acceso_activo === false)) return false;
    if (f.texto && !`${x.rut} ${x.empresa} ${(x.cecos || []).join(" ")} ${(x.correos || []).join(" ")}`.toLowerCase().includes(f.texto.toLowerCase())) return false;
    return true;
  }), [filas, f]);
  const n = (fn) => (filas || []).filter(fn).length;

  const pedirPin = () => { if (!pin) { setError("Escribe el PIN de administración arriba."); return false; } return true; };
  const clave = async (x) => {
    if (!pedirPin()) return;
    if (x.tiene_acceso && !window.confirm(`¿Restablecer la clave de ${x.empresa}? La anterior deja de funcionar.`)) return;
    setBusy(x.rut); setError("");
    try { const r = await rpc("fn_portal_cl_clave", { p_rut: x.rut, p_pin: pin, p_enviar: enviar, p_por: quien }); setResultado(r); cargar(); }
    catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const bloquear = async (x, activo) => {
    if (!pedirPin()) return;
    if (!activo && !window.confirm(`¿Bloquear el acceso de ${x.empresa}? No podrá entrar al portal hasta que lo reactives.`)) return;
    setBusy(x.rut); setError("");
    try { await rpc("fn_portal_cl_bloquear", { p_rut: x.rut, p_pin: pin, p_activo: activo, p_por: quien }); cargar(); }
    catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const crearTodas = async () => {
    if (!pedirPin()) return;
    const pend = (filas || []).filter((x) => x.estado === "ACTIVA" && !x.tiene_acceso);
    if (!pend.length) { setError("Todas las empresas activas ya tienen acceso."); return; }
    if (!window.confirm(`Crear clave a ${pend.length} empresas activas sin acceso${enviar ? " y ENVIARLA por correo a cada una" : " (sin enviar correo)"}?`)) return;
    const res = [];
    for (let i = 0; i < pend.length; i++) {
      setBusy(`lote ${i + 1}/${pend.length}`);
      try { const r = await rpc("fn_portal_cl_clave", { p_rut: pend[i].rut, p_pin: pin, p_enviar: enviar, p_por: quien }); res.push({ ...r, ok: true }); }
      catch (e) { res.push({ rut: pend[i].rut, empresa: pend[i].empresa, ok: false, error: e.message }); if (/PIN/.test(e.message)) break; }
    }
    setBusy(""); setLote(res); cargar();
  };
  const descargarLote = () => {
    const filasCsv = [["RUT", "Empresa", "Clave", "Enviada a", "Error"], ...lote.map((r) => [r.rut, r.empresa, r.clave || "", r.enviada_a || "", r.error || ""])];
    const csv = "\uFEFF" + filasCsv.map((x) => x.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `claves_portal_cl_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  return (
    <div style={{ padding: "20px 24px" }}>
      <div style={{ fontSize: 13.5, color: C.suave, marginBottom: 14, maxWidth: 900 }}>
        Cada empresa entra al <b>Portal Transportista</b> con su <b>RUT</b> y una <b>clave</b>. Las empresas y sus vehículos vienen del Maestro de Certificación.
        La clave se muestra una sola vez; si se pierde, se restablece.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {[["Empresas activas", n((x) => x.estado === "ACTIVA"), C.navy], ["Con acceso", n((x) => x.tiene_acceso && x.acceso_activo), C.verde],
          ["Activas sin acceso", n((x) => x.estado === "ACTIVA" && !x.tiene_acceso), C.naranja], ["Ya entraron al portal", n((x) => x.ultimo_ingreso_at), C.suave]].map(([t, v, c]) => (
          <div key={t} style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 160px" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input type="password" style={{ ...inp, width: 160 }} placeholder="PIN de administración" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
        <label style={{ fontSize: 12.5, color: C.suave, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} /> Enviar la clave por correo a la empresa (apagado por ahora)
        </label>
        <span style={{ flex: 1 }} />
        <button style={btn("naranja")} disabled={!!busy} onClick={crearTodas}>Crear clave a todas las activas sin acceso</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={inp} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="activas">Solo activas</option><option value="todas">Todas</option></select>
        <select style={inp} value={f.acceso} onChange={(e) => setF({ ...f, acceso: e.target.value })}>
          <option value="todos">Con y sin acceso</option><option value="sin">Sin acceso</option><option value="con">Con acceso</option><option value="bloqueados">Bloqueados</option>
        </select>
        <input style={{ ...inp, flex: 1, minWidth: 200 }} placeholder="Buscar RUT, empresa, CECO o correo…" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <button style={btn("sec")} onClick={cargar}>↻</button>
      </div>
      {busy.startsWith("lote") && <div style={{ fontSize: 13, color: C.navy, marginBottom: 8 }}>Creando claves… {busy.replace("lote ", "")}</div>}
      {error && <div style={{ background: C.rojoT, color: C.rojo, borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 13 }}>{error}</div>}

      {resultado && (
        <div style={{ background: C.verdeT, border: `1px solid ${C.verde}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 800, color: C.verde }}>Clave lista · {resultado.empresa}</div>
          <div style={{ marginTop: 8, fontSize: 14 }}>Usuario (RUT): <b>{resultado.rut}</b> · Clave: <b style={{ fontFamily: "monospace", fontSize: 18 }}>{resultado.clave}</b>
            <button style={{ ...btn("sec"), marginLeft: 10 }} onClick={() => navigator.clipboard?.writeText(`Portal Transportista Bigticket\nUsuario (RUT): ${resultado.rut}\nClave: ${resultado.clave}`)}>Copiar</button></div>
          <div style={{ fontSize: 12.5, color: C.suave, marginTop: 6 }}>{resultado.enviada ? `Enviada por correo a ${resultado.enviada_a}.` : "No se envió por correo."} Esta clave no se vuelve a mostrar.</div>
          <button style={{ ...btn("sec"), marginTop: 8 }} onClick={() => setResultado(null)}>Listo</button>
        </div>
      )}
      {lote && (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 800, color: C.navy }}>Creación masiva: {lote.filter((r) => r.ok).length} creadas, {lote.filter((r) => !r.ok).length} con error</div>
          <div style={{ fontSize: 12.5, color: C.suave, margin: "6px 0 8px" }}>Descarga la planilla ahora: las claves no se vuelven a mostrar.</div>
          <button style={btn()} onClick={descargarLote}>Descargar planilla con las claves</button>
          <button style={{ ...btn("sec"), marginLeft: 8 }} onClick={() => setLote(null)}>Cerrar</button>
        </div>
      )}

      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: C.fondo, color: C.suave, textAlign: "left" }}>
            {["RUT", "Empresa", "CECO", "Vehículos", "Correo", "Acceso", "Último ingreso", ""].map((h) => <th key={h} style={{ padding: "9px 10px", fontSize: 12, whiteSpace: "nowrap" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filas === null && <tr><td colSpan={8} style={{ padding: 18, color: C.tenue }}>Cargando…</td></tr>}
            {filas && vis.length === 0 && <tr><td colSpan={8} style={{ padding: 18, color: C.tenue }}>Nada con estos filtros.</td></tr>}
            {vis.map((x) => (
              <tr key={x.rut} style={{ borderTop: `1px solid ${C.borde}`, opacity: x.estado === "ACTIVA" ? 1 : 0.55 }}>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap", fontWeight: 700, color: C.navy }}>{x.rut}</td>
                <td style={{ padding: "8px 10px" }}>{x.empresa}<div style={{ fontSize: 11.5, color: C.tenue }}>{x.contacto || ""}{x.telefono ? ` · ${x.telefono}` : ""}</div></td>
                <td style={{ padding: "8px 10px", fontSize: 12 }}>{(x.cecos || []).join(", ")}</td>
                <td style={{ padding: "8px 10px", textAlign: "center" }}>{x.vehiculos_activos}</td>
                <td style={{ padding: "8px 10px", fontSize: 12 }}>{(x.correos || []).join(", ") || <span style={{ color: C.rojo }}>Sin correo</span>}</td>
                <td style={{ padding: "8px 10px", fontSize: 12, whiteSpace: "nowrap" }}>
                  {!x.tiene_acceso ? <span style={{ color: C.tenue }}>Sin acceso</span>
                    : x.acceso_activo ? <span style={{ color: C.verde, fontWeight: 700 }}>Activo</span> : <span style={{ color: C.rojo, fontWeight: 700 }}>Bloqueado</span>}
                  {x.clave_actualizada_at && <div style={{ color: C.tenue }}>clave {fh(x.clave_actualizada_at)}</div>}
                  {x.clave_enviada_at && <div style={{ color: C.tenue }}>enviada {fh(x.clave_enviada_at)}</div>}
                </td>
                <td style={{ padding: "8px 10px", fontSize: 12, whiteSpace: "nowrap" }}>{fh(x.ultimo_ingreso_at)}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                  {x.estado === "ACTIVA" && <button style={btn(x.tiene_acceso ? "sec" : undefined)} disabled={busy === x.rut} onClick={() => clave(x)}>{x.tiene_acceso ? "Restablecer clave" : "Crear clave"}</button>}
                  {x.tiene_acceso && (x.acceso_activo
                    ? <button style={{ ...btn("sec"), marginLeft: 6, color: C.rojo }} disabled={busy === x.rut} onClick={() => bloquear(x, false)}>Bloquear</button>
                    : <button style={{ ...btn("sec"), marginLeft: 6 }} disabled={busy === x.rut} onClick={() => bloquear(x, true)}>Reactivar</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
