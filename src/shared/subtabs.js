// ═══════════════════════════════════════════════════════════════════════════
// shared/subtabs.js — Subpestañas de cada pestaña madre, compartidas con el
// menú lateral del Brain (shared/shell.jsx).
//
// Cada módulo registra su lista al cargarse (registrarSubtabs) y usa
// useSubtab(modulo) en vez de su propio useState. Así el menú lateral muestra
// las subpestañas desplegadas bajo su madre y puede abrir cualquiera.
// La subpestaña elegida se recuerda por módulo (localStorage).
// ═══════════════════════════════════════════════════════════════════════════
import { useSyncExternalStore } from "react";

const listas = {};    // modulo → [{ id, label, desc }]
const activas = {};   // modulo → id
const oyentes = new Set();
let version = 0;
const avisar = () => { version++; oyentes.forEach((f) => f()); };

export function registrarSubtabs(modulo, tabs, inicial) {
  listas[modulo] = tabs;
  if (!activas[modulo]) {
    let guardada = null;
    try { guardada = localStorage.getItem(`bt_nav_subtab_${modulo}`); } catch { /* sin storage */ }
    activas[modulo] = tabs.some((t) => t.id === guardada) ? guardada : (inicial || tabs[0]?.id);
  }
  avisar();
}
export function elegirSubtab(modulo, id) {
  activas[modulo] = id;
  try { localStorage.setItem(`bt_nav_subtab_${modulo}`, id); } catch { /* sin storage */ }
  avisar();
}
const suscribir = (f) => { oyentes.add(f); return () => oyentes.delete(f); };
const foto = () => version;

// Para el módulo: [subtab, setSubtab]
export function useSubtab(modulo) {
  useSyncExternalStore(suscribir, foto);
  return [activas[modulo], (id) => elegirSubtab(modulo, id)];
}
// Para el menú lateral
export function useMenuSubtabs() {
  useSyncExternalStore(suscribir, foto);
  return { listas, activas, elegir: elegirSubtab };
}
export const subtabActual = (modulo) => (listas[modulo] || []).find((t) => t.id === activas[modulo]);
