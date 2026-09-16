// ═══════════════════════════════════════════════════════════════════════════
// Movimientos.jsx — El dinero del tercero, día por día: lo que se le paga y
// lo que se le cobra.
//
// Lee vw_portal_movimiento_dia. Los pagos vienen de días que el analista ya
// publicó; los cobros (PNR) aparecen el día que MELI los factura, con la fecha
// de la ruta que los originó en el detalle — sin eso, un descuento aparece en
// un día donde no pasó nada y el tercero no entiende de dónde sale.
//
// Desde acá se levanta una diferencia: se marcan las líneas, se comenta cada
// una y se adjuntan fotos. Eso abre un caso con folio en el Brain y una tarea
// para el supervisor del centro.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, BUCKET } from './supabaseClient'

function lunesDe(d) {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x
}
const iso = (d) => d.toISOString().slice(0, 10)
const sumaDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

// Numeración del Brain: ISO + 1
function semanaBrain(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dn = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - dn)
  const ini = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
  return Math.ceil(((x - ini) / 86400000 + 1) / 7) + 1
}

const money = (n) => (Number(n) < 0 ? '−' : '') + '$' +
  Math.abs(Number(n || 0)).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fechaLarga = (s) => {
  const t = new Date(s + 'T00:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const fechaCorta = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'
const rango = (a, b) => `${a.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`

// "Pagada" era falso: la ruta se aprueba el día siguiente, entra en la
// prefactura del lunes y se paga el viernes. Hasta entonces es "Por pagar".
// El verde queda reservado para cuando exista el registro del pago efectivo.
const ESTADOS = {
  aprobada:  { label: 'Por pagar',   bg: 'var(--amber-soft)',  fg: 'var(--amber)' },
  no_pagada: { label: 'No se paga',  bg: 'var(--red-soft)',    fg: 'var(--red)' },
  pausada:   { label: 'En revisión', bg: '#e8eefb',            fg: 'var(--navy)' },
  cobrado:   { label: 'Cobro',       bg: 'var(--orange-soft)', fg: '#b45309' },
}

const claveDe = (m) => `${m.tipo}|${m.fecha}|${m.ref}`

// El portal arranca el 14 de septiembre de 2026: antes de esa fecha no hay
// publicaciones, así que retroceder solo mostraría semanas vacías.
const INICIO_PORTAL = '2026-09-14'

const EST_DIF = {
  abierta:     { l: 'Recibida',    bg: 'var(--amber-soft)', fg: 'var(--amber)', ayuda: 'La recibimos. Un analista la va a revisar.' },
  en_revision: { l: 'En revisión', bg: '#dbeafe',           fg: '#1e40af',      ayuda: 'Un analista la está revisando.' },
  aceptada:    { l: 'Aceptada',    bg: 'var(--green-soft)', fg: 'var(--green)', ayuda: 'Se te reconoce lo reclamado. Entra en tu prefactura.' },
  parcial:     { l: 'Parcial',     bg: '#e0e7ff',           fg: '#3730a3',      ayuda: 'Se aceptó una parte. Mira el detalle de cada línea.' },
  rechazada:   { l: 'Rechazada',   bg: 'var(--red-soft)',   fg: 'var(--red)',   ayuda: 'No procede. La razón está en cada línea.' },
  retirada:    { l: 'Retirada',    bg: '#f1f5f9',           fg: 'var(--muted)', ayuda: 'La retiraste.' },
  vencida:     { l: 'Vencida',     bg: '#f1f5f9',           fg: 'var(--muted)', ayuda: 'Se cerró por plazo.' },
}

export default function Movimientos({ tercero, email, onBack }) {
  const [lunes, setLunes] = useState(() => lunesDe(new Date()))
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [cerrados, setCerrados] = useState({})

  // Modo reclamo
  const [reclamando, setReclamando] = useState(false)
  const [sel, setSel] = useState({})          // clave -> comentario
  const [faltantes, setFaltantes] = useState([])
  const [fotos, setFotos] = useState([])
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(null) // folio
  const [misDif, setMisDif] = useState([])     // reclamos del tercero, con sus líneas
  const [difAbierta, setDifAbierta] = useState(null)

  const domingo = useMemo(() => sumaDias(lunes, 6), [lunes])

  const cargar = useCallback(async () => {
    if (!tercero?.tercero_id) return
    setCargando(true); setError(null)
    const { data, error } = await supabase
      .from('vw_portal_movimiento_dia')
      .select('*')
      .eq('tercero_id', tercero.tercero_id)
      .gte('fecha', iso(lunes)).lte('fecha', iso(domingo))
      .order('fecha', { ascending: false })
    if (error) { setError(error.message); setFilas([]) } else { setFilas(data || []) }
    setCargando(false)
  }, [tercero, lunes, domingo])

  useEffect(() => { cargar() }, [cargar])

  // Los reclamos del tercero, con sus líneas y la respuesta del analista.
  // Sin esto, levantar una diferencia es gritar a un pozo.
  const cargarDif = useCallback(async () => {
    if (!tercero?.tercero_id) return
    const { data } = await supabase
      .from('diferencias')
      .select('*, diferencias_lineas(*)')
      .eq('tercero_id', tercero.tercero_id)
      .order('creada_at', { ascending: false })
    setMisDif(data || [])
  }, [tercero])

  useEffect(() => { cargarDif() }, [cargarDif, enviado])

  // Qué líneas del listado ya están reclamadas, para marcarlas
  const reclamadas = useMemo(() => {
    const m = {}
    for (const d of misDif) {
      if (d.estado === 'retirada') continue
      for (const l of (d.diferencias_lineas || [])) {
        if (l.id_ruta) m[`pago|${l.fecha}|${l.id_ruta}`] = { folio: d.folio, estado: d.estado, linea: l }
        if (l.cobro_id) m[`cobro|${l.cobro_id}`] = { folio: d.folio, estado: d.estado, linea: l }
      }
    }
    return m
  }, [misDif])

  const retirar = async (d) => {
    if (!confirm(`¿Retirar la diferencia #${d.folio}?\n\nDeja de estar en revisión y no se vuelve a abrir.`)) return
    const { error } = await supabase.from('diferencias').update({ estado: 'retirada' }).eq('id', d.id)
    if (error) { alert('No se pudo retirar: ' + error.message); return }
    await supabase.from('diferencias_eventos').insert({
      diferencia_id: d.id, tipo: 'retirada', actor: email || tercero.nombre,
      detalle: 'El tercero retiró el reclamo',
    })
    cargarDif()
  }

  const dias = useMemo(() => {
    const m = new Map()
    for (const f of filas) {
      if (!m.has(f.fecha)) m.set(f.fecha, [])
      m.get(f.fecha).push(f)
    }
    return [...m.entries()].map(([fecha, movs]) => ({
      fecha,
      movs: movs.sort((a, b) => a.tipo.localeCompare(b.tipo) || String(a.placa).localeCompare(String(b.placa))),
      neto: movs.reduce((s, r) => s + (r.estado === 'aprobada' || r.tipo === 'cobro' ? Number(r.monto || 0) : 0), 0),
      enRevision: movs.filter(r => r.estado === 'pausada').length,
      noPagadas: movs.filter(r => r.estado === 'no_pagada').length,
    }))
  }, [filas])

  const totalPagos = filas.filter(f => f.tipo === 'pago' && f.estado === 'aprobada').reduce((s, f) => s + Number(f.monto || 0), 0)
  const totalCobros = filas.filter(f => f.tipo === 'cobro').reduce((s, f) => s + Number(f.monto || 0), 0)

  const nSel = Object.keys(sel).length + faltantes.length

  const toggleSel = (m) => {
    const k = claveDe(m)
    setSel(p => {
      const n = { ...p }
      if (k in n) delete n[k]; else n[k] = ''
      return n
    })
  }

  const enviarDiferencia = async () => {
    const sinComentario = Object.entries(sel).filter(([, c]) => !c.trim())
    if (sinComentario.length) { alert('Escribe qué reclamas en cada línea marcada.'); return }
    if (faltantes.some(f => !f.placa.trim() || !f.comentario.trim())) {
      alert('En lo que falta, indica al menos la placa y qué ocurrió.'); return
    }
    setEnviando(true)
    try {
      const porClave = {}
      for (const f of filas) porClave[claveDe(f)] = f
      const lineasSel = Object.entries(sel).map(([k, comentario]) => {
        const m = porClave[k]
        return {
          tipo: m.tipo === 'cobro' ? 'cobro' : 'ruta',
          fecha: m.tipo === 'cobro' ? (m.fecha_hecho || m.fecha) : m.fecha,
          id_ruta: m.tipo === 'pago' ? m.ref : null,
          cobro_id: m.tipo === 'cobro' ? m.cobro_id : null,
          placa: m.placa, monto_ref: Math.abs(Number(m.monto || 0)),
          comentario: comentario.trim(),
        }
      })
      const lineasFalt = faltantes.map(f => ({
        tipo: 'faltante', fecha: f.fecha || null, id_ruta: f.id_ruta?.trim() || null,
        cobro_id: null, placa: f.placa.trim(), monto_ref: null, comentario: f.comentario.trim(),
      }))
      const lineas = [...lineasSel, ...lineasFalt]
      const scs = [...new Set(Object.keys(sel).map(k => porClave[k]?.sc).filter(Boolean))]

      const { data: dif, error: eDif } = await supabase.from('diferencias').insert({
        tercero_id: tercero.tercero_id,
        service_center: scs.length === 1 ? scs[0] : null,
        monto_reclamado: lineas.reduce((s, l) => s + Number(l.monto_ref || 0), 0),
        creada_por: email || tercero.nombre,
      }).select('id, folio').single()
      if (eDif) throw eDif

      const { error: eLin } = await supabase.from('diferencias_lineas')
        .insert(lineas.map(l => ({ ...l, diferencia_id: dif.id })))
      if (eLin) throw eLin

      for (const file of fotos) {
        const path = `diferencias/${dif.id}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`
        const { error: eUp } = await supabase.storage.from(BUCKET).upload(path, file)
        if (!eUp) {
          await supabase.from('diferencias_adjuntos').insert({
            diferencia_id: dif.id, storage_path: path, nombre: file.name,
            subido_por: email || tercero.nombre,
          })
        }
      }

      await supabase.from('diferencias_eventos').insert({
        diferencia_id: dif.id, tipo: 'creada', actor: email || tercero.nombre,
        detalle: `${lineas.length} línea(s) reclamada(s)${fotos.length ? ` · ${fotos.length} adjunto(s)` : ''}`,
      })

      // Abre el caso: calcula el SLA de 48 h y genera la tarea al supervisor
      // de cada centro involucrado. Si esto falla, el reclamo igual quedó
      // guardado — pero nadie se entera, así que hay que decirlo.
      const { error: eAbrir } = await supabase.rpc('fn_abrir_diferencia', { p_dif: dif.id })
      if (eAbrir) {
        alert(`Tu diferencia #${dif.folio} quedó registrada, pero no se pudo avisar al supervisor.\n\nAvísanos por el chat de consultas citando ese número.`)
      }

      // Correo al supervisor del centro, con copia a análisis. El envío no
      // bloquea: si el correo falla, la tarea ya está creada y el caso vive
      // igual en la bitácora del supervisor.
      try {
        const { data: payload } = await supabase.rpc('fn_payload_aviso_diferencia', { p_dif: dif.id })
        if (payload) {
          await fetch('https://bigticket2026.app.n8n.cloud/webhook/diferencia-notificar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        }
      } catch (e) { console.error('No se pudo enviar el aviso por correo:', e) }

      setEnviado(dif.folio)
      setSel({}); setFaltantes([]); setFotos([]); setReclamando(false)
    } catch (e) {
      alert('No se pudo enviar la diferencia:\n\n' + (e.message || e))
    }
    setEnviando(false)
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <button className="back-link" onClick={onBack}>← Volver</button>

      {/* Cabecera: semana y totales */}
      <div style={{ background: 'var(--navy)', color: '#fff', borderRadius: 14, padding: '18px 20px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setLunes(sumaDias(lunes, -7))}
              disabled={iso(lunes) <= INICIO_PORTAL}
              title={iso(lunes) <= INICIO_PORTAL ? 'Es la primera semana disponible' : ''}
              style={{ ...navBtn, opacity: iso(lunes) <= INICIO_PORTAL ? 0.35 : 1,
                cursor: iso(lunes) <= INICIO_PORTAL ? 'not-allowed' : 'pointer' }}>‹</button>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Semana {semanaBrain(lunes)}</div>
              <div style={{ fontSize: 12.5, color: '#b8c6de' }}>{rango(lunes, domingo)}</div>
            </div>
            <button onClick={() => setLunes(sumaDias(lunes, 7))} style={navBtn}>›</button>
          </div>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
            <Tot label="Por pagar" valor={money(totalPagos)} />
            <Tot label="Cobros" valor={money(totalCobros)} tenue />
            <Tot label="Neto" valor={money(totalPagos + totalCobros)} grande />
          </div>
        </div>
      </div>

      {enviado && (
        <div style={{ background: 'var(--green-soft)', color: 'var(--green)', borderRadius: 12, padding: '14px 16px', marginBottom: 12, fontSize: 13.5 }}>
          <b>Diferencia #{enviado} enviada.</b> La revisa un analista y te responde acá mismo.
          Vas a ver el avance en esta misma pantalla.
        </div>
      )}

      {/* Barra de reclamo */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        flexWrap: 'wrap', marginBottom: 12,
      }}>
        {!reclamando ? (
          <>
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              ¿Algo no cuadra? Marca las líneas y cuéntanos qué pasó.
            </span>
            <button onClick={() => { setReclamando(true); setEnviado(null) }}
              style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600 }}>
              Levantar diferencia
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>
              <b>{nSel}</b> línea(s) marcada(s). Escribe qué reclamas en cada una.
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setReclamando(false); setSel({}); setFaltantes([]); setFotos([]) }}
                style={{ background: '#fff', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 14px', fontSize: 13 }}>
                Cancelar
              </button>
              <button onClick={enviarDiferencia} disabled={nSel === 0 || enviando}
                style={{ background: nSel === 0 || enviando ? '#c8ced8' : 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600 }}>
                {enviando ? 'Enviando…' : `Enviar diferencia (${nSel})`}
              </button>
            </span>
          </>
        )}
      </div>

      {/* Mis diferencias: en qué va cada reclamo */}
      {misDif.length > 0 && !reclamando && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)', fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>
            Mis diferencias
          </div>
          {misDif.map(d => {
            const e = EST_DIF[d.estado] || EST_DIF.abierta
            const abierta = difAbierta === d.id
            const puedeRetirar = d.estado === 'abierta'
            return (
              <div key={d.id} style={{ borderBottom: '1px solid #f1f4f8' }}>
                <button onClick={() => setDifAbierta(abierta ? null : d.id)}
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 18px', background: 'transparent', border: 'none', textAlign: 'left' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>Diferencia #{d.folio}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: e.bg, color: e.fg, letterSpacing: '.04em' }}>
                        {e.l.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
                      {(d.diferencias_lineas || []).length} línea(s) · {new Date(d.creada_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} · {e.ayuda}
                    </div>
                  </div>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>{abierta ? '▴' : '▾'}</span>
                </button>

                {abierta && (
                  <div style={{ padding: '0 18px 14px' }}>
                    {(d.diferencias_lineas || []).map(l => (
                      <div key={l.id} style={{ background: 'var(--page)', borderRadius: 8, padding: '10px 12px', marginBottom: 6, fontSize: 12.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600 }}>
                            {l.tipo === 'cobro' ? 'Cobro' : l.tipo === 'faltante' ? 'Ruta que falta' : 'Ruta'}
                            {l.placa ? ` · ${l.placa}` : ''}{l.id_ruta ? ` · ${l.id_ruta}` : ''}
                          </span>
                          <span style={{ color: 'var(--muted)' }}>{l.fecha || ''}</span>
                        </div>
                        <div style={{ color: 'var(--muted)', marginTop: 4 }}>Reclamaste: {l.comentario}</div>
                        {l.estado !== 'pendiente' && (
                          <div style={{ marginTop: 6, color: l.estado === 'aceptada' ? 'var(--green)' : 'var(--red)' }}>
                            <b>{l.estado === 'aceptada' ? 'Aceptada' : 'Rechazada'}
                              {l.monto_reconocido ? ` · ${money(l.monto_reconocido)}` : ''}:</b> {l.resolucion}
                          </div>
                        )}
                      </div>
                    ))}
                    {puedeRetirar && (
                      <button onClick={() => retirar(d)}
                        style={{ background: '#fff', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 14px', fontSize: 12.5 }}>
                        Retirar este reclamo
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {error && <div className="form-error">No se pudieron cargar tus movimientos: {error}</div>}

      {cargando ? (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: 24, textAlign: 'center' }}>Cargando…</div>
      ) : dias.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Todavía no hay movimientos de esta semana</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)', maxWidth: 460, margin: '0 auto' }}>
            Cada día se revisa y se publica al día siguiente. Si operaste un día que no aparece, levanta una diferencia.
          </div>
        </div>
      ) : dias.map(d => {
        const abierto = !cerrados[d.fecha]
        return (
          <div key={d.fecha} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, marginBottom: 12, overflow: 'hidden' }}>
            <button onClick={() => setCerrados(p => ({ ...p, [d.fecha]: abierto }))}
              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'transparent', border: 'none', textAlign: 'left' }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--navy)' }}>{fechaLarga(d.fecha)}</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
                  {d.movs.length} movimiento{d.movs.length > 1 ? 's' : ''}
                  {d.noPagadas > 0 && <span style={{ color: 'var(--red)' }}> · {d.noPagadas} no pagada{d.noPagadas > 1 ? 's' : ''}</span>}
                  {d.enRevision > 0 && <span style={{ color: 'var(--amber)' }}> · {d.enRevision} en revisión</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(d.neto)}</span>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>{abierto ? '▴' : '▾'}</span>
              </div>
            </button>

            {abierto && (
              <div style={{ borderTop: '1px solid var(--line)' }}>
                {d.movs.map(m => {
                  const k = claveDe(m)
                  const marcado = k in sel
                  const est = ESTADOS[m.estado] || ESTADOS.aprobada
                  const esCobro = m.tipo === 'cobro'
                  return (
                    <div key={k} style={{ borderBottom: '1px solid #f1f4f8', background: marcado ? 'var(--orange-soft)' : 'transparent' }}>
                      <div style={{ padding: '13px 18px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        {reclamando && (
                          <input type="checkbox" checked={marcado} onChange={() => toggleSel(m)}
                            style={{ marginTop: 4, width: 17, height: 17, accentColor: 'var(--orange)' }} />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>{m.placa || '—'}</span>
                            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: est.bg, color: est.fg, letterSpacing: '.04em' }}>
                              {est.label.toUpperCase()}
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                              {esCobro ? `PNR ${m.ref}` : `Ruta ${m.ref}`}
                            </span>
                            {(() => {
                              const rec = esCobro ? reclamadas[`cobro|${m.cobro_id}`] : reclamadas[`pago|${m.fecha}|${m.ref}`]
                              if (!rec) return null
                              const e = EST_DIF[rec.estado] || EST_DIF.abierta
                              return (
                                <span title={e.ayuda} style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: e.bg, color: e.fg, letterSpacing: '.04em' }}>
                                  DIFERENCIA #{rec.folio} · {e.l.toUpperCase()}
                                </span>
                              )
                            })()}
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
                            {m.driver_name || 'Sin conductor registrado'}{m.sc ? ` · ${m.sc}` : ''}
                          </div>

                          {esCobro ? (
                            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>
                              {m.concepto || 'Cobro'} · ruta del <b style={{ color: 'var(--ink)' }}>{fechaCorta(m.fecha_hecho)}</b>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
                              <Dato label="NS" valor={m.ns_pct != null ? `${Number(m.ns_pct).toFixed(1)}%` : '—'} />
                              <Dato label="Visitado" valor={m.pct_visitado != null ? `${Number(m.pct_visitado).toFixed(1)}%` : '—'} />
                              {m.tiene_auxiliar && <Dato label="Ayudante" valor={money(m.monto_auxiliar)} />}
                            </div>
                          )}

                          {m.estado === 'no_pagada' && (
                            <Nota color="var(--red)" bg="var(--red-soft)" titulo="No se pagó">
                              {m.motivo || 'sin motivo registrado'}
                            </Nota>
                          )}
                          {m.estado === 'pausada' && (
                            <Nota color="var(--amber)" bg="var(--amber-soft)" titulo="En revisión">
                              {m.motivo || 'pendiente de resolución'}
                            </Nota>
                          )}

                          {marcado && (
                            <textarea value={sel[k]} onChange={e => setSel(p => ({ ...p, [k]: e.target.value }))}
                              placeholder="¿Qué reclamas de esta línea? Sé lo más concreto posible."
                              rows={2}
                              style={{ width: '100%', marginTop: 10, border: '1px solid var(--orange)', borderRadius: 8, padding: '8px 10px', fontSize: 13, resize: 'vertical' }} />
                          )}
                        </div>

                        <div style={{
                          fontSize: 15.5, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                          color: esCobro ? 'var(--red)' : m.estado === 'aprobada' ? 'var(--ink)' : 'var(--muted)',
                          textDecoration: m.estado === 'no_pagada' ? 'line-through' : 'none',
                        }}>
                          {money(m.monto)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Lo que falta: no hay línea que marcar */}
      {reclamando && (
        <div style={{ background: 'var(--card)', border: '1px dashed var(--orange)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>¿Falta algo que operaste?</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
            Si una ruta que hiciste no aparece arriba, decláralas acá con su placa y fecha.
          </div>
          {faltantes.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <input value={f.placa} onChange={e => setFaltantes(p => p.map((x, j) => j === i ? { ...x, placa: e.target.value } : x))}
                placeholder="Placa" style={{ ...inp, width: 110 }} />
              <input type="date" value={f.fecha} onChange={e => setFaltantes(p => p.map((x, j) => j === i ? { ...x, fecha: e.target.value } : x))}
                style={{ ...inp, width: 150 }} />
              <input value={f.id_ruta} onChange={e => setFaltantes(p => p.map((x, j) => j === i ? { ...x, id_ruta: e.target.value } : x))}
                placeholder="Id de ruta (si lo tienes)" style={{ ...inp, width: 180 }} />
              <input value={f.comentario} onChange={e => setFaltantes(p => p.map((x, j) => j === i ? { ...x, comentario: e.target.value } : x))}
                placeholder="¿Qué ocurrió?" style={{ ...inp, flex: 1, minWidth: 180 }} />
              <button onClick={() => setFaltantes(p => p.filter((_, j) => j !== i))}
                style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--muted)', borderRadius: 6, padding: '0 12px' }}>×</button>
            </div>
          ))}
          <button onClick={() => setFaltantes(p => [...p, { placa: '', fecha: iso(lunes), id_ruta: '', comentario: '' }])}
            style={{ border: '1px solid var(--orange)', background: '#fff', color: 'var(--orange)', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600 }}>
            + Agregar una ruta que falta
          </button>

          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Evidencia (opcional)</div>
            <input type="file" multiple accept="image/*,application/pdf"
              onChange={e => setFotos([...e.target.files])} style={{ fontSize: 12.5 }} />
            {fotos.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{fotos.length} archivo(s) listo(s)</div>
            )}
          </div>
        </div>
      )}

      {dias.length > 0 && !reclamando && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', textAlign: 'center', padding: '8px 0 24px' }}>
          Estos montos son los que irán en tu prefactura del lunes y se pagan el viernes.
        </div>
      )}
    </div>
  )
}

function Tot({ label, valor, grande, tenue }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ color: '#b8c6de', fontSize: 11, letterSpacing: '.08em' }}>{label.toUpperCase()}</div>
      <div style={{ color: tenue ? '#e4b9a0' : '#fff', fontSize: grande ? 25 : 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
    </div>
  )
}

function Dato({ label, valor }) {
  return (
    <span style={{ fontSize: 12 }}>
      <span style={{ color: 'var(--muted)' }}>{label} </span>
      <b style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{valor}</b>
    </span>
  )
}

function Nota({ color, bg, titulo, children }) {
  return (
    <div style={{ marginTop: 8, background: bg, color, borderRadius: 8, padding: '8px 10px', fontSize: 12.5 }}>
      <b>{titulo}:</b> {children}
    </div>
  )
}

const navBtn = { background: 'var(--navy-line)', color: '#fff', border: 'none', borderRadius: 8, width: 30, height: 30, fontSize: 16, lineHeight: 1 }
const inp = { border: '1px solid var(--line)', borderRadius: 6, padding: '7px 10px', fontSize: 12.5 }
