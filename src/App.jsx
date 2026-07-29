import React, { useEffect, useState, useRef } from 'react'
import { supabase, BUCKET } from './supabaseClient'

// Ambiente del widget de firma MIFIEL. ⚠️ Cambiar a 'production' al salir del sandbox.
const MIFIEL_ENV = 'production'

// Centros de servicio. Por ahora fijos; más adelante se leen de la tabla que administra el Brain.
const SC_LIST = ['AMX7','ECH4','ECH5','EGD0','EGD9','EHM4','EHM5','EHP5','EHP6','ELP2','ELP3','EPB3','EQR2','ERX6','ETA4','ETG4','ETL1','ETL2','EVM2','EVR3','EZL1','SAG1','SBJ1','SCC1','SCD1','SCG1','SCH1','SCJ1','SCM1','SCN1','SCP1','SCQ1','SCT1','SCU1','SCV1','SCX1','SCY1','SDC1','SDG1','SEN1','SGD1','SGD2','SGD3','SGD4','SHM1','SHP1','SHP2','SJA1','SJD1','SLE1','SLP1','SLV1','SLW1','SLZ1','SMA1','SMD1','SML1','SMO1','SMT1','SMT2','SMT3','SMX1','SMX10','SMX2','SMX3','SMX4','SMX5','SMX6','SMX7','SMX8','SMX9','SMZ1','SNG1','SNL1','SOX1','SPB1','SPD1','SPV1','SPY1','SPZ1','SQR1','SQR2','SRX1','SSL1','STA1','STG1','STJ1','STL1','STL2','STN1','STP1','STR1','STT1','STX1','SUR1','SVH1','SVM1','SVR1','SXL1','SZC1','SZL1','SZM1','XSM11']; // 103 centros; luego se leen de la tabla del Brain

const ESTADOS_MX = [
  'AGUASCALIENTES','BAJA CALIFORNIA','BAJA CALIFORNIA SUR','CAMPECHE','CHIAPAS','CHIHUAHUA',
  'CIUDAD DE MEXICO','COAHUILA','COLIMA','DURANGO','ESTADO DE MEXICO','GUANAJUATO','GUERRERO',
  'HIDALGO','JALISCO','MICHOACAN','MORELOS','NAYARIT','NUEVO LEON','OAXACA','PUEBLA','QUERETARO',
  'QUINTANA ROO','SAN LUIS POTOSI','SINALOA','SONORA','TABASCO','TAMAULIPAS','TLAXCALA','VERACRUZ','YUCATAN','ZACATECAS',
]
const ESTADO_LABEL = { enviado:'Enviado', en_validacion:'En validación', validado:'Validado', con_alertas:'Con alertas', rechazado:'Rechazado', certificado:'Certificado' }
// Etapa del proceso (Kanban del Brain) → etiqueta y color para la empresa
const ETAPA_PORTAL = {
  recepcion:           { t: 'Recibido',                 c: '#1a3a6b', bg: '#eef2f7' },
  prevalidacion_biggy: { t: 'En pre-validación',        c: '#F47B20', bg: '#fff4ec' },
  validacion_meli:     { t: 'Validación MELI',          c: '#1a3a6b', bg: '#eef2f7' },
  validacion_nubarium: { t: 'Validación oficial',       c: '#1a3a6b', bg: '#eef2f7' },
  firma_contrato:      { t: 'Firma de contrato',        c: '#7c3aed', bg: '#f5f0fe' },
  aceptado:            { t: 'Certificado ✓',            c: '#166534', bg: '#e8f5ec' },
  rechazado:           { t: 'Rechazado',                c: '#c0392b', bg: '#fbeaea' },
}
const TIPO_LABEL = { conductor:'Conductor', ayudante:'Ayudante', vehiculo:'Vehículo' }

