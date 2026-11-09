// ═══════════════════════════════════════════════════════════════════════════
// Auditorias.jsx — Auditorías de vehículo y limpieza (Portal Chile).
//  · Lista del periodo: pendientes con contador, hechas con quién y cuándo.
//  · Auditoría guiada: una foto a la vez, solo con la cámara, con la
//    instrucción de cada vista. Cada foto se sube apenas se toma (si se corta
//    la señal, al volver se retoma donde quedó) y guarda hora y ubicación.
//  · La foto de % de batería se pide solo en vehículos eléctricos y la selfie
//    abre la cámara frontal.
//  · Vehículo: al final, checklist sí/no (cada "No" es hallazgo) y
//    "¿Amerita reparación?" con observación.
// Vehículo: del día 1 al 5 de cada mes. Limpieza: cada lunes.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react'
import { supabaseCL } from './supabaseChile'

const BUCKET = 'ca-auditorias-cl'
const NOMBRE_TIPO = { vehiculo: 'Auditoría de vehículo', limpieza: 'Auditoría de limpieza' }
const fh = (s) => s ? new Date(s).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

// Reduce la foto a 1600 px de lado mayor, en JPEG (sube rápido con poca señal)
async function comprimir(file) {
  const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(file) })
  const k = Math.min(1, 1600 / Math.max(img.width, img.height))
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  return await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82))
}
const ubicacion = () => new Promise((ok) => {
  if (!navigator.geolocation) return ok(null)
  navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => ok(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
})

function Contador({ vence, atrasada }) {
  const [ahora, setAhora] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(t) }, [])
  const ms = new Date(vence).getTime() - ahora
  if (ms <= 0 || atrasada) return <span className="au-chip rojo">Venció {fh(vence)}</span>
  const h = Math.floor(ms / 3600000), d = Math.floor(h / 24), m = Math.floor((ms % 3600000) / 60000)
  const txt = d > 0 ? `Quedan ${d} día${d > 1 ? 's' : ''} ${h % 24} h` : h > 0 ? `Quedan ${h} h ${m} min` : `Quedan ${m} min`
  return <span className={`au-chip ${h < 12 ? 'naranja' : 'azul'}`}>{txt}</span>
}

