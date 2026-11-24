import { useState } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// CERTRONIC · CHILE — Aviso de actualización
// Muestra un aviso cuando:
//   1. La última corrida del pipeline tuvo errores o advertencias, o
//   2. Los datos llevan más de HORAS_MAX_SIN_DATOS sin actualizarse, aunque
//      no haya errores registrados (por ejemplo, si el cron dejó de correr).
// Para cada paso que falló indica qué información queda afectada y el comando
// exacto para reintentarlo en el servidor.
// ═══════════════════════════════════════════════════════════════════════════

const SERVIDOR = "root@162.243.90.161";
const CARPETA = "/opt/certronic-scraper";

// El liviano corre todos los días a las 03:00 (hora Chile). Con 30 horas de
// margen, un solo día sin corrida ya se avisa.
const HORAS_MAX_SIN_DATOS = 30;

// Qué hace cada paso del pipeline, qué se desactualiza si falla y cómo reintentarlo.
const PASOS = {
  1: {
    nombre: "Descarga del reporte del analista",
    afecta: "Dashboard Mensual, Activos Críticos y Hallazgos",
    comando: "./pipeline-certronic.sh liviano",
    ayuda: "Si en el log aparece «Usuario o contraseña incorrecta» o un Timeout en el inicio de sesión, revisa CERTRONIC_USER y CERTRONIC_PASS en /root/.bigticket_env.",
  },
  2: {
    nombre: "Descarga completa",
    afecta: "Recursos por contratista",
    comando: "./pipeline-certronic.sh completo",
    ayuda: "Si en el log aparece un error de inicio de sesión, revisa CERTRONIC_USER y CERTRONIC_PASS en /root/.bigticket_env.",
  },
  3: {
    nombre: "Procesamiento de la descarga completa",
    afecta: "Recursos por contratista",
    comando: "./pipeline-certronic.sh completo",
  },
  4: {
    nombre: "Cálculo de la certificación mensual",
    afecta: "Dashboard Mensual, Activos Críticos y Hallazgos",
    comando: "./pipeline-certronic.sh liviano",
  },
  5: {
    nombre: "Fichas de empleados",
    afecta: "Empleados, Dashboard Inicial y Riesgo RSE",
    comando: "node rescatar-fichas.cjs",
  },
  6: {
    nombre: "Fichas de vehículos",
    afecta: "Vehículos",
    comando: "node rescatar-vehiculos.cjs",
  },
  7: { nombre: "Reporte mensual", afecta: "Reporte mensual" },
  8: { nombre: "Registro de la corrida", afecta: "Este aviso" },
};

const numPaso = (p) => parseInt(String(p?.paso ?? ""), 10);
const conProblema = (p) => p && (p.status === "error" || p.status === "warn");
const terminoBien = (p) =>
  p && !["error", "warn", "skip", "skipped", "saltado"].includes(String(p.status || "").toLowerCase());

// Devuelve la corrida más reciente cuyos datos principales quedaron al día:
// la descarga (paso 1) y el cálculo (paso 4) terminaron bien. Si una corrida
// no trae el detalle de pasos, se usa su marca general tiene_errores.
export function ultimaCorridaConDatos(corridas) {
  let respaldo = null;
  for (const c of corridas || []) {
    const pasos = Array.isArray(c.pasos) ? c.pasos : [];
    const p1 = pasos.find((p) => numPaso(p) === 1);
    const p4 = pasos.find((p) => numPaso(p) === 4);
    if (p1 && p4 && terminoBien(p1) && terminoBien(p4)) return c;
    if (!respaldo && pasos.length === 0 && !c.tiene_errores) respaldo = c;
  }
  return respaldo;
}

const fmtFecha = (f) =>
  new Date(f).toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const fechaLog = (f) => new Date(f).toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });

function hace(horas) {
  if (!isFinite(horas)) return "";
  if (horas < 1) return "hace menos de una hora";
  if (horas < 48) {
    const h = Math.floor(horas);
    return `hace ${h} ${h === 1 ? "hora" : "horas"}`;
  }
  const d = Math.floor(horas / 24);
  return `hace ${d} días`;
}

function BloqueComando({ lineas }) {
  const [copiado, setCopiado] = useState(false);
  const texto = lineas.join("\n");
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch (_) { /* el navegador no permitió copiar */ }
  };
  return (
    <div style={{ position: "relative", marginTop: 4 }}>
      <pre style={{
        margin: 0, background: "#0f172a", color: "#e2e8f0", borderRadius: 6,
        padding: "8px 70px 8px 10px", fontSize: 11, lineHeight: 1.6,
        overflowX: "auto", whiteSpace: "pre",
      }}>{texto}</pre>
      <button onClick={copiar} style={{
        position: "absolute", top: 6, right: 6, padding: "2px 8px", fontSize: 10,
        border: "1px solid #334155", background: copiado ? "#16a34a" : "#1e293b",
        color: "#fff", borderRadius: 4, cursor: "pointer",
      }}>{copiado ? "Copiado" : "Copiar"}</button>
    </div>
  );
}