// ─── Definir nueva contraseña (llegada desde el correo de restablecimiento) ───
function DefinirPassword({ onListo }) {
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  const guardar = async () => {
    setErr('')
    if (p1.length < 8) { setErr('La contraseña debe tener al menos 8 caracteres.'); return }
    if (p1 !== p2) { setErr('Las contraseñas no coinciden.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: p1 })
    setBusy(false)
    if (error) { setErr('No se pudo guardar: ' + error.message); return }
    setOk(true)
  }

  return (
    <div className="login-form-side" style={{ minHeight: '100vh' }}>
      <div className="login-card">
        <h1>Define tu contraseña</h1>
        <p className="login-sub">Crea la contraseña con la que entrarás al portal de tu empresa.</p>
        {ok ? (
          <>
            <div style={{ background: '#e8f5ec', border: '1px solid #b7e0c2', color: '#166534', borderRadius: 10, padding: '12px 14px', fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
              ✅ Contraseña guardada. Ya puedes usar el portal.
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={onListo}>Ir al portal</button>
          </>
        ) : (
          <>
            {err && <div className="form-error" style={{ marginBottom: 12 }}>{err}</div>}
            <div className="field"><label>Nueva contraseña</label>
              <input type="password" value={p1} onChange={e => setP1(e.target.value)} placeholder="Mínimo 8 caracteres" /></div>
            <div className="field"><label>Repite la contraseña</label>
              <input type="password" value={p2} onChange={e => setP2(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') guardar() }} placeholder="Debe coincidir" /></div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={guardar} disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [view, setView] = useState('home') // home | estado | conductor | ayudante | vehiculo | firma
  const [tercero, setTercero] = useState(undefined) // undefined = cargando · null = sin empresa asociada

  // Modo recuperación: el enlace del correo llega con type=recovery en el hash.
  const [modoRecovery, setModoRecovery] = useState(
    typeof window !== 'undefined' && /type=recovery/.test(window.location.hash || '')
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s)
      if (e === 'PASSWORD_RECOVERY') setModoRecovery(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Resuelve la empresa del usuario que inició sesión (usuarios_terceros → terceros)
  useEffect(() => {
    if (!session) { setTercero(undefined); return }
    let cancel = false
    ;(async () => {
      const { data } = await supabase
        .from('usuarios_terceros')
        .select('tercero_id, terceros(nombre)')
        .eq('auth_email', session.user.email.toLowerCase())
        .maybeSingle()
      if (cancel) return
      if (!data) { setTercero(null); return }
      const t = Array.isArray(data.terceros) ? data.terceros[0] : data.terceros
      setTercero({ tercero_id: data.tercero_id, nombre: t?.nombre || 'Mi empresa' })
    })()
    return () => { cancel = true }
  }, [session])

  if (modoRecovery) return <DefinirPassword onListo={() => {
    setModoRecovery(false)
    if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname)
  }} />

  const [perfilOk, setPerfilOk] = useState(null)   // null = sin revisar aún
  const revisarPerfil = async () => {
    if (!tercero?.tercero_id) return
    const { data } = await supabase.from('perfiles_empresa').select('*').eq('tercero_id', tercero.tercero_id).maybeSingle()
    setPerfilOk(perfilCompleto(data))
  }
  useEffect(() => { if (tercero?.tercero_id) revisarPerfil() }, [tercero])

  if (!session) return <Login />
  if (tercero === undefined) return <PantallaCentro titulo="Cargando…" texto="Buscando tu empresa." />
  if (tercero === null) return (
    <PantallaCentro titulo="Cuenta sin empresa asociada"
      texto={`El correo ${session.user.email} no está vinculado a ninguna empresa. Escríbenos para activarlo.`}
      accion={<button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>Salir</button>} />
  )

  const email = session.user.email
  return (
    <Shell tercero={tercero} email={email}>
      {view === 'home' && perfilOk === false && (
        <div onClick={() => setView('perfil')} style={{ cursor: 'pointer', background: '#fff4e5', border: '1.5px solid #F47B20', borderRadius: 12, padding: '13px 16px', marginBottom: 16, fontSize: 13.5, color: '#8a4a0f', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span style={{ flex: 1, minWidth: 220 }}>Tu <b>Perfil de Empresa</b> está incompleto. Sin los datos de la cuenta de pago (banco, CLABE y su print de pantalla), <b>no se realizarán pagos a tu empresa</b>.</span>
          <span style={{ background: '#F47B20', color: '#fff', borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: 12.5 }}>Completar ahora →</span>
        </div>
      )}
      {view === 'home' && <Home onPick={setView} />}
      {view === 'estado' && <MisCertificaciones tercero={tercero} email={email} onBack={() => setView('home')} />}
      {view === 'firma' && <Firma tercero={tercero} email={email} onBack={() => setView('home')} />}
      {view === 'baja' && <SolicitudBaja tercero={tercero} email={email} onBack={() => setView('home')} />}
      {view === 'consultas' && <Consultas tercero={tercero} onBack={() => setView('home')} />}
      {view === 'docs' && <DocumentosEmpresa tercero={tercero} onBack={() => setView('home')} />}
      {view === 'flota' && <FlotaPersonal tercero={tercero} onBack={() => setView('home')} />}
      {view === 'perfil' && <PerfilEmpresa tercero={tercero} email={email} onBack={() => setView('home')} onGuardado={() => revisarPerfil()} />}
      {(view === 'conductor' || view === 'ayudante') &&
        <FormPersona tipo={view} tercero={tercero} email={email} onBack={() => setView('home')} onDone={() => setView('estado')} />}
      {view === 'vehiculo' &&
        <FormVehiculo tercero={tercero} email={email} onBack={() => setView('home')} onDone={() => setView('estado')} />}
    </Shell>
  )
}

// ── Login ────────────────────────────────────────────────────────────
function Login() {
  const [email, setEmail] = useState(''); const [pass, setPass] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function entrar() {
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass })
    if (error) setErr('Correo o contraseña incorrectos. Revisa e inténtalo de nuevo.')
    setBusy(false)
  }
  return (
    <div className="login-wrap">
      <div className="login-brand">
        <img src="/bt_logo_naranjo.png" alt="Bigticket" style={{ height: 34, width: 'auto', alignSelf: 'flex-start' }} />
        <div>
          <h1>Certifica a tus conductores, ayudantes y vehículos antes de que entren a operar.</h1>
          <p>Portal para empresas transportistas. Envía los datos y nosotros los validamos contra las fuentes oficiales.</p>
        </div>
      </div>
      <div className="login-form-side">
        <div className="login-card">
          <h2>Entrar</h2>
          <div className="sub">Accede con el correo y la contraseña de tu empresa.</div>
          {err && <div className="form-error">{err}</div>}
          <div className="field"><label>Correo</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && entrar()} placeholder="empresa@correo.com" /></div>
          <div className="field"><label>Contraseña</label>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && entrar()} placeholder="••••••••" /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={entrar} disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </div>
      </div>
    </div>
  )
}

function PantallaCentro({ titulo, texto, accion }) {
  return (
    <div className="login-form-side" style={{ minHeight: '100vh' }}>
      <div className="login-card" style={{ textAlign: 'center' }}>
        <h2>{titulo}</h2>
        <div className="sub" style={{ marginTop: 8 }}>{texto}</div>
        {accion && <div style={{ marginTop: 14 }}>{accion}</div>}
      </div>
    </div>
  )
}

// ── Shell ────────────────────────────────────────────────────────────
function Shell({ tercero, email, children }) {
  return (
    <>
      <div className="topbar">
        <div className="mark" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/bt_logo_naranjo.png" alt="Bigticket" style={{ height: 24, width: 'auto', display: 'block' }} />
          <b style={{ opacity: .9 }}>· Certificación</b>
        </div>
        <div className="who">
          <span><span className="name">{tercero.nombre}</span> · {email}</span>
          <button className="logout" onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </div>
      <div className="container">{children}</div>
    </>
  )
}

// ── Home: 4 tarjetas ─────────────────────────────────────────────────
function Home({ onPick }) {
  return (
    <>
      <div className="page-head"><div><h2>¿Qué quieres hacer?</h2>
        <div className="lede">Elige el tipo de certificación o revisa el estado de lo enviado.</div></div></div>
      <div className="type-grid">
        <button className="type-card" onClick={() => onPick('conductor')}>
          <div className="ic">🧍</div><h3>Certificar conductor</h3><p>Valida identidad (CURP, RFC, INE), antecedentes y licencia.</p></button>
        <button className="type-card" onClick={() => onPick('ayudante')}>
          <div className="ic">🧑‍🤝‍🧑</div><h3>Certificar ayudante</h3><p>Valida identidad (CURP, RFC, INE) y antecedentes de un ayudante.</p></button>
        <button className="type-card" onClick={() => onPick('vehiculo')}>
          <div className="ic">🚚</div><h3>Certificar vehículo</h3><p>Valida la placa contra REPUVE y confirma sus datos oficiales.</p></button>
        <button className="type-card" onClick={() => onPick('firma')}>
          <div className="ic">✍️</div><h3>Firma de contrato</h3><p>Firma digitalmente los contratos de tu personal certificado.</p></button>
        <button className="type-card" onClick={() => onPick('baja')}>
          <div className="ic">🚫</div><h3>Solicitud de baja</h3><p>Gestiona la baja de vehículos, personal certificado o de la empresa completa.</p></button>
        <button className="type-card" onClick={() => onPick('perfil')}>
          <div className="ic">🏢</div><h3>Perfil de Empresa</h3><p>Ficha de ingreso y datos de la cuenta de pago (obligatorio para recibir pagos).</p></button>
        <button className="type-card" onClick={() => onPick('flota')}>
          <div className="ic">🚛</div><h3>Vehículos y Personal</h3><p>Tu flota y personal vigentes en la operación: unidades y personas activas, con sus documentos.</p></button>
        <button className="type-card" onClick={() => onPick('docs')}>
          <div className="ic">🗂</div><h3>Documentos de mi empresa</h3><p>Contratos, seguros, fotos y anexos que BigTicket guarda de tu empresa.</p></button>
        <button className="type-card" onClick={() => onPick('consultas')}>
          <div className="ic">💬</div><h3>Consultas</h3><p>Escríbenos cualquier duda y te respondemos por aquí.</p></button>
        <button className="type-card estado" onClick={() => onPick('estado')}>
          <div className="ic">📋</div><h3>Estado de certificación</h3><p>Revisa el avance de cada trámite, sus documentos, y reemplaza o carga los que fueron observados.</p></button>
      </div>
    </>
  )
}

// ── Firma de contrato (MIFIEL embebido) ─────────────────────────────
function Firma({ tercero, email, onBack }) {
  const [rows, setRows] = useState(null)
  const [docsGestion, setDocsGestion] = useState(null)
  const [contratosMx, setContratosMx] = useState(null)  // contratos de transportista (pipeline de ingreso)
  const [abierto, setAbierto] = useState(null) // id (cert o doc) con el widget abierto

  // Carga el script del widget de MIFIEL una sola vez
  useEffect(() => {
    if (document.querySelector('script[data-mifiel-widget]')) return
    const s = document.createElement('script')
    s.type = 'module'
    s.src = 'https://app.mifiel.com/widget-component/index.js'
    s.setAttribute('data-mifiel-widget', '1')
    document.head.appendChild(s)
  }, [])

  async function cargar() {
    const { data } = await supabase
      .from('certificaciones')
      .select('id, tipo, etapa_kanban, contrato_enviado_at, contrato_firmado_at, mifiel_documento_id, mifiel_widget_conductor, mifiel_firmado_conductor, mifiel_firmado_bigticket, certificacion_conductor(nombre,curp)')
      .eq('tercero_id', tercero.tercero_id)
      .not('mifiel_documento_id', 'is', null)
      .order('contrato_enviado_at', { ascending: false })
    setRows(data || [])
    // Documentos del Gestionador (anexos, bajas, contratos sueltos) enviados desde el Brain
    const { data: dg } = await supabase
      .from('contratos_gestion')
      .select('id, titulo, tipo, descripcion, estado, enviado_at, firmado_at, mifiel_widget_tercero, firmado_tercero, firmado_bigticket')
      .eq('tercero_id', tercero.tercero_id)
      .in('estado', ['enviado', 'firmado'])
      .order('enviado_at', { ascending: false })
    setDocsGestion(dg || [])
    // Contrato de transportista del proceso de ingreso: vinculado por el correo
    // con el que se creó la empresa (mismo correo de acceso al portal)
    const { data: cmx } = await supabase
      .from('certificaciones_mx')
      .select('id, nombre, puesto, contrato_enviado_at, mifiel_documento_id, mifiel_widget_conductor, mifiel_firmado_conductor, mifiel_firmado_bigticket')
      .ilike('email', email || '')
      .not('mifiel_documento_id', 'is', null)
      .order('contrato_enviado_at', { ascending: false })
    setContratosMx(cmx || [])
  }
  useEffect(() => { cargar() }, [tercero])

  const ChipFirma = ({ label, listo }) => (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
      background: listo ? '#e8f5ec' : '#fff', color: listo ? '#166534' : '#7c3aed',
      border: `1px solid ${listo ? '#b7e0c2' : '#ddd0f7'}` }}>
      {listo ? '✓' : '⏳'} {label}
    </span>
  )

  async function firmaExitosa(cert) {
    // Feedback inmediato; la confirmación oficial llega por el webhook de MIFIEL al Brain
    await supabase.from('certificaciones').update({ mifiel_firmado_conductor: true }).eq('id', cert.id)
    setAbierto(null)
    cargar()
  }

  async function firmaMxExitosa(c) {
    await supabase.from('certificaciones_mx').update({ mifiel_firmado_conductor: true }).eq('id', c.id)
    setAbierto(null)
    cargar()
  }

  async function firmaGestionExitosa(doc) {
    await supabase.from('contratos_gestion').update({ firmado_tercero: true }).eq('id', doc.id)
    setAbierto(null)
    cargar()
  }

  const TIPO_DOC = { contrato: 'Contrato', anexo: 'Anexo', baja_vehiculo: 'Baja de vehículo', otro: 'Documento' }

  return (
    <>
      <button className="back-link" onClick={onBack}>← Volver</button>
      <div className="page-head"><div><h2>Firma de contrato</h2>
        <div className="lede">Contratos enviados a firma digital. Firma aquí mismo con tu e.firma (SAT), sin salir del portal.</div></div></div>
      <div className="card">
        {rows === null || docsGestion === null || contratosMx === null ? <div className="loading">Cargando…</div>
        : rows.length === 0 && docsGestion.length === 0 && contratosMx.length === 0 ? (
          <div className="empty"><h3>No tienes documentos por firmar</h3>
            <p>Cuando tu personal esté validado, o Bigticket te envíe un contrato, anexo o baja, aparecerá aquí para firmarlo digitalmente.</p></div>
        ) : (
        <>
        {contratosMx.length > 0 && (
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '.4px' }}>
            🚚 Contrato de prestación de servicios (transportista)
          </div>
        )}
        {contratosMx.map(c => {
          const puedeFirmar = !c.mifiel_firmado_conductor && c.mifiel_widget_conductor
          const key = `mx-${c.id}`
          return (
            <div key={key} style={{ border: '1px solid #e4e7ec', borderRadius: 12, padding: '14px 16px', marginBottom: 12, background: c.mifiel_firmado_conductor && c.mifiel_firmado_bigticket ? '#f6fdf8' : '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Contrato de transporte y logística de última milla</div>
                  <div style={{ fontSize: 12, color: '#777' }}>{c.nombre || '—'}
                    {c.contrato_enviado_at ? ` · enviado ${new Date(c.contrato_enviado_at).toLocaleDateString('es-MX')}` : ''}</div>
                </div>
                <ChipFirma label="Tu firma" listo={!!c.mifiel_firmado_conductor} />
                <ChipFirma label="Bigticket" listo={!!c.mifiel_firmado_bigticket} />
                {c.mifiel_firmado_conductor && c.mifiel_firmado_bigticket && <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>✅ Contrato firmado</span>}
                {puedeFirmar && (
                  <button className="btn btn-primary" onClick={() => setAbierto(abierto === key ? null : key)}>
                    {abierto === key ? 'Cerrar' : '✍️ Firmar ahora'}
                  </button>
                )}
                {c.mifiel_firmado_conductor && !c.mifiel_firmado_bigticket && (
                  <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600 }}>Esperando la firma de Bigticket</span>
                )}
              </div>
              {abierto === key && puedeFirmar && (
                <div style={{ marginTop: 12, border: '1px solid #ddd0f7', borderRadius: 10, padding: 8, minHeight: 620, background: '#fff' }}>
                  <FirmaWidget widgetId={c.mifiel_widget_conductor} onSuccess={() => firmaMxExitosa(c)} />
                </div>
              )}
            </div>
          )
        })}

        {rows.map(r => {
          const c = Array.isArray(r.certificacion_conductor) ? r.certificacion_conductor[0] : r.certificacion_conductor
          const firmado = !!r.contrato_firmado_at
          const puedeFirmar = !firmado && !r.mifiel_firmado_conductor && r.mifiel_widget_conductor
          return (
            <div key={r.id} style={{ border: '1px solid #e4e7ec', borderRadius: 12, padding: '14px 16px', marginBottom: 12, background: firmado ? '#f6fdf8' : '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{c?.nombre || 'Sin nombre'}</div>
                  <div style={{ fontSize: 12, color: '#777' }}>{TIPO_LABEL[r.tipo] || r.tipo} · {c?.curp || '—'}
                    {r.contrato_enviado_at ? ` · enviado ${new Date(r.contrato_enviado_at).toLocaleDateString('es-MX')}` : ''}</div>
                </div>
                <ChipFirma label="Tu firma" listo={!!r.mifiel_firmado_conductor || firmado} />
                <ChipFirma label="Bigticket" listo={!!r.mifiel_firmado_bigticket || firmado} />
                {firmado && <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>✅ Contrato firmado</span>}
                {puedeFirmar && (
                  <button className="btn btn-primary" onClick={() => setAbierto(abierto === r.id ? null : r.id)}>
                    {abierto === r.id ? 'Cerrar' : '✍️ Firmar ahora'}
                  </button>
                )}
                {!firmado && r.mifiel_firmado_conductor && !r.mifiel_firmado_bigticket && (
                  <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600 }}>Esperando la firma de Bigticket</span>
                )}
              </div>
              {abierto === r.id && puedeFirmar && (
                <div style={{ marginTop: 12, border: '1px solid #ddd0f7', borderRadius: 10, padding: 8, minHeight: 620, background: '#fff' }}>
                  <FirmaWidget widgetId={r.mifiel_widget_conductor} onSuccess={() => firmaExitosa(r)} />
                </div>
              )}
            </div>
          )
        })}

        {docsGestion.length > 0 && (
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', margin: '18px 0 10px', textTransform: 'uppercase', letterSpacing: '.4px' }}>
            📑 Otros documentos (anexos, bajas y más)
          </div>
        )}
        {docsGestion.map(d => {
          const firmado = d.estado === 'firmado'
          const puedeFirmar = !firmado && !d.firmado_tercero && d.mifiel_widget_tercero
          const key = `g-${d.id}`
          return (
            <div key={key} style={{ border: '1px solid #e4e7ec', borderRadius: 12, padding: '14px 16px', marginBottom: 12, background: firmado ? '#f6fdf8' : '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{d.titulo}</div>
                  <div style={{ fontSize: 12, color: '#777' }}>{TIPO_DOC[d.tipo] || 'Documento'}
                    {d.descripcion ? ` · ${d.descripcion}` : ''}
                    {d.enviado_at ? ` · enviado ${new Date(d.enviado_at).toLocaleDateString('es-MX')}` : ''}</div>
                </div>
                <ChipFirma label="Tu firma" listo={!!d.firmado_tercero || firmado} />
                <ChipFirma label="Bigticket" listo={!!d.firmado_bigticket || firmado} />
                {firmado && <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>✅ Firmado</span>}
                {puedeFirmar && (
                  <button className="btn btn-primary" onClick={() => setAbierto(abierto === key ? null : key)}>
                    {abierto === key ? 'Cerrar' : '✍️ Firmar ahora'}
                  </button>
                )}
                {!firmado && d.firmado_tercero && !d.firmado_bigticket && (
                  <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600 }}>Esperando la firma de Bigticket</span>
                )}
              </div>
              {abierto === key && puedeFirmar && (
                <div style={{ marginTop: 12, border: '1px solid #ddd0f7', borderRadius: 10, padding: 8, minHeight: 620, background: '#fff' }}>
                  <FirmaWidget widgetId={d.mifiel_widget_tercero} onSuccess={() => firmaGestionExitosa(d)} />
                </div>
              )}
            </div>
          )
        })}
        </>
        )}
      </div>
    </>
  )
}

function FirmaWidget({ widgetId, onSuccess }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ok = () => onSuccess && onSuccess()
    el.addEventListener('signSuccess', ok)
    return () => el.removeEventListener('signSuccess', ok)
  }, [widgetId])
  return <mifiel-widget ref={ref} id={widgetId} environment={MIFIEL_ENV}></mifiel-widget>
}

// ── Consultas (chat con Bigticket) ───────────────────────────────────

// ─── 🚛 Vehículos y Personal (padrón vigente de la empresa) ──────────
// Muestra flota_personal_terceros: lo que ya opera. Se alimenta por altas del
// analista en el Brain y por certificaciones que quedan Aceptadas.
function FlotaPersonal({ tercero, onBack }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { (async () => {
    const { data, error } = await supabase.from('flota_personal_terceros')
      .select('*').eq('tercero_id', tercero.tercero_id)
      .order('created_at', { ascending: false })
    if (error) { setErr('No se pudo cargar tu flota y personal: ' + error.message); setRows([]); return }
    setRows(data || [])
  })() }, [tercero])

  const verDoc = async (d) => {
    const { data, error } = await supabase.storage.from(d.bucket || 'archivador_empresas').createSignedUrl(d.storage_path, 300)
    if (error || !data?.signedUrl) { alert('No se pudo abrir el documento.'); return }
    window.open(data.signedUrl, '_blank')
  }

  const personas = (rows || []).filter(r => r.tipo !== 'vehiculo')
  const vehiculos = (rows || []).filter(r => r.tipo === 'vehiculo')

  const Item = ({ r }) => (
    <div style={{ padding: '11px 0', borderBottom: '1px solid #eef1f5', opacity: r.estado === 'baja' ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 18 }}>{r.tipo === 'vehiculo' ? '🚚' : r.tipo === 'ayudante' ? '🧰' : '🚗'}</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>
            {r.tipo === 'vehiculo'
              ? `${r.placa || '—'} · ${[r.marca, r.modelo, r.anio].filter(Boolean).join(' ')}`
              : r.nombre || '—'}
          </div>
          <div style={{ fontSize: 11.5, color: '#667085' }}>
            {r.tipo === 'vehiculo'
              ? `${r.service_center ? 'SC ' + r.service_center : 'Sin SC'}${r.vin ? ' · VIN ' + r.vin : ''}`
              : `${r.tipo === 'ayudante' ? 'Ayudante' : 'Conductor'}${r.curp ? ' · CURP ' + r.curp : ''}${r.service_center ? ' · SC ' + r.service_center : ''}`}
          </div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 12,
          background: r.estado === 'baja' ? '#fdecea' : '#e8f5ec', color: r.estado === 'baja' ? '#c0392b' : '#166534' }}>
          {r.estado === 'baja' ? 'BAJA' : 'ACTIVO'}
        </span>
      </div>
      {(r.documentos || []).length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7, paddingLeft: 28 }}>
          {r.documentos.map((d, i) => (
            <button key={i} onClick={() => verDoc(d)}
              style={{ background: '#f4f7fb', border: '1px solid #dbe3ee', color: '#0b2b55', borderRadius: 7, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              📎 {d.label || d.tipo}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <>
      <button className="back-link" onClick={onBack}>← Volver</button>
      <div className="page-head"><div><h2>Vehículos y Personal</h2>
        <div className="lede">Tu operación vigente con BigTicket: las unidades y personas activas de tu empresa. Cada certificación nueva que quede aceptada se agrega aquí automáticamente.</div></div></div>
      {err && <div className="form-error" style={{ marginBottom: 12 }}>{err}</div>}
      {rows === null ? <div className="loading">Cargando…</div>
      : rows.length === 0 ? (
        <div className="empty"><h3>Sin registros</h3><p>Aún no hay vehículos ni personal registrados para tu empresa. Cuando BigTicket cargue tu operación vigente, o cuando una certificación quede aceptada, aparecerán aquí.</p></div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#667085', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>👤 Personal ({personas.filter(p => p.estado !== 'baja').length} activos)</div>
            {personas.length === 0 ? <div style={{ fontSize: 12.5, color: '#888', padding: '8px 0' }}>Sin personal registrado.</div>
              : personas.map(r => <Item key={r.id} r={r} />)}
          </div>
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 800, color: '#667085', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>🚚 Vehículos ({vehiculos.filter(v => v.estado !== 'baja').length} activos)</div>
            {vehiculos.length === 0 ? <div style={{ fontSize: 12.5, color: '#888', padding: '8px 0' }}>Sin vehículos registrados.</div>
              : vehiculos.map(r => <Item key={r.id} r={r} />)}
          </div>
        </>
      )}
    </>
  )
}

// ─── 🗂 Documentos de mi empresa (archivador — solo lectura) ─────────
const DOCS_CAT_LABEL = { contratos:'📑 Contratos', empresa:'🏛 Documentación de empresa', seguros:'🛡 Seguros', vehiculos:'🚚 Vehículos', qr:'🔳 QR MELI', personal:'👤 Personal', anexos:'📎 Anexos', otros:'🗃 Otros' }
const docsBytes = (b) => b == null ? '—' : b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(0) + ' KB' : (b/1048576).toFixed(1) + ' MB'

function DocumentosEmpresa({ tercero, onBack }) {
  const [docs, setDocs] = useState(null)
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.from('documentos_empresa')
        .select('*')
        .eq('tercero_id', tercero.tercero_id)
        .order('created_at', { ascending: false })
      // Confidenciales (informes RHCHECK) JAMÁS se muestran al tercero.
      // Doble filtro: por marca `confidencial` y por categoría (cubre filas viejas sin la columna).
      setDocs((data || []).filter(d => d.confidencial !== true && d.categoria !== 'rhcheck'))
    })()
  }, [tercero])

  const abrir = async (d) => {
    const { data, error } = await supabase.storage.from(d.bucket || 'archivador_empresas').createSignedUrl(d.storage_path, 300)
    if (error || !data?.signedUrl) { alert('No se pudo abrir el documento. Intenta de nuevo.'); return }
    window.open(data.signedUrl, '_blank')
  }

  const cats = [...new Set((docs || []).map(d => d.categoria))]
  return (
    <>
      <button className="back-link" onClick={onBack}>← Volver</button>
      <div className="page-head"><div><h2>Documentos de mi empresa</h2>
        <div className="lede">El archivo digital que BigTicket mantiene de {tercero.nombre}: contratos, seguros, fotos de unidades y anexos.</div></div></div>
      <div className="card">
        {docs === null ? <div className="loading">Cargando documentos…</div>
        : docs.length === 0 ? <div className="empty"><h3>Sin documentos aún</h3><p>Cuando BigTicket cargue contratos, seguros o anexos de tu empresa, aparecerán aquí.</p></div>
        : cats.map(cat => (
          <div key={cat} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a6b', marginBottom: 8 }}>{DOCS_CAT_LABEL[cat] || cat}</div>
            {docs.filter(d => d.categoria === cat).map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px', borderBottom: '1px solid #f0f1f3', flexWrap: 'wrap' }}>
                <span>{/^image\//.test(d.mime_type || '') ? '🖼' : (d.mime_type || '').includes('pdf') ? '📄' : '📎'}</span>
                <span style={{ flex: 1, minWidth: 160, fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.nombre_archivo}</span>
                {d.referencia && <span style={{ fontSize: 11, color: '#777', background: '#f4f5f7', borderRadius: 12, padding: '2px 8px' }}>{d.referencia}</span>}
                <span style={{ fontSize: 11.5, color: '#999', fontFamily: 'monospace' }}>{docsBytes(d.tamano_bytes)}</span>
                <span style={{ fontSize: 11.5, color: '#999' }}>{new Date(d.created_at).toLocaleDateString('es-MX')}</span>
                <button onClick={() => abrir(d)} style={{ border: '1px solid #d6def0', background: '#eef2f7', color: '#1a3a6b', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Ver</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}


// ─── 🏢 PERFIL DE EMPRESA · Ficha de Ingreso Transportes México ─────
// Identificación de la empresa + cuenta de pago con evidencia CLABE.
// Sin estos datos completos, BigTicket no puede procesar los pagos.
const PERFIL_REQUERIDOS = ['razon_social', 'rfc_razon_social', 'regimen_fiscal', 'codigo_sat', 'direccion', 'fecha_ingreso_operacion', 'representante_legal', 'rfc_representante', 'curp_representante', 'correo_contacto', 'fono_contacto', 'banco', 'titular_cuenta', 'rfc_titular', 'tipo_cuenta', 'cuenta_clabe']
// Wrapper de campo del Perfil de Empresa — DEBE vivir a nivel de módulo:
// si se define dentro del render, React lo trata como un componente nuevo en
// cada tecla, remonta el input y se pierde el foco (bug de "una letra a la vez").
const CampoPerfil = ({ label, children }) => (<div className="field"><label>{label}</label>{children}</div>)

function perfilCompleto(p) {
  if (!p) return false
  for (const k of PERFIL_REQUERIDOS) if (!String(p[k] || '').trim()) return false
  if (!/^\d{18}$/.test(String(p.cuenta_clabe || '').trim())) return false
  if (!p.evidencia_cuenta_path) return false
  return true
}

function PerfilEmpresa({ tercero, email, onBack, onGuardado }) {
  const [p, setP] = useState(null)        // datos del perfil (editables)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [intento, setIntento] = useState(false)   // ya intentó guardar → marcar faltantes en rojo
  const fileRef = useRef(null)
  const S = (k, v) => setP(prev => ({ ...prev, [k]: v }))
  const rojo = (k) => intento && !String(p?.[k] || '').trim() ? { borderColor: '#e74c3c', background: '#fff5f5' } : {}

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.from('perfiles_empresa').select('*').eq('tercero_id', tercero.tercero_id).maybeSingle()
      setP(data || { razon_social: tercero.nombre || '', correo_contacto: email || '' })
      setCargando(false)
    })()
  }, [tercero])

  const subirEvidencia = async (ev) => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!file) return
    setSubiendo(true)
    try {
      const path = `${tercero.tercero_id}/perfil/evidencia_cuenta_${Date.now()}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`
      const { error } = await supabase.storage.from('archivador_empresas').upload(path, file, { upsert: true })
      if (error) throw new Error(error.message)
      S('evidencia_cuenta_path', path)
    } catch (e) { alert('No se pudo subir la imagen: ' + e.message) }
    finally { setSubiendo(false) }
  }

  const guardar = async () => {
    setIntento(true)
    const falta = []
    const ETQ = { razon_social: 'Razón social', rfc_razon_social: 'RFC razón social', regimen_fiscal: 'Régimen fiscal', codigo_sat: 'Código SAT', direccion: 'Dirección', fecha_ingreso_operacion: 'Fecha ingreso operación', representante_legal: 'Representante legal', rfc_representante: 'RFC representante legal', curp_representante: 'CURP representante legal', correo_contacto: 'Correo contacto', fono_contacto: 'Teléfono contacto', banco: 'Banco', titular_cuenta: 'Titular de la cuenta', rfc_titular: 'RFC del titular', tipo_cuenta: 'Tipo de cuenta', cuenta_clabe: 'CLABE' }
    for (const k of PERFIL_REQUERIDOS) if (!String(p[k] || '').trim()) falta.push(ETQ[k] || k)
    if (String(p.cuenta_clabe || '').trim() && !/^\d{18}$/.test(String(p.cuenta_clabe).trim())) falta.push('CLABE válida (18 dígitos)')
    if (!p.evidencia_cuenta_path) falta.push('Print de pantalla del banco con la CLABE')
    if (falta.length) {
      alert('⚠️ No se puede guardar: todos los campos son obligatorios.\n\nFalta completar:\n\n• ' + falta.join('\n• ') + '\n\nLos campos faltantes quedaron marcados en rojo. Sin el perfil completo, BigTicket no podrá procesar tus pagos.')
      return
    }
    setGuardando(true)
    try {
      const fila = { ...p, tercero_id: tercero.tercero_id, actualizado_por: email || '', updated_at: new Date().toISOString() }
      delete fila.id; delete fila.created_at
      if (!fila.fecha_ingreso_operacion) fila.fecha_ingreso_operacion = null
      const { error } = await supabase.from('perfiles_empresa').upsert(fila, { onConflict: 'tercero_id' })
      if (error) throw new Error(error.message)
      alert('✅ Perfil de Empresa completo y guardado.')
      if (onGuardado) onGuardado()
    } catch (e) { alert('No se pudo guardar: ' + e.message) }
    finally { setGuardando(false) }
  }

  if (cargando || !p) return (<><button className="back-link" onClick={onBack}>← Volver</button><div className="loading">Cargando perfil…</div></>)
  const completo = perfilCompleto(p)
  const inp = (k, extra = {}) => ({ value: p[k] || '', onChange: e => S(k, e.target.value), ...extra })
  const F = CampoPerfil   // referencia estable — no recrear componentes dentro del render

  return (
    <>
      <button className="back-link" onClick={onBack}>← Volver</button>
      <div className="page-head"><div><h2>🏢 Perfil de Empresa</h2>
        <div className="lede">Ficha de ingreso de {tercero.nombre}. Estos datos —en especial la cuenta de pago— son los que BigTicket usa para procesar tus pagos.</div></div></div>

      {!completo && (
        <div style={{ background: '#fff4e5', border: '1.5px solid #F47B20', borderRadius: 12, padding: '12px 16px', marginBottom: 14, fontSize: 13.5, color: '#8a4a0f', fontWeight: 600 }}>
          ⚠️ Tu perfil está incompleto. <b>Sin los datos de pago completos (incluido el print de la CLABE), no se realizarán pagos a tu empresa.</b>
        </div>
      )}
      {completo && (
        <div style={{ background: '#e8f5ec', border: '1px solid #b7e0c2', borderRadius: 12, padding: '12px 16px', marginBottom: 14, fontSize: 13.5, color: '#166534', fontWeight: 600 }}>
          ✅ Perfil completo — tus datos de pago están listos.
        </div>
      )}

      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a6b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.4px', paddingLeft: 8 }}>Identificación empresa transporte</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <F label="Razón social *"><input {...inp('razon_social', { style: rojo('razon_social') })} /></F>
          <F label="RFC razón social *"><input {...inp('rfc_razon_social', { style: { fontFamily: 'monospace', textTransform: 'uppercase', ...rojo('rfc_razon_social') } })} /></F>
          <F label="Régimen fiscal *"><input {...inp('regimen_fiscal', { style: rojo('regimen_fiscal') })} placeholder="Ej. 601 General de Ley PM" /></F>
          <F label="Código SAT *"><input {...inp('codigo_sat', { style: rojo('codigo_sat') })} /></F>
          <F label="Fecha ingreso operación *"><input type="date" {...inp('fecha_ingreso_operacion', { style: rojo('fecha_ingreso_operacion') })} /></F>
          <F label="Representante legal *"><input {...inp('representante_legal', { style: rojo('representante_legal') })} /></F>
          <F label="RFC representante legal *"><input {...inp('rfc_representante', { style: { fontFamily: 'monospace', textTransform: 'uppercase', ...rojo('rfc_representante') } })} /></F>
          <F label="CURP representante legal *"><input {...inp('curp_representante', { style: { fontFamily: 'monospace', textTransform: 'uppercase', ...rojo('curp_representante') } })} /></F>
          <F label="Correo contacto *"><input {...inp('correo_contacto', { style: rojo('correo_contacto') })} inputMode="email" /></F>
          <F label="Teléfono contacto *"><input {...inp('fono_contacto', { style: rojo('fono_contacto') })} inputMode="tel" /></F>
        </div>
        <div className="field" style={{ marginTop: 12 }}><label>Dirección de la empresa *</label>
          <input {...inp('direccion', { style: rojo('direccion') })} placeholder="Calle, número, colonia, municipio, CP, estado" /></div>
      </div>

      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a6b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.4px', paddingLeft: 8 }}>Identificación cuenta de pago</div>
        <div style={{ fontSize: 12, color: '#8a4a0f', fontStyle: 'italic', marginBottom: 12, paddingLeft: 8 }}>
          La cuenta bancaria debe estar a nombre de la empresa o del Representante Legal.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <F label="Banco *"><input {...inp('banco', { style: rojo('banco') })} placeholder="Ej. BBVA, Banorte" /></F>
          <F label="Titular de la cuenta *"><input {...inp('titular_cuenta', { style: rojo('titular_cuenta') })} /></F>
          <F label="RFC del titular *"><input {...inp('rfc_titular', { style: { fontFamily: 'monospace', textTransform: 'uppercase', ...rojo('rfc_titular') } })} /></F>
          <F label="Tipo de cuenta *">
            <select value={p.tipo_cuenta || ''} onChange={e => S('tipo_cuenta', e.target.value)} style={rojo('tipo_cuenta')}>
              <option value="">— Selecciona —</option><option>Cheques</option><option>Débito</option><option>Cuenta CLABE / concentradora</option>
            </select></F>
          <F label="Cuenta CLABE * (18 dígitos)">
            <input value={p.cuenta_clabe || ''} onChange={e => S('cuenta_clabe', e.target.value.replace(/[^0-9]/g, '').slice(0, 18))}
              inputMode="numeric" placeholder="18 dígitos" style={{ fontFamily: 'monospace', letterSpacing: '.1em',
                ...rojo('cuenta_clabe'),
                borderColor: (intento && !p.cuenta_clabe) || (p.cuenta_clabe && !/^\d{18}$/.test(p.cuenta_clabe)) ? '#e74c3c' : undefined }} />
            {p.cuenta_clabe && !/^\d{18}$/.test(p.cuenta_clabe) && <div style={{ fontSize: 11, color: '#e74c3c', marginTop: 3 }}>La CLABE debe tener exactamente 18 dígitos ({p.cuenta_clabe.length}/18)</div>}
          </F>
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 6 }}>Print de pantalla del banco donde se vea el banco y la CLABE *</label>
          <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={subirEvidencia} />
          {p.evidencia_cuenta_path ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#166534', background: '#e8f5ec', border: '1px solid #b7e0c2', borderRadius: 20, padding: '6px 14px' }}>✓ Evidencia cargada</span>
              <button className="btn" onClick={async () => {
                const { data } = await supabase.storage.from('archivador_empresas').createSignedUrl(p.evidencia_cuenta_path, 300)
                if (data?.signedUrl) window.open(data.signedUrl, '_blank')
              }}>Ver</button>
              <button className="btn" onClick={() => fileRef.current && fileRef.current.click()} disabled={subiendo}>{subiendo ? 'Subiendo…' : 'Reemplazar'}</button>
            </div>
          ) : (
            <button onClick={() => fileRef.current && fileRef.current.click()} disabled={subiendo}
              style={{ width: '100%', border: intento && !p.evidencia_cuenta_path ? '2px dashed #e74c3c' : '2px dashed #F47B20', background: intento && !p.evidencia_cuenta_path ? '#fff5f5' : '#fff8f2', color: intento && !p.evidencia_cuenta_path ? '#c0392b' : '#c05e10', fontWeight: 700, fontSize: 13, borderRadius: 12, padding: 16, cursor: 'pointer' }}>
              {subiendo ? 'Subiendo…' : '📸 Subir print de pantalla (banco + CLABE visibles)'}
            </button>
          )}
        </div>
      </div>

      <button className="btn btn-primary" onClick={guardar} disabled={guardando} style={{ width: '100%', padding: '14px', fontSize: 15 }}>
        {guardando ? 'Guardando…' : '💾 Guardar Perfil de Empresa'}
      </button>
    </>
  )
}


