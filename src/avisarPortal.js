// ═══════════════════════════════════════════════════════════════════════════
// avisarPortal.js — Empuja al teléfono del tercero lo que acaba de publicarse.
//
// El aviso nace del hecho, no de un reloj: cuando el analista publica un
// cobro, genera una prefactura o publica un día, ese botón avisa. Preguntar
// cada quince minutos si pasó algo gasta recursos para que la respuesta sea
// "no" casi siempre.
//
// Lo que llega al teléfono ya está decidido en la base: `config_notificaciones`
// dice qué tipos tienen push y `config_push` en qué horario. Acá solo se avisa
// que hay algo que mirar; si no hay nada en la cola, n8n no envía nada.
//
// Nunca interrumpe al analista: si el aviso falla, el cobro ya quedó guardado
// y la cola se vacía en el siguiente evento. Por eso no se lanza el error.
// ═══════════════════════════════════════════════════════════════════════════

const WEBHOOK = 'https://bigticket2026.app.n8n.cloud/webhook/portal-avisar'

export async function avisarPortal(motivo, datos = {}) {
  try {
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo, ...datos, en: new Date().toISOString() }),
    })
  } catch (e) {
    // Solo queda en la consola: el trabajo del analista ya está hecho.
    console.warn('[avisarPortal] no se pudo avisar:', motivo, e?.message || e)
  }
}