export default function Auditorias({ yo }) {
  const [filas, setFilas] = useState(null)
  const [abierta, setAbierta] = useState(null)     // { tipo, patente, auditoria_id }
  const [err, setErr] = useState('')
  const cargar = async () => {
    const { data, error } = await supabaseCL.rpc('fn_portal_cl_auditorias')
    if (error) { setErr(error.message); setFilas([]) } else setFilas(data || [])
  }
  useEffect(() => { cargar() }, [])

  if (abierta) return <HacerAuditoria a={abierta} yo={yo} onSalir={() => { setAbierta(null); cargar() }} />
  const pend = (filas || []).filter((f) => ['pendiente', 'borrador', 'rehacer'].includes(f.estado))
  const hechas = (filas || []).filter((f) => !['pendiente', 'borrador', 'rehacer'].includes(f.estado))
  const n = (fn) => (filas || []).filter(fn).length

  return (
    <div>
      <style>{CSS_AU}</style>
      <h1 className="pc-h1">Auditorías</h1>
      <div className="pc-sub">La de <b>vehículo</b> se hace del día 1 al 5 de cada mes y la de <b>limpieza</b> cada lunes. Toma las fotos con la cámara del teléfono, junto al vehículo.</div>
      {err && <div className="pc-card" style={{ background: '#FBE3E0', color: '#C43D2F' }}>{err}</div>}
      <div className="au-resumen">
        <div><b className="naranja">{n((f) => ['pendiente', 'borrador', 'rehacer'].includes(f.estado) && !f.atrasada)}</b><span>Por hacer</span></div>
        <div><b className="rojo">{n((f) => ['pendiente', 'borrador', 'rehacer'].includes(f.estado) && f.atrasada)}</b><span>Atrasadas</span></div>
        <div><b className="verde">{n((f) => !['pendiente', 'borrador', 'rehacer'].includes(f.estado))}</b><span>Hechas</span></div>
      </div>
      {filas === null ? <div className="pc-card">Cargando…</div> : (
        <>
          {pend.length > 0 && <div className="au-titulo">Por hacer</div>}
          {pend.map((f) => (
            <div key={f.tipo + f.patente} className={`au-fila${f.atrasada ? ' atrasada' : ''}`}>
              <div style={{ minWidth: 0 }}>
                <div className="au-pat">{f.patente}</div>
                <div className="pc-mini">{NOMBRE_TIPO[f.tipo]}{f.estado === 'borrador' ? ` · en curso (${f.fotos} de ${f.total} fotos)` : ''}{f.estado === 'rehacer' ? ' · hay fotos por repetir' : ''}</div>
              </div>
              <div className="au-der">
                <Contador vence={f.vence_at} atrasada={f.atrasada} />
                <button className="pc-btn" onClick={() => setAbierta(f)}>{f.estado === 'borrador' || f.estado === 'rehacer' ? 'Continuar' : 'Hacer auditoría'}</button>
              </div>
            </div>
          ))}
          {hechas.length > 0 && <div className="au-titulo">Hechas en este periodo</div>}
          {hechas.map((f) => (
            <div key={f.tipo + f.patente} className="au-fila">
              <div style={{ minWidth: 0 }}>
                <div className="au-pat">{f.patente}</div>
                <div className="pc-mini">{NOMBRE_TIPO[f.tipo]} · hecha por <b>{f.hecha_por_nombre || '—'}</b> el {fh(f.enviada_at)}{f.atrasada ? ' · fuera de plazo' : ''}</div>
              </div>
              <div className="au-der">
                <span className={`au-chip ${f.estado === 'aprobada' ? 'verde' : f.estado === 'rechazada' ? 'rojo' : 'azul'}`}>
                  {{ enviada: 'Enviada · en revisión', aprobada: 'Aprobada', revisar: 'En revisión de Bigticket', rechazada: 'Rechazada' }[f.estado] || f.estado}
                </span>
              </div>
            </div>
          ))}
          {filas.length === 0 && <div className="pc-card">No tienes vehículos activos para auditar.</div>}
        </>
      )}
    </div>
  )
}