// ─── 📋 Mis certificaciones en curso: etapa + documentos con resubida ───
const MISCERT_ETAPAS = {
  recepcion: 'Recepción documental', prevalidacion_biggy: 'Pre-validación Biggy',
  validacion_meli: 'Validación Mercado Libre', validacion_repuve: 'Validación REPUVE',
  validacion_nubarium: 'Validación Nubarium', aceptado: '✅ Aceptado', rechazado: '❌ Rechazado',
}
const MISCERT_ORDEN_PERSONA = ['recepcion', 'prevalidacion_biggy', 'validacion_meli', 'validacion_nubarium']
const MISCERT_ORDEN_VEHICULO = ['recepcion', 'prevalidacion_biggy', 'validacion_nubarium']
// Tarjetas creadas sin etapa_kanban (null) → se infiere del estado, igual que el Brain.
const MISCERT_ETAPA_DE = (cert) => cert.etapa_kanban
  || ({ enviado: 'recepcion', en_validacion: 'validacion_meli', validado: 'aceptado', con_alertas: 'aceptado', certificado: 'aceptado', rechazado: 'rechazado' }[cert.estado])
  || 'recepcion'
// Tipos REALES usados por FormPersona/FormVehiculo (deben coincidir para que el Brain y Biggy los encuentren)
const MISCERT_TIPOS_DOC = ['ine', 'ine_reverso', 'curp', 'rfc', 'licencia', 'foto_frente', 'foto_trasera', 'foto_lado_izq', 'foto_lado_der', 'tarjeta_circulacion', 'poliza_seguro', 'otro']
const MISCERT_DOC_LABEL = {
  ine: 'INE — frente', ine_reverso: 'INE — reverso', curp: 'CURP', rfc: 'RFC', licencia: 'Licencia',
  foto_frente: 'Foto — frente', foto_trasera: 'Foto — trasera', foto_lado_izq: 'Foto — lado izquierdo',
  foto_lado_der: 'Foto — lado derecho', tarjeta_circulacion: 'Tarjeta de circulación', poliza_seguro: 'Póliza de seguro', otro: 'Otro',
}
// Documentos antiguos quedaron con sufijo _timestamp en el tipo — se limpia solo para mostrar.
const docTipoLimpio = (t) => String(t || '').replace(/_\d{10,}$/, '')
const docEtiqueta = (t) => MISCERT_DOC_LABEL[docTipoLimpio(t)] || docTipoLimpio(t).replace(/_/g, ' ')
const fmtFechaHora = (x) => x ? new Date(x).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