export function AvisoActualizacion({ corridas, onOcultar }) {
  if (!corridas || corridas.length === 0) return null;

  const ultima = corridas[0];
  const conDatos = ultimaCorridaConDatos(corridas);
  const horasSinDatos = conDatos ? (Date.now() - new Date(conDatos.fecha_run).getTime()) / 36e5 : Infinity;
  const datosViejos = horasSinDatos > HORAS_MAX_SIN_DATOS;
  const pasosConProblema = (Array.isArray(ultima.pasos) ? ultima.pasos : []).filter(conProblema);
  const ultimaFallo = !!ultima.tiene_errores || pasosConProblema.length > 0;

  if (!datosViejos && !ultimaFallo) return null;

  const grave = datosViejos;
  const color = grave
    ? { fondo: "#fef2f2", borde: "#fca5a5", barra: "#dc2626", titulo: "#991b1b", texto: "#7f1d1d" }
    : { fondo: "#fffbeb", borde: "#fcd34d", barra: "#f59e0b", titulo: "#92400e", texto: "#78350f" };

  // Título
  let titulo;
  if (!conDatos) titulo = "No hay ninguna actualización exitosa de Certronic registrada";
  else if (datosViejos) titulo = `Los datos de Certronic no se actualizan desde el ${fmtFecha(conDatos.fecha_run)} (${hace(horasSinDatos)})`;
  else titulo = `La actualización del ${fmtFecha(ultima.fecha_run)} terminó con ${pasosConProblema.length || 1} ${pasosConProblema.length === 1 ? "advertencia" : "advertencias"}`;

  // Explicación
  let explicacion;
  if (datosViejos && !ultimaFallo) {
    explicacion = `La última corrida registrada es del ${fmtFecha(ultima.fecha_run)} y no hubo corridas después. Lo más probable es que el proceso automático (cron) no esté corriendo.`;
  } else if (datosViejos) {
    explicacion = `La última corrida (${fmtFecha(ultima.fecha_run)}) falló, así que el Brain sigue mostrando los datos anteriores.`;
  } else {
    explicacion = `Los datos principales están al día (${fmtFecha(conDatos.fecha_run)}). Lo que falló puede dejar desactualizada solo una parte de la información.`;
  }

  // Comandos de solución, sin repetir
  const comandos = [];
  for (const p of pasosConProblema) {
    const cmd = PASOS[numPaso(p)]?.comando;
    if (cmd && !comandos.includes(cmd)) comandos.push(cmd);
  }
  if (datosViejos && !ultimaFallo) comandos.push("./pipeline-certronic.sh liviano");
  const ayudas = [...new Set(pasosConProblema.map((p) => PASOS[numPaso(p)]?.ayuda).filter(Boolean))];

  return (
    <div style={{
      background: color.fondo, border: `1px solid ${color.borde}`, borderLeft: `4px solid ${color.barra}`,
      borderRadius: 8, padding: "12px 16px", marginBottom: 14, color: color.texto, fontSize: 12,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: color.titulo, marginBottom: 4 }}>
            {grave ? "⛔" : "⚠️"} {titulo}
          </div>
          <div style={{ marginBottom: pasosConProblema.length ? 8 : 0, lineHeight: 1.5 }}>{explicacion}</div>

          {pasosConProblema.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {pasosConProblema.map((p, i) => {
                const info = PASOS[numPaso(p)] || {};
                return (
                  <div key={i} style={{ lineHeight: 1.5 }}>
                    <strong>Paso {p.paso} · {info.nombre || p.label}:</strong> {p.mensaje || "Sin detalle"}
                    {p.errores > 0 && <span style={{ color: "#dc2626", fontWeight: 700 }}> · {p.errores} fichas con error</span>}
                    {info.afecta && <div style={{ fontSize: 11, opacity: 0.85 }}>Información afectada: {info.afecta}</div>}
                  </div>
                );
              })}
            </div>
          )}

          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 11.5 }}>Cómo solucionarlo (requiere acceso al servidor)</summary>
            <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.6 }}>
              <div>1. Revisa el log de la corrida:</div>
              <BloqueComando lineas={[`ssh ${SERVIDOR}`, `tail -n 40 /var/log/certronic/pipeline-${fechaLog(ultima.fecha_run)}.log`]} />
              {ayudas.map((a, i) => <div key={i} style={{ marginTop: 6 }}>{a}</div>)}
              {datosViejos && !ultimaFallo && (
                <>
                  <div style={{ marginTop: 8 }}>2. Confirma que el cron siga programado:</div>
                  <BloqueComando lineas={["crontab -l | grep certronic"]} />
                </>
              )}
              {comandos.length > 0 && (
                <>
                  <div style={{ marginTop: 8 }}>{datosViejos && !ultimaFallo ? "3" : "2"}. Una vez corregida la causa, reintenta:</div>
                  <BloqueComando lineas={comandos.map((c) => `cd ${CARPETA} && ${c}`)} />
                </>
              )}
            </div>
          </details>
        </div>
        <button onClick={onOcultar} style={{
          padding: "4px 10px", border: `1px solid ${color.borde}`, background: "#fff", borderRadius: 6,
          fontSize: 11, color: color.titulo, cursor: "pointer", whiteSpace: "nowrap",
        }}>Ocultar</button>
      </div>
    </div>
  );
}