function HacerAuditoria({ a, yo, onSalir }) {
  const [id, setId] = useState(a.auditoria_id || null)
  const [items, setItems] = useState(null)
  const [fotos, setFotos] = useState({})          // item → { path, url, biggy_estado, biggy_nota }
  const [paso, setPaso] = useState(0)
  const [km, setKm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [listo, setListo] = useState(false)
  const [check, setCheck] = useState([])          // preguntas del checklist
  const [resp, setResp] = useState({})            // codigo → true / false
  const [amerita, setAmerita] = useState(null)    // true / false / null
  const [obs, setObs] = useState('')
  const ubic = useRef(null)
  const input = useRef(null)

  useEffect(() => { (async () => {
    ubic.current = await ubicacion()
    let aid = id
    if (!aid) {
      const { data, error } = await supabaseCL.rpc('fn_portal_cl_auditoria_iniciar', { p_tipo: a.tipo, p_patente: a.patente })
      if (error) { setErr(error.message); return }
      aid = data; setId(aid)
    }
    const [it0, ft, ck] = await Promise.all([
      supabaseCL.from('ca_auditoria_items_cl').select('*').eq('tipo', a.tipo).eq('activo', true).order('orden'),
      supabaseCL.rpc('fn_portal_cl_auditoria_fotos', { p_id: aid }),
      supabaseCL.rpc('fn_portal_cl_auditoria_checklist', { p_id: aid }),
    ])
    // La foto de batería va solo en eléctricos
    const it = { data: (it0.data || []).filter((x) => !x.solo_electrico || a.electrico) }
    const preg = ck.data || []
    setCheck(preg)
    const rr = {}; for (const q of preg) if (q.cumple !== null && q.cumple !== undefined) rr[q.codigo] = q.cumple
    setResp(rr)
    if (preg[0]) { setAmerita(preg[0].amerita_reparacion ?? null); setObs(preg[0].reparacion_obs || '') }
    const m = {}
    for (const f of ft.data || []) {
      const { data: u } = await supabaseCL.storage.from(BUCKET).createSignedUrl(f.path, 3600)
      m[f.item] = { ...f, url: u?.signedUrl }
    }
    setItems(it.data || []); setFotos(m)
    const primero = (it.data || []).findIndex((x) => !m[x.codigo] || m[x.codigo].biggy_estado === 'rehacer')
    setPaso(primero < 0 ? (it.data || []).length : primero)
  })() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !items) return <div><style>{CSS_AU}</style><div className="pc-card" style={{ color: '#C43D2F' }}>{err}</div><button className="pc-btn" onClick={onSalir}>Volver</button></div>
  if (!items) return <div className="pc-card">Preparando la auditoría…</div>
  const total = items.length
  const item = items[paso]

  const tomar = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setBusy(true); setErr('')
    try {
      const blob = await comprimir(file)
      const path = `${yo.rut}/${id}/${item.codigo}_${Date.now()}.jpg`
      const up = await supabaseCL.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (up.error) throw new Error('No se pudo subir la foto: ' + up.error.message)
      if (!ubic.current) ubic.current = await ubicacion()
      const { error } = await supabaseCL.rpc('fn_portal_cl_auditoria_foto', { p_id: id, p_item: item.codigo, p_path: path, p_lat: ubic.current?.lat ?? null, p_lng: ubic.current?.lng ?? null })
      if (error) throw new Error(error.message)
      setFotos((f) => ({ ...f, [item.codigo]: { path, url: URL.createObjectURL(blob) } }))
    } catch (x) { setErr(x.message || 'No se pudo guardar la foto. Revisa tu señal e inténtalo de nuevo.') }
    finally { setBusy(false) }
  }
  const enviar = async () => {
    setErr('')
    if (a.tipo === 'vehiculo') {
      if (check.some((q) => resp[q.codigo] === undefined)) return setErr('Responde todas las preguntas del checklist.')
      if (amerita === null) return setErr('Responde si el vehículo amerita reparación.')
      if (amerita && !obs.trim()) return setErr('Escribe qué hay que reparar.')
    }
    setBusy(true)
    if (a.tipo === 'vehiculo') {
      const g = await supabaseCL.rpc('fn_portal_cl_auditoria_checklist_guardar', { p_id: id, p_respuestas: resp, p_amerita: amerita, p_obs: obs })
      if (g.error) { setBusy(false); return setErr(g.error.message) }
    }
    const { error } = await supabaseCL.rpc('fn_portal_cl_auditoria_enviar', { p_id: id, p_km: a.tipo === 'vehiculo' ? Number(String(km).replace(/\D/g, '')) || 0 : null })
    setBusy(false)
    if (error) setErr(error.message); else setListo(true)
  }

  if (listo) return (
    <div><style>{CSS_AU}</style>
      <div className="pc-card" style={{ textAlign: 'center', padding: '28px 20px' }}>
        <div style={{ fontSize: 40 }}>✅</div>
        <div className="pc-h1" style={{ fontSize: 22, marginTop: 6 }}>Auditoría enviada</div>
        <div className="pc-sub">{a.patente} · {NOMBRE_TIPO[a.tipo]}. Biggy revisa las fotos y te avisamos si hay que repetir alguna.</div>
        <button className="pc-btn" onClick={onSalir}>Volver a mis auditorías</button>
      </div>
    </div>
  )

  return (
    <div>
      <style>{CSS_AU}</style>
      <button className="au-volver" onClick={onSalir}>← Mis auditorías</button>
      <div className="au-cab">
        <div><div className="au-pat">{a.patente}</div><div className="pc-mini">{NOMBRE_TIPO[a.tipo]}</div></div>
        <Contador vence={a.vence_at} atrasada={a.atrasada} />
      </div>
      <div className="au-barra"><div style={{ width: `${Math.round(100 * Object.keys(fotos).filter((k) => items.some((i) => i.codigo === k)).length / total)}%` }} /></div>
      <div className="au-pasos">
        {items.map((it, i) => (
          <button key={it.codigo} className={`au-punto${i === paso ? ' on' : ''}${fotos[it.codigo] ? (fotos[it.codigo].biggy_estado === 'rehacer' ? ' rehacer' : ' ok') : ''}`} onClick={() => setPaso(i)} title={it.nombre}>{i + 1}</button>
        ))}
        <button className={`au-punto${paso === total ? ' on' : ''}`} onClick={() => setPaso(total)} title="Enviar">✓</button>
      </div>

      {item ? (
        <div className="pc-card">
          <div className="pc-mini">Foto {paso + 1} de {total}</div>
          <div className="au-item">{item.nombre}</div>
          <div className="au-inst">{item.instruccion}</div>
          {fotos[item.codigo]?.biggy_estado === 'rehacer' && <div className="au-rehacer"><b>Hay que repetirla:</b> {fotos[item.codigo].biggy_nota}</div>}
          {fotos[item.codigo]?.url ? <img src={fotos[item.codigo].url} alt={item.nombre} className="au-foto" /> : <div className="au-vacio">📷</div>}
          {err && <div className="au-error">{err}</div>}
          <input ref={input} type="file" accept="image/*" capture={item.codigo === 'selfie' ? 'user' : 'environment'} hidden onChange={tomar} />
          <div className="au-botones">
            <button className="pc-btn au-grande" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Guardando foto…' : fotos[item.codigo] ? '📷 Repetir foto' : '📷 Tomar foto'}
            </button>
            {fotos[item.codigo] && !busy && <button className="pc-btn au-sig" onClick={() => setPaso(paso + 1)}>Siguiente →</button>}
          </div>
        </div>
      ) : (
        <div className="pc-card">
          <div className="au-item">Revisa y envía</div>
          {a.tipo === 'vehiculo' && (
            <label className="au-km">Kilometraje del tablero
              <input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} placeholder="Ej: 45230" />
            </label>
          )}
          {a.tipo === 'vehiculo' && check.length > 0 && (
            <div className="au-check">
              <div className="au-check-tit">Checklist</div>
              {check.map((q) => (
                <div key={q.codigo} className="au-preg">
                  <span>{q.pregunta}</span>
                  <div className="au-sino">
                    <button className={resp[q.codigo] === true ? 'si' : ''} onClick={() => setResp((r) => ({ ...r, [q.codigo]: true }))}>Sí</button>
                    <button className={resp[q.codigo] === false ? 'no' : ''} onClick={() => setResp((r) => ({ ...r, [q.codigo]: false }))}>No</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {a.tipo === 'vehiculo' && (
            <div className="au-check">
              <div className="au-preg">
                <span><b>¿Amerita reparación?</b></span>
                <div className="au-sino">
                  <button className={amerita === true ? 'no' : ''} onClick={() => setAmerita(true)}>Sí</button>
                  <button className={amerita === false ? 'si' : ''} onClick={() => setAmerita(false)}>No</button>
                </div>
              </div>
              {amerita && <textarea className="au-obs" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Describe qué hay que reparar" />}
            </div>
          )}
          <div className="au-galeria">
            {items.map((it, i) => (
              <button key={it.codigo} className="au-mini" onClick={() => setPaso(i)}>
                {fotos[it.codigo]?.url ? <img src={fotos[it.codigo].url} alt="" /> : <span>Falta</span>}
                <small>{it.nombre}</small>
              </button>
            ))}
          </div>
          {err && <div className="au-error">{err}</div>}
          <button className="pc-btn au-grande" disabled={busy} onClick={enviar}>{busy ? 'Enviando…' : 'Enviar auditoría'}</button>
        </div>
      )}
    </div>
  )
}

const CSS_AU = `
.au-resumen { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:18px; }
.au-resumen div { background:#fff; border:1px solid #E4E3E3; border-radius:14px; padding:12px 14px; display:flex; flex-direction:column; }
.au-resumen b { font-family:Poppins,sans-serif; font-size:24px; }
.au-resumen span { font-size:12.5px; color:#545454; }
.au-check { border:1px solid #E4E3E3; border-radius:12px; padding:10px 12px; margin:12px 0; }
.au-check-tit { font-family:Poppins,sans-serif; font-weight:600; color:#002E5D; margin-bottom:6px; }
.au-preg { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid #F1F1F1; flex-wrap:wrap; }
.au-preg:last-child { border-bottom:none; }
.au-sino { display:flex; gap:6px; }
.au-sino button { min-width:56px; padding:8px 12px; border-radius:10px; border:1px solid #C9C9C9; background:#fff; font-weight:600; cursor:pointer; }
.au-sino button.si { background:#1A7A3C; border-color:#1A7A3C; color:#fff; }
.au-sino button.no { background:#C43D2F; border-color:#C43D2F; color:#fff; }
.au-obs { width:100%; box-sizing:border-box; margin-top:8px; padding:10px; border:1px solid #C9C9C9; border-radius:10px; font:inherit; }
.naranja { color:#FF6600; } .rojo { color:#C43D2F; } .verde { color:#1A7A3C; }
.au-titulo { font-family:Poppins,sans-serif; font-weight:700; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:#8B8B8B; margin:16px 4px 8px; }
.au-fila { background:#fff; border:1px solid #E4E3E3; border-radius:14px; padding:12px 14px; display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; flex-wrap:wrap; }
.au-fila.atrasada { border-color:#F3C4BE; background:#FFF8F7; }
.au-pat { font-family:Poppins,sans-serif; font-weight:700; font-size:17px; color:#002E5D; letter-spacing:.04em; }
.au-der { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.au-chip { font-size:12px; font-weight:700; border-radius:999px; padding:4px 10px; white-space:nowrap; }
.au-chip.azul { background:#EEF2F8; color:#002E5D; } .au-chip.naranja { background:#FFF1E6; color:#B45309; } .au-chip.rojo { background:#FBE3E0; color:#C43D2F; } .au-chip.verde { background:#E8F4EC; color:#1A7A3C; }
.au-volver { background:none; border:none; color:#002E5D; font-weight:700; cursor:pointer; padding:0; margin-bottom:12px; font-size:14px; }
.au-cab { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap; }
.au-barra { height:6px; background:#E4E3E3; border-radius:3px; overflow:hidden; margin-bottom:10px; }
.au-barra div { height:100%; background:#FF6600; transition:width .3s; }
.au-pasos { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
.au-punto { width:30px; height:30px; border-radius:50%; border:1px solid #E4E3E3; background:#fff; font-size:12px; font-weight:700; color:#8B8B8B; cursor:pointer; }
.au-punto.ok { background:#E8F4EC; border-color:#1A7A3C; color:#1A7A3C; }
.au-punto.rehacer { background:#FBE3E0; border-color:#C43D2F; color:#C43D2F; }
.au-punto.on { outline:2px solid #FF6600; outline-offset:1px; }
.au-item { font-family:Poppins,sans-serif; font-weight:700; font-size:20px; color:#002E5D; margin:2px 0 4px; }
.au-inst { color:#545454; font-size:14px; margin-bottom:12px; }
.au-rehacer { background:#FBE3E0; color:#C43D2F; border-radius:10px; padding:8px 12px; font-size:13px; margin-bottom:10px; }
.au-foto { width:100%; max-height:52vh; object-fit:contain; border-radius:12px; background:#F4F3F3; display:block; }
.au-vacio { height:200px; border:2px dashed #E4E3E3; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:48px; color:#C9C9C9; }
.au-error { background:#FBE3E0; color:#C43D2F; border-radius:10px; padding:8px 12px; font-size:13px; margin-top:10px; }
.au-botones { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
.au-grande { flex:1; padding:14px 18px; font-size:15px; min-width:180px; }
.au-sig { background:#FF6600; padding:14px 18px; font-size:15px; }
.au-km { display:flex; flex-direction:column; gap:4px; font-size:13px; color:#545454; margin:6px 0 14px; }
.au-km input { border:1px solid #E4E3E3; border-radius:10px; padding:12px; font-size:18px; font-family:inherit; }
.au-galeria { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:8px; margin-bottom:14px; }
.au-mini { border:1px solid #E4E3E3; border-radius:10px; background:#fff; padding:4px; cursor:pointer; display:flex; flex-direction:column; gap:4px; }
.au-mini img { width:100%; height:70px; object-fit:cover; border-radius:6px; }
.au-mini span { height:70px; display:flex; align-items:center; justify-content:center; background:#FBE3E0; color:#C43D2F; border-radius:6px; font-size:12px; font-weight:700; }
.au-mini small { font-size:10.5px; color:#545454; text-align:center; line-height:1.2; }
`