function MisCertificaciones({ tercero, email, onBack }) {
  const [rows, setRows] = useState(null)
  const [docsPor, setDocsPor] = useState({})     // certId → docs[]
  const [abierta, setAbierta] = useState(null)
  const [busyDoc, setBusyDoc] = useState(null)
  const [nuevoTipo, setNuevoTipo] = useState('otro')
  const fileNuevoRef = useRef(null)
  const fileReemRef = useRef(null)
  const reemDocRef = useRef(null)

  const [obsPor, setObsPor] = useState({})       // certId → observaciones del equipo BT
  const [errCarga, setErrCarga] = useState('')
  const cargar = async () => {
    setErrCarga('')
    // Con reintento: si certificaciones aún no tiene cambios_prospecto, se pide sin ella
    let { data, error } = await supabase
      .from('certificaciones')
      .select('id, tipo, estado, etapa_kanban, service_center, created_at, cambios_prospecto, certificacion_conductor(nombre,curp), certificacion_vehiculo(placa,marca,modelo)')
      .eq('tercero_id', tercero.tercero_id)
      .order('created_at', { ascending: false })
    if (error) {
      ({ data, error } = await supabase
        .from('certificaciones')
        .select('id, tipo, estado, etapa_kanban, service_center, created_at, certificacion_conductor(nombre,curp), certificacion_vehiculo(placa,marca,modelo)')
        .eq('tercero_id', tercero.tercero_id)
        .order('created_at', { ascending: false }))
    }
    if (error) { setErrCarga('No se pudieron cargar tus certificaciones: ' + error.message); setRows([]); return }
    const norm = (x) => Array.isArray(x) ? x[0] : x
    const ids = (data || []).map(r => r.id)
    if (ids.length) {
      const { data: obs } = await supabase.from('notificaciones_terceros')
        .select('registro_id, items, created_at')
        .eq('fuente', 'certificaciones').in('registro_id', ids)
        .order('created_at', { ascending: false })
      const mapa = {}
      ;(obs || []).forEach(o => { if (!mapa[o.registro_id]) mapa[o.registro_id] = o })
      setObsPor(mapa)
    }
    setRows((data || []).map(r => ({
      ...r,
      titulo: r.tipo === 'vehiculo'
        ? `🚚 ${norm(r.certificacion_vehiculo)?.placa || 'Vehículo'} · ${[norm(r.certificacion_vehiculo)?.marca, norm(r.certificacion_vehiculo)?.modelo].filter(Boolean).join(' ')}`
        : `${r.tipo === 'ayudante' ? '🧍 Ayudante' : '👤 Conductor'} · ${norm(r.certificacion_conductor)?.nombre || 'Sin nombre'}`,
    })))
  }
  useEffect(() => { cargar() }, [tercero])

  const cargarDocs = async (certId) => {
    const { data, error } = await supabase.from('certificacion_documentos')
      .select('*').eq('certificacion_id', certId) // sin .order: la tabla puede no tener created_at
    if (error) console.warn('lectura certificacion_documentos:', error.message)
    const rows = [...(data || [])].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    setDocsPor(p => ({ ...p, [certId]: rows }))
  }
  const abrir = (id) => { const nx = abierta === id ? null : id; setAbierta(nx); if (nx && !docsPor[nx]) cargarDocs(nx) }

  const registrarCambio = async (cert, entrada) => {
    const log = [...(cert.cambios_prospecto || []), { ...entrada, at: new Date().toISOString(), por: email || '' }]
    await supabase.from('certificaciones').update({ cambios_prospecto: log, cambios_pendientes: true }).eq('id', cert.id)
    setRows(rs => rs.map(r => r.id === cert.id ? { ...r, cambios_prospecto: log } : r))
  }

  const ver = async (d) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const reemplazar = async (cert, d, file) => {
    if (!file) return
    setBusyDoc(d.id)
    try {
      const ext = file.name.split('.').pop()
      const path = `${tercero.tercero_id}/${cert.id}/${d.tipo_documento}_${Date.now()}.${ext}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
      if (error) throw new Error(error.message)
      let { error: eUpd } = await supabase.from('certificacion_documentos')
        .update({ storage_path: path, updated_at: new Date().toISOString(), subido_por: email || null }).eq('id', d.id)
      if (eUpd) {
        console.warn('update doc (completo) falló:', eUpd.message, '— reintento minimal')
        ;({ error: eUpd } = await supabase.from('certificacion_documentos').update({ storage_path: path }).eq('id', d.id))
      }
      if (eUpd) throw new Error('El archivo subió pero no se registró: ' + eUpd.message)
      await registrarCambio(cert, { tipo: 'documento', campo: docTipoLimpio(d.tipo_documento), accion: 'reemplazado', doc_id: d.id, storage_path: path })
      await cargarDocs(cert.id)
      alert('✅ Documento reemplazado. El equipo de certificación fue notificado.')
    } catch (e) { alert('No se pudo reemplazar: ' + e.message) }
    finally { setBusyDoc(null) }
  }

  const eliminar = async (cert, d) => {
    if (!confirm(`¿Eliminar ${docEtiqueta(d.tipo_documento)}? Deberás cargar uno nuevo para continuar el proceso.`)) return
    setBusyDoc(d.id)
    try {
      // protect_delete puede bloquear el DELETE del bucket — fallback: mover a papelera/ (rename)
      const { data: rm, error: eRm } = await supabase.storage.from(BUCKET).remove([d.storage_path])
      if (eRm || !Array.isArray(rm) || rm.length === 0) {
        const { error: eMv } = await supabase.storage.from(BUCKET).move(d.storage_path, `papelera/${d.storage_path}`)
        if (eMv) throw new Error((eRm && eRm.message) || 'No se pudo retirar el archivo del almacenamiento')
      }
      await supabase.from('certificacion_documentos').delete().eq('id', d.id)
      await registrarCambio(cert, { tipo: 'documento', campo: docTipoLimpio(d.tipo_documento), accion: 'eliminado' })
      await cargarDocs(cert.id)
    } catch (e) { alert('No se pudo eliminar: ' + e.message) }
    finally { setBusyDoc(null) }
  }

  const cargarNuevo = async (cert, file) => {
    if (!file) return
    setBusyDoc('nuevo')
    try {
      // El tipo va LIMPIO a la tabla; el timestamp solo al path (evita colisiones sin ensuciar tipo_documento)
      const ext = file.name.split('.').pop()
      const path = `${tercero.tercero_id}/${cert.id}/${nuevoTipo}_${Date.now()}.${ext}`
      const { error: eUp } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
      if (eUp) throw new Error(eUp.message)
      const { data: nuevoDoc, error: eIns } = await insDocPortal({ certificacion_id: cert.id, tipo_documento: nuevoTipo, storage_path: path, subido_por: email || null })
      if (eIns) throw new Error('El archivo subió pero no se registró: ' + eIns.message)
      await registrarCambio(cert, { tipo: 'documento', campo: nuevoTipo, accion: 'cargado', doc_id: nuevoDoc?.id || null, storage_path: path })
      await cargarDocs(cert.id)
      alert('✅ Documento cargado. El equipo de certificación fue notificado.')
    } catch (e) { alert('No se pudo cargar: ' + e.message) }
    finally { setBusyDoc(null) }
  }

  return (
    <>
      <button className="back-link" onClick={onBack}>← Volver</button>
      <div className="page-head"><div><h2>📋 Estado de certificación</h2>
        <div className="lede">El avance de cada conductor, ayudante y vehículo que has enviado a validar — con sus documentos. Si algo fue observado o rechazado, reemplaza o carga los documentos aquí mismo.</div></div></div>
      {errCarga && <div className="form-error" style={{ marginBottom: 12 }}>{errCarga}</div>}
      {rows === null ? <div className="loading">Cargando…</div>
      : rows.length === 0 ? <div className="empty">No tienes certificaciones registradas.</div>
      : rows.map(cert => {
        const etapa = MISCERT_ETAPA_DE(cert)
        const orden = cert.tipo === 'vehiculo' ? MISCERT_ORDEN_VEHICULO : MISCERT_ORDEN_PERSONA
        const idx = orden.indexOf(etapa)
        const esFinal = etapa === 'aceptado' || etapa === 'rechazado'
        const docs = docsPor[cert.id]
        return (
          <div key={cert.id} style={{ border: '1px solid #e4e7ec', borderRadius: 12, padding: '14px 16px', marginBottom: 12, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{cert.titulo}</div>
                <div style={{ fontSize: 12, color: '#777' }}>{cert.service_center || '—'} · {new Date(cert.created_at).toLocaleDateString('es-MX')}</div>
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 800, borderRadius: 20, padding: '6px 14px',
                background: etapa === 'aceptado' ? '#e8f5ec' : etapa === 'rechazado' ? '#fbeaea' : '#eef2ff',
                color: etapa === 'aceptado' ? '#166534' : etapa === 'rechazado' ? '#c0392b' : '#1a3a6b',
                border: '1px solid ' + (etapa === 'aceptado' ? '#b7e0c2' : etapa === 'rechazado' ? '#f0c4c4' : '#c7d7f9') }}>
                {MISCERT_ETAPAS[etapa] || etapa}
              </span>
              <button className="btn" onClick={() => abrir(cert.id)}>{abierta === cert.id ? 'Cerrar' : '📎 Documentos'}</button>
            </div>
            {!esFinal && idx >= 0 && (
              <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
                {orden.map((e, i) => <div key={e} title={MISCERT_ETAPAS[e]} style={{ flex: 1, height: 6, borderRadius: 3, background: i <= idx ? '#F47B20' : '#e9edf3' }} />)}
              </div>
            )}
            {obsPor[cert.id] && (
              <div style={{ marginTop: 10, background: '#fff4e5', border: '1px solid #f5d9b8', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#b45309', textTransform: 'uppercase', marginBottom: 6 }}>
                  📣 Observaciones del equipo BigTicket · {new Date(obsPor[cert.id].created_at).toLocaleDateString('es-MX')}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(Array.isArray(obsPor[cert.id].items) ? obsPor[cert.id].items : []).map((it, i) => (
                    <li key={i} style={{ fontSize: 12.5, color: '#8a4a0f', marginBottom: 3 }}>{String(it)}</li>
                  ))}
                </ul>
                <div style={{ fontSize: 11.5, color: '#8a6a3f', marginTop: 6 }}>Corrige lo señalado reemplazando o cargando los documentos abajo. 👇</div>
              </div>
            )}
            {abierta === cert.id && (
              <div style={{ marginTop: 12, borderTop: '1px solid #f0f2f5', paddingTop: 10 }}>
                {!docs ? <div className="loading">Cargando documentos…</div>
                : docs.length === 0 ? <div style={{ fontSize: 12.5, color: '#888', marginBottom: 10 }}>Sin documentos cargados.</div>
                : docs.map(d => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #f5f6f8', flexWrap: 'wrap' }}>
                    <span style={{ flex: 1, minWidth: 140 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{docEtiqueta(d.tipo_documento)}</span>
                      <span style={{ display: 'block', fontSize: 11, color: '#98a2b3' }}>
                        Cargado {fmtFechaHora(d.created_at)}{d.updated_at ? ` · reemplazado ${fmtFechaHora(d.updated_at)}` : ''}
                      </span>
                    </span>
                    <button className="btn" onClick={() => ver(d)}>Ver</button>
                    <button className="btn" disabled={busyDoc === d.id}
                      onClick={() => { reemDocRef.current = { cert, d }; fileReemRef.current && fileReemRef.current.click() }}>
                      {busyDoc === d.id ? '…' : 'Reemplazar'}
                    </button>
                    <button onClick={() => eliminar(cert, d)} disabled={busyDoc === d.id}
                      style={{ background: 'none', border: 'none', color: '#c0392b', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Eliminar</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                  <select value={nuevoTipo} onChange={e => setNuevoTipo(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e4e7ec', fontSize: 12.5 }}>
                    {MISCERT_TIPOS_DOC.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                  <button className="btn btn-primary" disabled={busyDoc === 'nuevo'}
                    onClick={() => { reemDocRef.current = { cert, nuevo: true }; fileNuevoRef.current && fileNuevoRef.current.click() }}>
                    {busyDoc === 'nuevo' ? 'Subiendo…' : '📎 Cargar documento nuevo'}
                  </button>
                </div>
                {(cert.cambios_prospecto || []).length > 0 && (
                  <div style={{ marginTop: 14, background: '#f8f9fb', border: '1px solid #eef0f4', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#667085', textTransform: 'uppercase', marginBottom: 6 }}>🕓 Historial de cambios</div>
                    {[...cert.cambios_prospecto].slice(-6).reverse().map((c, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#555', padding: '3px 0' }}>
                        <b>{fmtFechaHora(c.at)}</b> · 📎 {docEtiqueta(c.campo)}: {c.accion}{c.por ? ` — ${c.por}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      <input ref={fileReemRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files[0]; e.target.value = ''; const ctx = reemDocRef.current; if (f && ctx && !ctx.nuevo) reemplazar(ctx.cert, ctx.d, f) }} />
      <input ref={fileNuevoRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files[0]; e.target.value = ''; const ctx = reemDocRef.current; if (f && ctx && ctx.nuevo) cargarNuevo(ctx.cert, f) }} />
    </>
  )
}

