// ═══════════════════════════════════════════════════════════════════════════
// HELPERS DE FECHA · Bigticket opera en zona México (zona del negocio)
// ═══════════════════════════════════════════════════════════════════════════

// Devuelve la fecha "operativa" actual (día calendario en México) en formato YYYY-MM-DD
export function fechaHoyOperativa() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Devuelve el periodo "operativo" actual (mes en México) en formato YYYY-MM
export function periodoHoyOperativo() {
  return fechaHoyOperativa().slice(0, 7);
}

// Devuelve la fecha N días antes/después en zona México
export function fechaOperativaOffset(diasOffset) {
  const ahora = new Date();
  ahora.setDate(ahora.getDate() + diasOffset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

// Formatea una hora ISO en formato CL · MX (ej: "09:00 CL · 07:00 MX")
export function formatHoraDual(isoTimestamp) {
  if (!isoTimestamp) return "—";
  try {
    const d = new Date(isoTimestamp);
    const cl = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });
    const mx = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
    return `${cl} CL · ${mx} MX`;
  } catch { return "—"; }
}

// Solo hora Chile (formato corto)
export function formatHoraCL(isoTimestamp) {
  if (!isoTimestamp) return "—";
  try {
    return new Date(isoTimestamp).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });
  } catch { return "—"; }
}

// Solo hora México (formato corto)
export function formatHoraMX(isoTimestamp) {
  if (!isoTimestamp) return "—";
  try {
    return new Date(isoTimestamp).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
  } catch { return "—"; }
}
