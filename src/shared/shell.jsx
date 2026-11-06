// ═══════════════════════════════════════════════════════════════════════════
// shared/shell.jsx — Armazón del Brain con la misma visual del Portal
// Transportista y de la Bitácora: cabecera azul con logo y rótulo, franja con
// país y hora, menú lateral blanco con los módulos y contenido al centro.
// Mismos colores (#002E5D / #FF6600), tipografías (Poppins / Open Sans) y medidas.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useMenuSubtabs } from "./subtabs";

// Logo desde el Portal Transportista (ya publicado ahí): el Brain no necesita carpeta public.
const LOGO = "https://app.fleetbiggy.com/logo-bigticket-blanco.png";

function horaDe(pais) {
  const cl = pais === "Chile";
  const tz = cl ? "America/Santiago" : "America/Mexico_City";
  const loc = cl ? "es-CL" : "es-MX";
  const d = new Date();
  const f = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "short", year: "numeric", timeZone: tz }).format(d).replace(/\./g, "");
  const h = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(d);
  return `${f.replace(/ /g, "-")}, ${h} hrs`;
}

export function ShellBrain({ pais, paisCode, usuario, mods, labels, tab, onTab, onCambiarPais, onLogout, children }) {
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(false);
  const [hora, setHora] = useState(horaDe(pais));
  useEffect(() => { setHora(horaDe(pais)); const t = setInterval(() => setHora(horaDe(pais)), 30000); return () => clearInterval(t); }, [pais]);
  const { listas, activas, elegir } = useMenuSubtabs();
  const [abierto, setAbierto] = useState(tab);           // madre desplegada en el menú
  useEffect(() => { setAbierto(tab); }, [tab]);
  const ir = (k) => { setMenu(false); onTab(k); window.scrollTo(0, 0); };
  const irSub = (k, id) => { elegir(k, id); ir(k); };
  return (
    <div className="bs-shell">
      <style>{CSS_BS}</style>
      <header className="bs-header">
        <div className="bs-marca">
          <button className="bs-hamburguesa" aria-label="Abrir menú" onClick={() => setMenu(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <img src={LOGO} alt="Bigticket" className="bs-logo" />
          <span className="bs-sep" />
          <span className="bs-rotulo">Brain</span>
        </div>
        <div className="bs-acciones">
          <button className="bs-pais" onClick={onCambiarPais} title="Cambiar operación">
            {paisCode && <img src={`https://flagcdn.com/w40/${paisCode}.png`} alt="" />}
            <span>{pais}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <div className="bs-pos">
            <button className="bs-usuario" onClick={() => setPanel(!panel)}>
              <span>{usuario?.nombre || "Usuario"}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {panel && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setPanel(false)} />
                <div className="bs-desp">
                  <div className="bs-desp-item"><span className="t">{usuario?.nombre}</span><span className="d">{usuario?.email || usuario?.rol || ""}</span></div>
                  <button className="bs-desp-item" onClick={() => { setPanel(false); onCambiarPais(); }}><span className="t">Cambiar operación</span><span className="d">México o Chile</span></button>
                  <button className="bs-desp-item" onClick={onLogout}><span className="t">Cerrar sesión</span></button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      <div className="bs-franja"><span>{pais}</span><span>·</span><span>{hora}</span></div>
      <div className="bs-cuerpo">
        {menu && <div className="bs-velo" onClick={() => setMenu(false)} />}
        <aside className={`bs-lateral${menu ? " abierto" : ""}`}>
          <nav className="bs-nav">
            {mods.map((k) => {
              const subs = listas[k];
              const open = !!subs && abierto === k;
              return (
                <div key={k}>
                  <button className={`bs-item${tab === k ? " on" : ""}`} aria-current={tab === k && !subs ? "page" : undefined}
                    onClick={() => { if (subs) { setAbierto(open ? null : k); if (tab !== k) ir(k); } else ir(k); }}>
                    <span>{labels[k] || k}</span>
                    {subs && <svg className="bs-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: `rotate(${open ? 180 : 0}deg)` }}><path d="m6 9 6 6 6-6" /></svg>}
                  </button>
                  {open && (
                    <div className="bs-sub">
                      {subs.map((t) => (
                        <button key={t.id} className={`bs-sub-btn${tab === k && activas[k] === t.id ? " on" : ""}`} aria-current={tab === k && activas[k] === t.id ? "page" : undefined} onClick={() => irSub(k, t.id)}>
                          <span className="bs-sub-t">{t.label}{Number(t.n) > 0 && <span className="bs-sub-n">{t.n}</span>}</span>
                          {t.desc && <span className="bs-sub-d">{t.desc}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>
        <main className="bs-main">{children}</main>
      </div>
    </div>
  );
}

const CSS_BS = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Open+Sans:wght@400;600;700&display=swap');
.bs-shell { --navy:#002E5D; --orange:#FF6600; --page:#F4F3F3; --line:#E4E3E3; --muted:#545454; min-height:100vh; background:var(--page); font-family:'Open Sans',system-ui,sans-serif; }
.bs-shell .sec-title, .bs-shell h1, .bs-shell h2 { font-family:Poppins,'Open Sans',sans-serif; color:var(--navy); }
.bs-shell button { font-family:inherit; }
.bs-header { background:var(--navy); height:64px; display:flex; align-items:center; justify-content:space-between; padding:0 28px; gap:20px; position:sticky; top:0; z-index:100; }
.bs-marca { display:flex; align-items:center; gap:16px; min-width:0; }
.bs-logo { height:20px; display:block; }
.bs-sep { width:1px; height:20px; background:rgba(255,255,255,.22); }
.bs-rotulo { font-family:Poppins,sans-serif; font-weight:600; font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:#F4F3F3; white-space:nowrap; }
.bs-hamburguesa { display:none; background:none; border:none; padding:4px; margin-left:-4px; cursor:pointer; }
.bs-acciones { display:flex; align-items:center; gap:12px; flex-shrink:0; }
.bs-pos { position:relative; }
.bs-pais, .bs-usuario { display:flex; align-items:center; gap:8px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.15); border-radius:999px; padding:6px 14px; cursor:pointer; }
.bs-pais img { width:18px; height:12px; object-fit:cover; border-radius:2px; }
.bs-pais span, .bs-usuario span { font-family:Poppins,sans-serif; font-weight:600; font-size:13px; color:#fff; white-space:nowrap; max-width:220px; overflow:hidden; text-overflow:ellipsis; }
.bs-desp { position:absolute; right:0; top:calc(100% + 10px); z-index:41; width:240px; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; box-shadow:0 10px 28px rgba(0,46,93,.14); }
.bs-desp-item { display:block; width:100%; text-align:left; background:#fff; border:none; border-bottom:1px solid #EFEDED; padding:11px 16px; cursor:pointer; }
.bs-desp-item:last-child { border-bottom:none; }
.bs-desp-item:hover { background:#F4F3F3; }
.bs-desp-item .t { display:block; font-family:Poppins,sans-serif; font-weight:700; font-size:13px; color:var(--navy); }
.bs-desp-item .d { display:block; font-size:12px; color:var(--muted); margin-top:2px; }
.bs-franja { display:flex; justify-content:flex-end; gap:8px; align-items:center; padding:8px 28px; border-bottom:1px solid var(--line); background:#fff; font-size:12px; color:#4A5058; white-space:nowrap; position:sticky; top:64px; z-index:19; }
.bs-cuerpo { display:flex; align-items:flex-start; }
.bs-lateral { width:272px; flex-shrink:0; position:sticky; top:97px; height:calc(100vh - 97px); overflow-y:auto; background:#fff; border-right:1px solid var(--line); padding:20px 14px 40px; }
.bs-nav { display:flex; flex-direction:column; gap:4px; }
.bs-item { width:100%; border:none; background:transparent; border-radius:10px; padding:12px 14px; font-weight:600; font-size:14.5px; cursor:pointer; color:#8B8B8B; text-align:left; }
.bs-item:hover { background:#F4F3F3; }
.bs-item { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.bs-item.on { color:var(--navy); font-weight:700; background:rgba(0,46,93,.06); box-shadow:inset 3px 0 0 var(--orange); }
.bs-chev { flex-shrink:0; transition:transform .15s ease; }
.bs-sub { display:flex; flex-direction:column; gap:2px; padding:4px 0 8px 13px; margin-left:14px; border-left:1px solid var(--line); }
.bs-sub-btn { width:100%; text-align:left; background:transparent; border:none; border-radius:8px; padding:8px 10px; cursor:pointer; display:flex; flex-direction:column; }
.bs-sub-btn:hover { background:#F4F3F3; }
.bs-sub-btn.on { background:rgba(255,102,0,.08); }
.bs-sub-t { font-family:Poppins,sans-serif; font-weight:700; font-size:13px; color:var(--navy); }
.bs-sub-btn.on .bs-sub-t { color:var(--orange); }
.bs-sub-n { display:inline-flex; align-items:center; justify-content:center; margin-left:8px; min-width:18px; height:18px; padding:0 5px; border-radius:9px; background:var(--orange); color:#fff; font-size:10.5px; font-weight:700; vertical-align:1px; }
.bs-sub-d { font-size:11.5px; color:var(--muted); margin-top:2px; line-height:1.35; }
.bs-velo { display:none; }
.bs-main { flex:1; min-width:0; }
@media (max-width: 860px) {
  .bs-header { padding:0 16px; gap:12px; }
  .bs-hamburguesa { display:flex; }
  .bs-rotulo, .bs-sep { display:none; }
  .bs-usuario span { max-width:110px; }
  .bs-cuerpo { display:block; }
  .bs-lateral { position:fixed; top:95px; left:0; bottom:0; height:auto; z-index:25; transform:translateX(-100%); transition:transform .2s ease; }
  .bs-lateral.abierto { transform:none; box-shadow:0 10px 28px rgba(0,46,93,.2); }
  .bs-velo { display:block; position:fixed; inset:95px 0 0 0; background:rgba(0,46,93,.35); z-index:24; }
}
`;