// ── Consultas: Preguntas frecuentes (acordeón) + chat directo ──
// Ítems y respuestas replicados del modelo de Camilo. El chat con el equipo
// (mensajes_terceros ↔ Brain) solo se abre desde "Escribir otra consulta".
const FAQ_CATEGORIAS = [
  { cat: 'Certificar conductor / ayudante', preguntas: [
    { q: '¿Cómo certifico a un conductor?',
      a: 'Entra a “Certificar conductor”, elige el centro de servicio (SC), completa los datos personales y de la licencia, y sube los documentos. Luego pulsa “Enviar a certificar”.',
      guia: { titulo: 'Certificar un conductor', pasos: [
        'Entra a “Certificar conductor” y elige el centro de servicio (SC).',
        'Completa nombre completo, CURP, RFC y teléfono.',
        'Ingresa número de licencia, estado emisor y vigencia.',
        'Sube INE (frente y reverso), CURP (PDF), RFC (PDF) y licencia.',
        'Pulsa “Enviar a certificar”.'] } },
    { q: '¿Qué documentos necesito para certificar a alguien?',
      a: 'INE frente y reverso, CURP (PDF) y RFC/Constancia (PDF). Si es conductor, además la licencia. Súbelos legibles y completos.' },
    { q: '¿Qué diferencia hay entre conductor y ayudante?',
      a: 'El conductor requiere licencia de conducir; el ayudante no. En ambos casos se valida identidad (CURP, RFC, INE) y antecedentes.' },
    { q: '¿El ayudante necesita licencia?',
      a: 'No. El ayudante no requiere licencia de conducir; solo se valida su identidad y antecedentes.' },
  ]},
  { cat: 'Certificar vehículo', preguntas: [
    { q: '¿Cómo certifico un vehículo?',
      a: 'Entra a “Certificar vehículo”, ingresa la placa (se valida contra REPUVE), confirma los datos oficiales y sube la documentación de la unidad.',
      guia: { titulo: 'Certificar un vehículo', pasos: [
        'Entra a “Certificar vehículo”.',
        'Ingresa la placa (se valida contra REPUVE).',
        'Confirma los datos oficiales de la unidad.',
        'Sube tarjeta de circulación, póliza y fotos.',
        'Pulsa “Enviar a certificar”.'] } },
    { q: '¿Qué valida REPUVE?',
      a: 'REPUVE valida el registro del vehículo y si la placa tiene reporte de robo. Por eso pedimos la placa correcta y legible.' },
    { q: '¿Hasta qué año de antigüedad aceptan?',
      a: 'No se aceptan unidades con más de 15 años de antigüedad.' },
  ]},
  { cat: 'Firma de contrato', preguntas: [
    { q: '¿Cómo firmo mi contrato?',
      a: 'En “Firma de contrato” abre el documento y fírmalo con Mifiel: puedes usar tu e.firma del SAT o verificación biométrica por cámara.',
      guia: { titulo: 'Firmar tu contrato', pasos: [
        'Entra a “Firma de contrato”.',
        'Abre el documento y toca “Firmar”.',
        'Elige e.firma del SAT o verificación biométrica (cámara).',
        'Cuando ambas firmas queden en verde, quedó firmado.'] } },
    { q: 'No tengo e.firma, ¿cómo firmo?',
      a: 'Sin problema: puedes firmar con verificación biométrica desde la cámara, sin e.firma. El sistema te guía paso a paso.' },
    { q: 'El contrato no corresponde o tiene un error.',
      a: 'Cuéntanos qué dato no corresponde. Lo revisamos, corregimos y te regeneramos el contrato para que lo firmes.' },
    { q: 'Ya firmé, ¿cuándo empiezo a operar?',
      a: 'Una vez tengas tus unidades (vehículos) y personal de alta, serás informado para tu citación en operaciones.' },
  ]},
  { cat: 'Perfil de empresa y pagos', preguntas: [
    { q: '¿Por qué debo completar el Perfil de Empresa?',
      a: 'Porque sin los datos de tu cuenta de pago (banco, CLABE y su print de pantalla) no podemos realizar pagos a tu empresa. Complétalo en “Perfil de Empresa”.',
      guia: { titulo: 'Completar tu Perfil de Empresa', pasos: [
        'Entra a “Perfil de Empresa”.',
        'Completa razón social y régimen fiscal.',
        'Ingresa banco y CLABE, y sube el print donde se vea la CLABE.',
        'Sube las fotos solicitadas; el aviso de “perfil incompleto” desaparece.'] } },
    { q: '¿Cómo cargo mi cuenta de pago / CLABE?',
      a: 'En “Perfil de Empresa” ingresa banco y CLABE, y sube un print donde se vea la CLABE. La cuenta debe estar a nombre de la empresa o del representante legal.' },
    { q: '¿A nombre de quién debe estar la cuenta?',
      a: 'A nombre de la empresa o del representante legal.' },
    { q: 'Tengo una duda sobre mi pago / prefactura.',
      a: 'Para temas de pago de prefactura, descuentos, multas, etc., favor de levantar un requerimiento en el Link enviado en el correo de su prefactura. Considere ser lo más específico posible para que el equipo de Conciliaciones pueda revisar su caso.' },
  ]},
  { cat: 'Solicitud de baja', preguntas: [
    { q: '¿Cómo doy de baja un vehículo o una persona?',
      a: 'Entra a “Solicitud de baja” y elige qué dar de baja (vehículo, personal certificado o la empresa completa). Indícanos placa o nombre y gestionamos la baja.' },
  ]},
  { cat: 'Documentos y estado', preguntas: [
    { q: '¿Dónde veo mis documentos?',
      a: 'En “Documentos de mi empresa” están los contratos, seguros, fotos y anexos que BigTicket guarda de tu empresa.' },
    { q: '¿Cómo veo el avance de mi trámite?',
      a: 'En “Estado de certificación” revisas el avance de cada trámite, sus documentos, y puedes reemplazar o cargar los que fueron observados.' },
    { q: 'Me observaron un documento, ¿cómo lo reemplazo?',
      a: 'En “Estado de certificación” ubica el documento observado y sube el corregido en el mismo lugar.',
      guia: { titulo: 'Reemplazar un documento observado', pasos: [
        'Entra a “Estado de certificación”.',
        'Ubica el documento observado.',
        'Sube el archivo corregido en el mismo lugar.',
        'El estado se actualiza al recibirlo.'] } },
  ]},
  { cat: 'Soporte y horario', preguntas: [
    { q: '¿A qué hora responden?',
      a: 'Nuestro horario de atención es de lunes a viernes, de 6:00 a 15:00 (hora de México) / 8:00 a 17:00 (hora de Chile). No atendemos fines de semana ni días feriados.' },
    { q: '¿Con quién hablo si tengo dudas?',
      a: 'Por este mismo canal te atiende el equipo de Certificaciones de BigTicket.' },
  ]},
]

function Consultas({ tercero, onBack }) {
  const [modo, setModo] = useState('faq')          // faq | chat (el chat solo se abre desde "Otros")
  const [catAbierta, setCatAbierta] = useState(0)
  const [qAbierta, setQAbierta] = useState(null)   // "ci-qi"
  const [guiaAbierta, setGuiaAbierta] = useState(null)
  const [msgs, setMsgs] = useState(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function cargar() {
    const { data } = await supabase
      .from('mensajes_terceros')
      .select('*')
      .eq('tercero_id', tercero.tercero_id)
      .order('created_at', { ascending: true })
    setMsgs(data || [])
  }
  useEffect(() => { cargar() }, [tercero])

  async function enviar() {
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true)
    setTexto('')
    const { data, error } = await supabase
      .from('mensajes_terceros')
      .insert({ tercero_id: tercero.tercero_id, autor: 'tercero', mensaje: t })
      .select('*').single()
    if (error) { alert('No se pudo enviar: ' + error.message); setTexto(t) }
    else setMsgs(prev => [...(prev || []), data])
    setEnviando(false)
  }

  // ── Vista FAQ (acordeón de categorías → pregunta → respuesta inline) ──
  if (modo === 'faq') return (
    <>
      <button className="back-link" onClick={onBack}>← Volver</button>
      <div className="page-head"><div><h2>Consultas</h2>
        <div className="lede">Revisa las preguntas frecuentes — la mayoría de las dudas se resuelven al instante. Si no encuentras la tuya, escríbenos en “Otros”.</div></div></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ background: '#0b2b55', color: '#fff', padding: '12px 18px', fontWeight: 700, fontSize: 14 }}>Preguntas frecuentes</div>
        {FAQ_CATEGORIAS.map((c, ci) => (
          <div key={ci} style={{ borderBottom: '1px solid #e9edf3' }}>
            <button onClick={() => { setCatAbierta(catAbierta === ci ? null : ci); setQAbierta(null); setGuiaAbierta(null) }}
              style={{ width: '100%', textAlign: 'left', background: catAbierta === ci ? '#f5f8fc' : '#fff', border: 'none', padding: '13px 18px', fontSize: 13.5, fontWeight: 700, color: '#0b2b55', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: "'Geist',sans-serif" }}>
              <span>{c.cat}</span>
              <span style={{ color: '#FF6600', fontSize: 12, transform: catAbierta === ci ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}>▶</span>
            </button>
            {catAbierta === ci && (
              <div style={{ padding: '0 14px 12px' }}>
                {c.preguntas.map((p, qi) => {
                  const key = ci + '-' + qi
                  const abierta = qAbierta === key
                  return (
                    <div key={qi} style={{ marginBottom: 6 }}>
                      <button onClick={() => { setQAbierta(abierta ? null : key); setGuiaAbierta(null) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', background: abierta ? '#fff4ee' : '#f4f7fb', border: '1px solid ' + (abierta ? '#F47B20' : '#e3e8f0'), color: '#33425a', borderRadius: 9, padding: '9px 12px', fontSize: 12.5, lineHeight: 1.4, cursor: 'pointer', fontWeight: abierta ? 700 : 500, fontFamily: "'Geist',sans-serif" }}>
                        {p.q}
                      </button>
                      {abierta && (
                        <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderTop: 'none', borderRadius: '0 0 9px 9px', padding: '10px 14px', fontSize: 12.5, color: '#28323f', lineHeight: 1.6 }}>
                          <div style={{ fontSize: 10.5, fontWeight: 800, color: '#FF6600', marginBottom: 4 }}>Bigticket</div>
                          {p.a}
                          {p.guia && (
                            <>
                              <button onClick={() => setGuiaAbierta(guiaAbierta === key ? null : key)}
                                style={{ display: 'inline-block', marginTop: 8, fontSize: 11.5, fontWeight: 700, color: '#0b2b55', background: '#fff', border: '1px solid #e3e8f0', borderRadius: 8, padding: '5px 9px', cursor: 'pointer', fontFamily: "'Geist',sans-serif" }}>
                                <span style={{ color: '#FF6600' }}>▶ </span>Ver guía: {p.guia.titulo}
                              </button>
                              {guiaAbierta === key && (
                                <ol style={{ margin: '8px 0 2px', padding: '8px 12px 8px 26px', fontSize: 12, lineHeight: 1.55, color: '#33425a', background: '#f8fafc', border: '1px solid #e3e8f0', borderRadius: 9 }}>
                                  {p.guia.pasos.map((s, si) => <li key={si} style={{ marginBottom: 3 }}>{s}</li>)}
                                </ol>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
        {/* Otros → abre el chat directo con el equipo */}
        <div style={{ padding: 14 }}>
          <button onClick={() => setModo('chat')}
            style={{ display: 'block', width: '100%', textAlign: 'left', background: '#eaf1fb', border: '1px solid #cdddf3', color: '#0b2b55', borderRadius: 9, padding: '11px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Geist',sans-serif" }}>
            💬 Otros — Escribir otra consulta al equipo BigTicket
            {Array.isArray(msgs) && msgs.length > 0 && (
              <span style={{ float: 'right', fontSize: 11, fontWeight: 800, color: '#FF6600' }}>{msgs.length} mensaje{msgs.length === 1 ? '' : 's'} en tu hilo →</span>
            )}
          </button>
        </div>
      </div>
    </>
  )

  // ── Vista chat directo (la consola existente, tal cual) ──
  return (
    <>
      <button className="back-link" onClick={() => setModo('faq')}>← Preguntas frecuentes</button>
      <div className="page-head"><div><h2>Consultas</h2>
        <div className="lede">Escríbenos cualquier duda sobre tus certificaciones, pagos o documentos. El equipo de Bigticket te responde por aquí.</div></div></div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 420 }}>
        <div style={{ flex: 1, overflowY: 'auto', maxHeight: 460, paddingBottom: 8 }}>
          {msgs === null ? <div className="loading">Cargando…</div>
          : msgs.length === 0 ? (
            <div className="empty"><h3>Sin mensajes</h3><p>Escribe tu primera consulta abajo y te responderemos a la brevedad.</p></div>
          ) : msgs.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: m.autor === 'tercero' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div style={{ maxWidth: '75%', padding: '9px 13px', borderRadius: 12, fontSize: 13, lineHeight: 1.5,
                background: m.autor === 'tercero' ? '#0b2b55' : '#f0f2f5',
                color: m.autor === 'tercero' ? '#fff' : '#222',
                borderBottomRightRadius: m.autor === 'tercero' ? 4 : 12,
                borderBottomLeftRadius: m.autor === 'tercero' ? 12 : 4 }}>
                {m.autor !== 'tercero' && <div style={{ fontSize: 10, fontWeight: 700, color: '#FF6600', marginBottom: 2 }}>Bigticket</div>}
                {m.mensaje}
                <div style={{ fontSize: 9, opacity: .6, marginTop: 4, textAlign: 'right' }}>
                  {new Date(m.created_at).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid #e4e7ec' }}>
          <input value={texto} onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
            placeholder="Escribe tu consulta…"
            style={{ flex: 1, background: '#f8f9fa', border: '1px solid #d0d5dd', borderRadius: 10, padding: '11px 12px', fontSize: 14 }} />
          <button className="btn btn-primary" onClick={enviar} disabled={!texto.trim() || enviando}>
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Solicitud de baja (vehículo / personal / empresa) ───────────────
const MOTIVOS_BAJA = {
  vehiculo: ['Venta del vehículo', 'Siniestro / pérdida total', 'Fin de contrato con el propietario', 'Falla mecánica permanente', 'Documentación vencida sin renovación', 'Otro'],
  personal: ['Renuncia voluntaria', 'Término de la relación laboral', 'Rechazo en revalidación de antecedentes', 'Cambio de empresa transportista', 'Otro'],
  empresa:  ['Término de relación comercial', 'Cierre de operaciones de la empresa', 'Incumplimiento contractual', 'Otro'],
}
const ESTADO_SOLICITUD = {
  en_revision: { t: 'En revisión BigTicket', c: '#F47B20', bg: '#fff4ec' },
  en_proceso:  { t: 'En proceso',            c: '#1a3a6b', bg: '#eef2f7' },
  completada:  { t: 'Completada ✓',          c: '#166534', bg: '#e8f5ec' },
  rechazada:   { t: 'Rechazada',             c: '#c0392b', bg: '#fbeaea' },
}

function SolicitudBaja({ tercero, email, onBack }) {
  const [tipo, setTipo] = useState(null)          // vehiculo | personal | empresa
  const [vehiculos, setVehiculos] = useState(null)
  const [personal, setPersonal] = useState(null)
  const [selIds, setSelIds] = useState([])
  const [chkEmpresa, setChkEmpresa] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [detalle, setDetalle] = useState('')
  const [fecha, setFecha] = useState('')
  const [busy, setBusy] = useState(false)
  const [okData, setOkData] = useState(null)
  const [rows, setRows] = useState(null)

  useEffect(() => {
    (async () => {
      // Fuente: el PADRÓN (todo lo que opera — certificados Y altas directas
      // del analista). Solo activos: lo dado de baja no se vuelve a solicitar.
      const { data } = await supabase
        .from('flota_personal_terceros')
        .select('id, tipo, estado, origen, service_center, placa, marca, nombre, curp, certificacion_id')
        .eq('tercero_id', tercero.tercero_id)
        .eq('estado', 'activo')
      const all = data || []
      setVehiculos(all.filter(r => r.tipo === 'vehiculo').map(r => ({
        id: r.id, certificacion_id: r.certificacion_id || null,
        placa: r.placa || 'Sin placa', marca: r.marca || '',
        sc: r.service_center || '—', origen: r.origen,
      })))
      setPersonal(all.filter(r => r.tipo !== 'vehiculo').map(r => ({
        id: r.id, certificacion_id: r.certificacion_id || null,
        nombre: r.nombre || 'Sin nombre', curp: r.curp || '',
        rol: r.tipo === 'ayudante' ? 'Ayudante' : 'Conductor',
        sc: r.service_center || '—', origen: r.origen,
      })))
    })()
    cargarSolicitudes()
  }, [tercero])

  async function cargarSolicitudes() {
    const { data } = await supabase
      .from('solicitudes_baja').select('*')
      .eq('tercero_id', tercero.tercero_id)
      .order('created_at', { ascending: false })
    setRows(data || [])
  }

  const elegirTipo = (t) => { setTipo(t); setSelIds([]); setChkEmpresa(false); setMotivo(''); setDetalle('') }
  const toggleSel = (id) => { if (idsEnCurso.has(id)) return; setSelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]) }

  const motivoOk = motivo !== '' && (motivo !== 'Otro' || detalle.trim() !== '')

  // Bloqueo de duplicados: cada vehículo/persona con solicitud en curso
  // (en revisión o en proceso) no puede volver a solicitarse hasta resolverse.
  const enCurso = (rows || []).filter(r => ['en_revision', 'en_proceso'].includes(r.estado))
  const idsEnCurso = new Set(enCurso.flatMap(r => Array.isArray(r.seleccion) ? r.seleccion.flatMap(x => [x.padron_id, x.certificacion_id].filter(Boolean)) : []))
  const folioDe = (id) => enCurso.find(r => Array.isArray(r.seleccion) && r.seleccion.some(x => x.padron_id === id || x.certificacion_id === id))?.folio
  const empresaEnCurso = enCurso.find(r => r.tipo === 'empresa')

  const listo = tipo && motivoOk && (tipo === 'empresa' ? (chkEmpresa && !empresaEnCurso) : selIds.length > 0)

  async function enviar() {
    if (!listo || busy) return
    if (tipo !== 'empresa' && selIds.some(id => idsEnCurso.has(id))) { alert('Alguno de los seleccionados ya tiene una solicitud en curso.'); return }
    setBusy(true)
    try {
      let seleccion, itemsTxt
      if (tipo === 'vehiculo') {
        const sel = vehiculos.filter(v => selIds.includes(v.id))
        seleccion = sel.map(v => ({ padron_id: v.id, certificacion_id: v.certificacion_id, placa: v.placa, sc: v.sc }))
        itemsTxt = sel.map(v => v.placa).join(', ')
      } else if (tipo === 'personal') {
        const sel = personal.filter(p => selIds.includes(p.id))
        seleccion = sel.map(p => ({ padron_id: p.id, certificacion_id: p.certificacion_id, nombre: p.nombre, curp: p.curp, rol: p.rol, sc: p.sc }))
        itemsTxt = sel.map(p => p.nombre).join(', ')
      } else {
        seleccion = { empresa: tercero.nombre, vehiculos: (vehiculos || []).length, personal: (personal || []).length }
        itemsTxt = `${tercero.nombre} (incluye ${(vehiculos || []).length} vehículos y ${(personal || []).length} personas)`
      }
      const { data, error } = await supabase.from('solicitudes_baja').insert({
        tercero_id: tercero.tercero_id, tipo, seleccion, motivo,
        detalle: detalle.trim() || null, fecha_efectiva: fecha || null, enviado_por: email,
      }).select('folio').single()
      if (error) throw new Error(error.message)
      // Aviso automático al equipo por el canal de consultas
      const tipoTxt = tipo === 'vehiculo' ? 'Baja de vehículo' : tipo === 'personal' ? 'Baja de personal' : 'Baja de empresa'
      await supabase.from('mensajes_terceros').insert({
        tercero_id: tercero.tercero_id, autor: 'tercero',
        mensaje: `📤 ${tipoTxt} — Folio ${data.folio}. ${itemsTxt}. Motivo: ${motivo}${detalle.trim() ? ` (${detalle.trim()})` : ''}`,
      })
      setOkData({ folio: data.folio, tipoTxt, itemsTxt, motivo, detalle: detalle.trim(), fecha })
      setTipo(null); setSelIds([]); setChkEmpresa(false); setMotivo(''); setDetalle(''); setFecha('')
      cargarSolicitudes()
    } catch (e) { alert('No se pudo enviar la solicitud: ' + e.message) }
    finally { setBusy(false) }
  }

  const OrigenChip = ({ origen }) => {
    const certificado = origen === 'certificacion'
    return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap',
      color: certificado ? '#166534' : '#1a3a6b', background: certificado ? '#e8f5ec' : '#eef2f7',
      border: `1px solid ${certificado ? '#166534' : '#1a3a6b'}22` }}>{certificado ? 'Certificado ✓' : 'Registrado por BigTicket'}</span>
  }

  const PickItem = ({ checked, onToggle, main, sub, right, bloqueado }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 10, marginBottom: 8, cursor: bloqueado ? 'not-allowed' : 'pointer', opacity: bloqueado ? 0.55 : 1,
      border: checked ? '1.5px solid #FF6600' : '1px solid #e4e7ec', background: bloqueado ? '#f8f9fb' : checked ? '#fff7f0' : '#fff' }}>
      <input type="checkbox" checked={checked} disabled={bloqueado} onChange={onToggle} style={{ width: 16, height: 16, accentColor: '#FF6600' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{main}</div>
        <div style={{ fontSize: 11, color: '#888' }}>{sub}</div>
      </div>
      {right}
    </label>
  )

  // ── Confirmación
  if (okData) return (
    <>
      <button className="back-link" onClick={() => setOkData(null)}>← Volver</button>
      <div className="card" style={{ textAlign: 'center', padding: '34px 24px' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#e8f5ec', color: '#166534', fontSize: 28, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>✓</div>
        <h2 style={{ margin: '0 0 6px' }}>Solicitud de baja enviada</h2>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 18 }}>Folio <b>{okData.folio}</b> · Estado: <b>En revisión BigTicket</b></div>
        <div style={{ textAlign: 'left', maxWidth: 520, margin: '0 auto 18px', border: '1px solid #e4e7ec', borderRadius: 10, overflow: 'hidden' }}>
          {[['Tipo de baja', okData.tipoTxt], [okData.tipoTxt === 'Baja de empresa' ? 'Empresa' : 'Selección', okData.itemsTxt],
            ['Motivo', okData.motivo], okData.detalle ? ['Detalle', okData.detalle] : null,
            okData.fecha ? ['Fecha efectiva solicitada', okData.fecha.split('-').reverse().join('/')] : null,
          ].filter(Boolean).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 12, padding: '10px 14px', borderBottom: '1px solid #f0f1f3', fontSize: 13 }}>
              <span style={{ flex: '0 0 180px', color: '#888', fontWeight: 600 }}>{k}</span>
              <span style={{ flex: 1 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 18 }}>Te contactaremos por <b>Consultas</b> y, si corresponde, recibirás el documento de baja para firmar en <b>Firma de contrato</b>.</div>
        <button className="btn btn-primary" onClick={() => setOkData(null)}>Volver</button>
      </div>
    </>
  )

  return (
    <>
      <button className="back-link" onClick={onBack}>← Volver</button>
      <div className="page-head"><div><h2>Solicitud de baja</h2>
        <div className="lede">Selecciona qué quieres dar de baja de la operación y el motivo. La solicitud pasa a revisión de Bigticket antes de hacerse efectiva.</div></div></div>

      <div className="form-card">
        <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10 }}>Tipo de baja a gestionar</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 6 }}>
          {[['vehiculo', '🚚', 'Baja de vehículo'], ['personal', '🧍', 'Baja de personal'], ['empresa', '🏢', 'Baja de empresa']].map(([v, ic, l]) => (
            <button key={v} onClick={() => elegirTipo(v)}
              style={{ padding: '16px 10px', borderRadius: 12, cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit',
                border: tipo === v ? '2px solid #FF6600' : '1px solid #e4e7ec', background: tipo === v ? '#fff7f0' : '#fff' }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>{ic}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>{l}</div>
            </button>
          ))}
        </div>

        {tipo === 'vehiculo' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
              Selecciona la(s) placa(s) <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— vehículos de tu empresa</span>
            </div>
            {vehiculos === null ? <div className="loading">Cargando…</div>
            : vehiculos.length === 0 ? <div style={{ fontSize: 13, color: '#888' }}>No tienes vehículos registrados en certificación.</div>
            : vehiculos.map(v => (
              <PickItem key={v.id} checked={selIds.includes(v.id)} onToggle={() => toggleSel(v.id)} bloqueado={idsEnCurso.has(v.id)}
                main={v.placa} sub={idsEnCurso.has(v.id) ? `⏳ Solicitud en curso (${folioDe(v.id)}) — no puedes duplicarla` : `${v.marca || 'Vehículo'} · ${v.sc}`} right={<OrigenChip origen={v.origen} />} />
            ))}
            <div style={{ fontSize: 11, color: '#888' }}>Puedes seleccionar más de un vehículo en la misma solicitud.</div>
          </div>
        )}

        {tipo === 'personal' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
              Selecciona el personal <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— personal de tu empresa</span>
            </div>
            {personal === null ? <div className="loading">Cargando…</div>
            : personal.length === 0 ? <div style={{ fontSize: 13, color: '#888' }}>No tienes personal registrado en certificación.</div>
            : personal.map(p => (
              <PickItem key={p.id} checked={selIds.includes(p.id)} onToggle={() => toggleSel(p.id)} bloqueado={idsEnCurso.has(p.id)}
                main={p.nombre} sub={idsEnCurso.has(p.id) ? `⏳ Solicitud en curso (${folioDe(p.id)}) — no puedes duplicarla` : `${p.rol} · CURP ${p.curp ? '****' + p.curp.slice(-4) : '—'} · ${p.sc}`} right={<OrigenChip origen={p.origen} />} />
            ))}
            <div style={{ fontSize: 11, color: '#888' }}>Puedes seleccionar más de una persona en la misma solicitud.</div>
          </div>
        )}

        {tipo === 'empresa' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Datos de la empresa</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', border: '1px solid #e4e7ec', borderRadius: 10, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{tercero.nombre}</div>
              <div style={{ fontSize: 11, color: '#888', textAlign: 'right' }}>
                {(vehiculos || []).length} vehículos<br />{(personal || []).length} personas registradas
              </div>
            </div>
            <div style={{ background: '#fff4ec', border: '1px solid #fbd9c0', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#7c3a12', marginBottom: 12 }}>
              <b>Atención:</b> la baja de empresa da de baja también <b>todos sus vehículos y personal certificado</b> asociados. Esta acción pasa a revisión de Bigticket antes de hacerse efectiva.
            </div>
            {empresaEnCurso ? (
              <div style={{ background: '#fff4ec', border: '1px solid #fbd9c0', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#7c3a12' }}>
                ⏳ Ya existe una solicitud de baja de empresa en curso ({empresaEnCurso.folio}). Espera su resolución antes de crear otra.
              </div>
            ) : (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={chkEmpresa} onChange={e => setChkEmpresa(e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: '#FF6600' }} />
              <span>Entiendo que esta solicitud incluye la baja de todos los vehículos y el personal de la empresa.</span>
            </label>
            )}
          </div>
        )}

        {tipo && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #e4e7ec' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a6b', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Motivo de la baja</div>
            <div className="form-grid">
              <div className="field"><label>Motivo *</label>
                <select value={motivo} onChange={e => setMotivo(e.target.value)}>
                  <option value="">Selecciona el motivo…</option>
                  {MOTIVOS_BAJA[tipo].map(m => <option key={m} value={m}>{m}</option>)}
                </select></div>
              <div className="field"><label>Fecha efectiva solicitada</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
              <div className="field full"><label>Detalle del motivo {motivo === 'Otro' && <span style={{ color: '#dc2626' }}>*</span>}</label>
                <input value={detalle} onChange={e => setDetalle(e.target.value)}
                  placeholder={motivo === 'Otro' ? 'Obligatorio: describe brevemente la situación' : 'Opcional'}
                  style={motivo === 'Otro' && !detalle.trim() ? { borderColor: '#dc2626', background: '#fff5f5' } : undefined} /></div>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>Si no indicas fecha, la baja se procesa al aprobarse la solicitud.</div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={enviar} disabled={!listo || busy}>
                {busy ? 'Enviando…' : 'Enviar solicitud de baja'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16, padding: '18px 22px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a6b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.4px' }}>Mis solicitudes</div>
        {rows === null ? <div className="loading">Cargando…</div>
        : rows.length === 0 ? <div style={{ fontSize: 13, color: '#888' }}>Aún no has enviado solicitudes de baja.</div>
        : (
          <table>
            <thead><tr><th>Folio</th><th>Tipo</th><th>Selección</th><th>Motivo</th><th>Estado</th><th>Fecha</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const e = ESTADO_SOLICITUD[r.estado] || ESTADO_SOLICITUD.en_revision
                const sel = r.tipo === 'empresa'
                  ? (r.seleccion?.empresa || tercero.nombre)
                  : (Array.isArray(r.seleccion) ? r.seleccion.map(s => s.placa || s.nombre).join(', ') : '—')
                const tipoTxt = r.tipo === 'vehiculo' ? 'Vehículo' : r.tipo === 'personal' ? 'Personal' : 'Empresa'
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.folio}</td>
                    <td>{tipoTxt}</td>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{sel}</td>
                    <td>{r.motivo}</td>
                    <td><span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, color: e.c, background: e.bg, border: `1px solid ${e.c}22`, whiteSpace: 'nowrap' }}>{e.t}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleDateString('es-MX')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────
function SCSelect({ value, onChange, invalid }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={invalid ? { borderColor: '#dc2626', background: '#fff5f5' } : undefined}>
      <option value="">Selecciona el centro…</option>
      {SC_LIST.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}
function FileField({ label, tipoDoc, files, setFiles, missing }) {
  const has = !!files[tipoDoc]
  const showMiss = missing && !has
  return (
    <div className={`file-row ${has ? 'done' : ''}`} style={showMiss ? { borderColor: '#dc2626', background: '#fff5f5' } : undefined}>
      <label>{label}{has ? ' ✓' : (showMiss ? <span style={{ color: '#dc2626' }}> — falta</span> : '')}</label>
      <label className="file-btn">{has ? 'Cambiar' : 'Subir archivo'}
        <input type="file" accept="image/*,application/pdf" onChange={e => setFiles({ ...files, [tipoDoc]: e.target.files[0] })} /></label>
    </div>
  )
}
// Insert con reintento minimal: si las columnas nuevas (subido_por) aún no
// existen en certificacion_documentos, reintenta solo con las columnas base.
async function insDocPortal(fila) {
  let r = await supabase.from('certificacion_documentos').insert(fila).select('id').single()
  if (r.error) {
    console.warn('insert certificacion_documentos (completo) falló:', r.error.message, '— reintento minimal')
    r = await supabase.from('certificacion_documentos')
      .insert({ certificacion_id: fila.certificacion_id, tipo_documento: fila.tipo_documento, storage_path: fila.storage_path })
      .select('id').single()
  }
  return r
}
async function subirDoc(terceroId, certId, tipoDoc, file) {
  const ext = file.name.split('.').pop()
  const path = `${terceroId}/${certId}/${tipoDoc}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
  if (error) throw error
  const { error: eIns } = await insDocPortal({ certificacion_id: certId, tipo_documento: tipoDoc, storage_path: path })
  if (eIns) throw new Error(`El documento ${tipoDoc} subió pero no se registró: ` + eIns.message)
}

// ── Formulario de persona (conductor o ayudante) ─────────────────────
// Verifica si una placa/CURP ya está ACTIVA en el padrón de OTRA empresa.
// Devuelve { empresa } si hay conflicto, o null si está libre.
async function verificarTitularidad({ campo, valor, terceroId }) {
  const v = String(valor || '').toUpperCase().trim()
  if (!v) return null
  try {
    const { data, error } = await supabase
      .from('flota_personal_terceros')
      .select('tercero_id, placa, curp, tipo')
      .eq('estado', 'activo')
      .ilike(campo, v)
    if (error || !data) return null
    const ajeno = data.find(r => r.tercero_id && r.tercero_id !== terceroId)
    if (!ajeno) return null
    const { data: emp } = await supabase.from('terceros').select('nombre').eq('id', ajeno.tercero_id).maybeSingle()
    return { empresa: emp?.nombre || 'otra empresa', tipo: ajeno.tipo }
  } catch (e) { return null }
}

function AvisoTitularidad({ conflicto, queEs }) {
  if (!conflicto) return null
  return (
    <div style={{ background: '#fff4ec', border: '1.5px solid #F47B20', borderRadius: 10, padding: '12px 14px', margin: '10px 0' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#b45309', marginBottom: 4 }}>
        ⚠️ Este {queEs} aún está asociado a la empresa "{conflicto.empresa}"
      </div>
      <div style={{ fontSize: 12.5, color: '#7c3a12', lineHeight: 1.55 }}>
        Para poder certificarlo con tu empresa, esa empresa debe iniciar la <b>solicitud de baja</b> primero.
        Si consideras que es un error, escríbenos en <b>Consultas</b> y el equipo de Certificaciones lo revisa.
      </div>
    </div>
  )
}

function FormPersona({ tipo, tercero, email, onBack, onDone }) {
  const esConductor = tipo === 'conductor'
  const [sc, setSc] = useState('')
  const [f, setF] = useState({ nombre: '', curp: '', rfc: '', telefono: '', email: '', licencia_numero: '', licencia_estado: '', licencia_vigencia: '' })
  const [files, setFiles] = useState({})
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false)
  const [intentado, setIntentado] = useState(false); const [faltan, setFaltan] = useState([])
  const miss = (vacio) => (intentado && vacio ? { borderColor: '#dc2626', background: '#fff5f5' } : undefined)
  const set = (k, v) => setF({ ...f, [k]: v })
  const [conflicto, setConflicto] = useState(null)
  const [chk, setChk] = useState(false)
  const revisarCurp = async () => {
    setConflicto(null)
    if (!f.curp.trim()) return
    setChk(true)
    setConflicto(await verificarTitularidad({ campo: 'curp', valor: f.curp, terceroId: tercero.tercero_id }))
    setChk(false)
  }

  async function enviar() {
    setErr(''); setOk('')
    // Candado de titularidad: no se puede certificar algo que sigue activo en otra empresa
    const c = await verificarTitularidad({ campo: 'curp', valor: f.curp, terceroId: tercero.tercero_id })
    if (c) { setConflicto(c); setErr(`No se puede certificar: sigue asociado a la empresa "${c.empresa}". Esa empresa debe iniciar la baja primero.`); return }
    const falta = []
    if (!sc) falta.push('Centro de servicio (SC)')
    if (!f.nombre.trim()) falta.push('Nombre completo')
    if (!f.curp.trim()) falta.push('CURP')
    if (!f.rfc.trim()) falta.push('RFC')
    if (!f.telefono.trim()) falta.push('Teléfono')
    if (!f.email.trim() || !f.email.includes('@')) falta.push('Correo electrónico (ahí llega la invitación MELI)')
    if (esConductor) {
      if (!f.licencia_numero.trim()) falta.push('Número de licencia')
      if (!f.licencia_estado) falta.push('Estado emisor de la licencia')
      if (!f.licencia_vigencia) falta.push('Vigencia de la licencia')
    }
    if (!files.ine) falta.push('Documento: INE — frente')
    if (!files.ine_reverso) falta.push('Documento: INE — reverso')
    if (!files.curp) falta.push('Documento: CURP (PDF)')
    if (!files.rfc) falta.push('Documento: RFC')
    if (esConductor && !files.licencia) falta.push('Documento: Licencia')
    if (falta.length) { setIntentado(true); setFaltan(falta); return }
    setFaltan([]); setBusy(true)
    try {
      const { data: cert, error } = await supabase.from('certificaciones')
        .insert({ tercero_id: tercero.tercero_id, tipo, estado: 'enviado', origen: 'portal_web', enviado_por: email, service_center: sc, etapa_kanban: 'recepcion' })
        .select().single()
      if (error) throw error
      await supabase.from('certificacion_conductor').insert({
        certificacion_id: cert.id, nombre: f.nombre.trim(), curp: f.curp.trim().toUpperCase(),
        rfc: f.rfc.trim().toUpperCase() || null, telefono: f.telefono || null,
        email: f.email.trim().toLowerCase(),
        licencia_numero: esConductor ? (f.licencia_numero || null) : null,
        licencia_estado: esConductor ? (f.licencia_estado || null) : null,
        licencia_vigencia: esConductor ? (f.licencia_vigencia || null) : null,
      })
      for (const [t, file] of Object.entries(files)) if (file) await subirDoc(tercero.tercero_id, cert.id, t, file)
      await supabase.from('certificacion_eventos').insert({ certificacion_id: cert.id, estado_nuevo: 'enviado', nota: 'Enviado desde portal web', actor: email })
      setOk(`${TIPO_LABEL[tipo]} enviado a certificar. Te avisaremos cuando esté validado.`)
      setTimeout(onDone, 1400)
    } catch (e) { setErr('No se pudo enviar: ' + (e.message || 'error desconocido')) }
    setBusy(false)
  }

  return (
    <>
      <button className="back-link" onClick={onBack}>← Volver</button>
      <div className="page-head"><div><h2>Certificar {esConductor ? 'conductor' : 'ayudante'}</h2>
        <div className="lede">Datos de la persona que quieres ingresar a la operación.</div></div></div>
      <div className="form-card">
        {faltan.length > 0 && (
          <div className="form-error">
            <b>Faltan datos obligatorios:</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{faltan.map(x => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
        {err && <div className="form-error">{err}</div>}
        {ok && <div className="form-ok">{ok}</div>}

        <div className="section-title" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>Centro de servicio</div>
        <div className="form-grid"><div className="field"><label>Centro de servicio (SC) *</label><SCSelect value={sc} onChange={setSc} invalid={intentado && !sc} /></div></div>

        <div className="section-title">Datos personales</div>
        <div className="form-grid">
          <div className="field full"><label>Nombre completo *</label><input value={f.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Nombre y apellidos" style={miss(!f.nombre.trim())} /></div>
          <div className="field"><label>CURP *</label><input value={f.curp} onChange={e => { set('curp', e.target.value); setConflicto(null) }} onBlur={revisarCurp} placeholder="18 caracteres" maxLength={18} style={conflicto ? { borderColor: '#F47B20', background: '#fff8f2' } : miss(!f.curp.trim())} />
            {chk && <div style={{ fontSize: 11, color: '#98a2b3', marginTop: 3 }}>Verificando titularidad…</div>}</div>
          <div className="field"><label>RFC *</label><input value={f.rfc} onChange={e => set('rfc', e.target.value)} placeholder="13 caracteres" maxLength={13} style={miss(!f.rfc.trim())} /></div>
          <div className="field"><label>Teléfono *</label><input value={f.telefono} onChange={e => set('telefono', e.target.value)} placeholder="10 dígitos" style={miss(!f.telefono.trim())} /></div>
          <div className="field"><label>Correo electrónico *</label><input type="email" value={f.email} onChange={e => set('email', e.target.value)} placeholder="correo@ejemplo.com" style={miss(!f.email.trim() || !f.email.includes('@'))} />
            <div style={{ fontSize: 11, color: '#667085', marginTop: 3 }}>📩 A este correo llegará la invitación de MELI — verifica que sea el del {esConductor ? 'conductor' : 'ayudante'} y esté correcto.</div>
          </div>
        </div>

        {esConductor && (
          <>
            <div className="section-title">Licencia de conducir</div>
            <div className="form-grid">
              <div className="field"><label>Número de licencia *</label><input value={f.licencia_numero} onChange={e => set('licencia_numero', e.target.value)} style={miss(!f.licencia_numero.trim())} /></div>
              <div className="field"><label>Estado emisor *</label>
                <select value={f.licencia_estado} onChange={e => set('licencia_estado', e.target.value)} style={miss(!f.licencia_estado)}>
                  <option value="">Selecciona…</option>{ESTADOS_MX.map(s => <option key={s} value={s}>{s}</option>)}
                </select></div>
              <div className="field"><label>Vigencia *</label><input type="date" value={f.licencia_vigencia} onChange={e => set('licencia_vigencia', e.target.value)} style={miss(!f.licencia_vigencia)} /></div>
            </div>
          </>
        )}

        <div className="section-title">Documentos (obligatorios)</div>
        <div className="form-grid">
          <FileField label="INE — frente" tipoDoc="ine" files={files} setFiles={setFiles} missing={intentado} />
          <FileField label="INE — reverso" tipoDoc="ine_reverso" files={files} setFiles={setFiles} missing={intentado} />
          <FileField label="CURP (PDF)" tipoDoc="curp" files={files} setFiles={setFiles} missing={intentado} />
          <FileField label="RFC (PDF)" tipoDoc="rfc" files={files} setFiles={setFiles} missing={intentado} />
          {esConductor && <FileField label="Licencia" tipoDoc="licencia" files={files} setFiles={setFiles} missing={intentado} />}
        </div>

        <AvisoTitularidad conflicto={conflicto} queEs="conductor o ayudante" />
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onBack}>Cancelar</button>
          <button className="btn btn-primary" onClick={enviar} disabled={busy}>{busy ? 'Enviando…' : 'Enviar a certificar'}</button>
        </div>
      </div>
    </>
  )
}

// ── Formulario de vehículo ───────────────────────────────────────────
function FormVehiculo({ tercero, email, onBack, onDone }) {
  const [sc, setSc] = useState('')
  const [f, setF] = useState({ placa: '', vin: '', marca: '', modelo: '', anio: '' })
  const [files, setFiles] = useState({})
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false)
  const [intentado, setIntentado] = useState(false); const [faltan, setFaltan] = useState([])
  const miss = (vacio) => (intentado && vacio ? { borderColor: '#dc2626', background: '#fff5f5' } : undefined)
  const set = (k, v) => setF({ ...f, [k]: v })
  const [conflicto, setConflicto] = useState(null)
  const [chk, setChk] = useState(false)
  const revisarPlaca = async () => {
    setConflicto(null)
    if (!f.placa.trim()) return
    setChk(true)
    setConflicto(await verificarTitularidad({ campo: 'placa', valor: f.placa, terceroId: tercero.tercero_id }))
    setChk(false)
  }

  async function enviar() {
    setErr(''); setOk('')
    // Candado de titularidad: la placa no puede estar activa en otra empresa
    const c = await verificarTitularidad({ campo: 'placa', valor: f.placa, terceroId: tercero.tercero_id })
    if (c) { setConflicto(c); setErr(`No se puede certificar: la placa sigue asociada a la empresa "${c.empresa}". Esa empresa debe iniciar la baja primero.`); return }
    const falta = []
    if (!sc) falta.push('Centro de servicio (SC)')
    if (!f.placa.trim()) falta.push('Placa')
    if (!f.marca.trim()) falta.push('Marca')
    if (!f.modelo.trim()) falta.push('Modelo')
    if (!/^(19|20)\d{2}$/.test(f.anio.trim())) falta.push('Año (4 dígitos)')
    if (!files.foto_frente) falta.push('Foto: Frente')
    if (!files.foto_trasera) falta.push('Foto: Trasera')
    if (!files.foto_lado_izq) falta.push('Foto: Lado izquierdo')
    if (!files.foto_lado_der) falta.push('Foto: Lado derecho')
    if (!files.tarjeta_circulacion) falta.push('Documento: Tarjeta de circulación')
    if (!files.poliza_seguro) falta.push('Documento: Póliza de seguro')
    if (falta.length) { setIntentado(true); setFaltan(falta); return }
    setFaltan([]); setBusy(true)
    try {
      const { data: cert, error } = await supabase.from('certificaciones')
        .insert({ tercero_id: tercero.tercero_id, tipo: 'vehiculo', estado: 'enviado', origen: 'portal_web', enviado_por: email, service_center: sc, etapa_kanban: 'recepcion' })
        .select().single()
      if (error) throw error
      await supabase.from('certificacion_vehiculo').insert({
        certificacion_id: cert.id, placa: f.placa.trim().toUpperCase().replace(/\s/g, ''), vin: f.vin.trim().toUpperCase() || null,
        marca: f.marca.trim().toUpperCase(), modelo: f.modelo.trim().toUpperCase(), anio: Number(f.anio.trim()),
      })
      for (const [t, file] of Object.entries(files)) if (file) await subirDoc(tercero.tercero_id, cert.id, t, file)
      await supabase.from('certificacion_eventos').insert({ certificacion_id: cert.id, estado_nuevo: 'enviado', nota: 'Enviado desde portal web', actor: email })
      setOk('Vehículo enviado a certificar. Te avisaremos cuando esté validado.')
      setTimeout(onDone, 1400)
    } catch (e) { setErr('No se pudo enviar: ' + (e.message || 'error desconocido')) }
    setBusy(false)
  }

  return (
    <>
      <button className="back-link" onClick={onBack}>← Volver</button>
      <div className="page-head"><div><h2>Certificar vehículo</h2>
        <div className="lede">Datos del vehículo que quieres ingresar a la operación.</div></div></div>
      <div className="form-card">
        {faltan.length > 0 && (
          <div className="form-error">
            <b>Faltan datos obligatorios:</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{faltan.map(x => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
        {err && <div className="form-error">{err}</div>}
        {ok && <div className="form-ok">{ok}</div>}

        <div className="section-title" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>Centro de servicio</div>
        <div className="form-grid"><div className="field"><label>Centro de servicio (SC) *</label><SCSelect value={sc} onChange={setSc} invalid={intentado && !sc} /></div></div>

        <div className="section-title">Datos del vehículo</div>
        <div className="form-grid">
          <div className="field"><label>Placa *</label><input value={f.placa} onChange={e => { set('placa', e.target.value); setConflicto(null) }} onBlur={revisarPlaca} placeholder="Ej. ST2965E" style={conflicto ? { borderColor: '#F47B20', background: '#fff8f2' } : miss(!f.placa.trim())} />
            {chk && <div style={{ fontSize: 11, color: '#98a2b3', marginTop: 3 }}>Verificando titularidad…</div>}</div>
          <div className="field"><label>Marca *</label><input value={f.marca} onChange={e => set('marca', e.target.value)} placeholder="Ej. RAM, Nissan" style={miss(!f.marca.trim())} /></div>
          <div className="field"><label>Modelo *</label><input value={f.modelo} onChange={e => set('modelo', e.target.value)} placeholder="Ej. ProMaster City" style={miss(!f.modelo.trim())} /></div>
          <div className="field"><label>Año *</label><input value={f.anio} onChange={e => set('anio', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} placeholder="Ej. 2021" inputMode="numeric" style={miss(!/^(19|20)\d{2}$/.test(f.anio.trim()))} /></div>
          <div className="field"><label>VIN / número de serie</label><input value={f.vin} onChange={e => set('vin', e.target.value)} placeholder="Opcional" /></div>
        </div>

        <div className="section-title">Fotos del vehículo (obligatorias)</div>
        <div className="form-grid">
          <FileField label="Frente" tipoDoc="foto_frente" files={files} setFiles={setFiles} missing={intentado} />
          <FileField label="Trasera" tipoDoc="foto_trasera" files={files} setFiles={setFiles} missing={intentado} />
          <FileField label="Lado izquierdo" tipoDoc="foto_lado_izq" files={files} setFiles={setFiles} missing={intentado} />
          <FileField label="Lado derecho" tipoDoc="foto_lado_der" files={files} setFiles={setFiles} missing={intentado} />
        </div>

        <div className="section-title">Documentos (obligatorios)</div>
        <div className="form-grid">
          <FileField label="Tarjeta de circulación" tipoDoc="tarjeta_circulacion" files={files} setFiles={setFiles} missing={intentado} />
          <FileField label="Póliza de seguro" tipoDoc="poliza_seguro" files={files} setFiles={setFiles} missing={intentado} />
        </div>

        <AvisoTitularidad conflicto={conflicto} queEs="vehículo" />
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onBack}>Cancelar</button>
          <button className="btn btn-primary" onClick={enviar} disabled={busy}>{busy ? 'Enviando…' : 'Enviar a certificar'}</button>
        </div>
      </div>
    </>
  )
}
