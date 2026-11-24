import { useEffect, useMemo, useState } from "react";
import { sb } from "../../shared";
import { traerTodo } from "./comun";
import { AvisoActualizacion, ultimaCorridaConDatos } from "./AvisoActualizacion";
import { ActivosCriticos } from "./ActivosCriticos";
import { DashboardInicial } from "./DashboardInicial";
import { DashboardCertificacion } from "./DashboardMensual";
import { DashboardEmpleados } from "./Empleados";
import { HallazgosAutomaticos } from "./Hallazgos";
import { DashboardHistorico } from "./Historico";
import { EditorMatriz } from "./Matriz";
import { ModalOverride } from "./ModalOverride";
import { DashboardRiesgoRSE } from "./RiesgoRSE";
import { DashboardVehiculos } from "./Vehiculos";

// ═══════════════════════════════════════════════════════════════════════════
// CERTRONIC · CHILE — Pagos · Certificación Documental
// Vista raíz del módulo. Se muestra en Certificaciones · Chile → Certificación
// para Pagos. Lee el proyecto Supabase LogiFlow, donde escribe el pipeline
// de Certronic que corre en el VPS de México (/opt/certronic-scraper):
//   - certronic_certificacion_mensual  (resultado del calculador, por período)
//   - certronic_matriz_documentos      (reglas por mandante, editables)
//   - certronic_estados_documentos     (snapshot diario del scraper liviano)
//   - certronic_pipeline_runs          (historial de corridas del pipeline)
//   - certronic_overrides_analista     (correcciones manuales del analista)
// ═══════════════════════════════════════════════════════════════════════════
function ModuloPagos({ usuario }) {
  // El detalle técnico de las corridas (pasos y comandos) solo lo ve superadmin.
  const esTecnico = usuario?.rol === "superadmin";
  const [datos, setDatos] = useState({ pc: [], ryc: [], sub: [] });
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState(""); // YYYY-MM
  const [periodos, setPeriodos] = useState([]);
  const [vistaActiva, setVistaActiva] = useState("dashboard"); // dashboard | criticos | matriz | hallazgos | rse | empleados | vehiculos | inicial | historico
  const [tabCategoria, setTabCategoria] = useState("pc");
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroMandante, setFiltroMandante] = useState("todos");
  const [filtroActivo, setFiltroActivo] = useState("todos"); // todos | solo_activos | solo_inhabilitados
  const [ordenCol, setOrdenCol] = useState("transporte");
  const [ordenAsc, setOrdenAsc] = useState(true);
  
  // ─── 🆕 OVERRIDES DEL ANALISTA ────────────────────────────────
  // Map de overrides activos: key = "contratista|categoria|subcontratista|doc_campo"
  const [overrides, setOverrides] = useState(new Map());
  // Modal de edición
  const [modalOverride, setModalOverride] = useState(null);  // { contratista, categoria, subcontratista, docCampo, docLabel, estadoCertronic, fechaSnapshot, overrideExistente }
  // 🆕 Cumplimiento de docs iniciales por contratista (para el triángulo)
  // Map: contratista → { porcentaje, semaforo, cumplen, total }
  const [cumplInicial, setCumplInicial] = useState(new Map());
  // Corridas recientes del pipeline (aviso de actualización y fecha de los datos)
  const [corridas, setCorridas] = useState([]);
  const [avisoOculto, setAvisoOculto] = useState(false);

  useEffect(() => { cargarPeriodos(); cargarCorridas(); }, []);
  useEffect(() => { 
    if (periodo) {
      cargarDatos();
      cargarOverrides();
      cargarCumplInicial();
    }
  }, [periodo]);

  const cargarPeriodos = async () => {
    try {
      // Usar vw_certificacion_periodos en lugar de la tabla directamente
      // para evitar el límite de 1000 filas de la REST API de Supabase.
      // La vista devuelve solo los períodos únicos (1 fila por anio+mes).
      const { data } = await sb.from("vw_certificacion_periodos")
        .select("anio, mes")
        .order("anio", { ascending: false })
        .order("mes", { ascending: false });
      const unicos = data && data.length
        ? [...new Set(data.map(r => `${r.anio}-${String(r.mes).padStart(2,"0")}`))]
        : [`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`];
      setPeriodos(unicos);
      setPeriodo(unicos[0]);
    } catch(e) {
      console.error("Error cargar periodos:", e);
      const p = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;
      setPeriodos([p]); setPeriodo(p);
    }
  };

  const cargarDatos = async () => {
    setLoading(true);
    const [anio, mes] = periodo.split("-").map(Number);
    try {
      const todos = await traerTodo(() => sb.from("certronic_certificacion_mensual")
        .select("*")
        .eq("anio", anio).eq("mes", mes)
        .order("id"));
      setDatos({
        pc: todos.filter(d => d.categoria === "PC"),
        ryc: todos.filter(d => d.categoria === "RYC"),
        sub: todos.filter(d => d.categoria === "SUB"),
      });
    } catch(e) {
      console.error("Error cargar datos:", e);
      setDatos({ pc: [], ryc: [], sub: [] });
    }
    setLoading(false);
  };

  // ─── 🆕 OVERRIDES ────────────────────────────────────────────
  // Construye la key única de un override
  const overrideKey = (contratista, categoria, subcontratista, docCampo) => {
    return `${contratista || ""}|${categoria || ""}|${subcontratista || ""}|${docCampo || ""}`;
  };

  // Carga las últimas corridas del pipeline. Con ellas se arma el aviso de
  // actualización y la fecha real de los datos que se están mostrando.
  const cargarCorridas = async () => {
    try {
      const { data, error } = await sb.from("certronic_pipeline_runs")
        .select("*")
        .order("fecha_run", { ascending: false })
        .limit(30);
      if (error) { console.warn("[Corridas] Error:", error.message); return; }
      setCorridas(data || []);
    } catch (e) {
      console.warn("[Corridas] Error:", e.message);
    }
  };

  // 🆕 Carga el cumplimiento de docs iniciales por contratista (para el triángulo en Dashboard Mensual)
  const cargarCumplInicial = async () => {
    try {
      // 1. Snapshot más reciente
      const { data: snap } = await sb.from("certronic_empleados_docs")
        .select("fecha_snapshot")
        .order("fecha_snapshot", { ascending: false })
        .limit(1);
      if (!snap || snap.length === 0) return;
      const fechaSnap = snap[0].fecha_snapshot;

      // 2. Cargar todos los DOC_CONTRATISTA del snapshot (paginado)
      let todos = [];
      let from = 0;
      const lim = 1000;
      while (true) {
        const { data, error } = await sb.from("certronic_empleados_docs")
          .select("token_certronic, documento, cumple")
          .eq("fecha_snapshot", fechaSnap)
          .eq("origen", "DOC_CONTRATISTA")
          .range(from, from + lim - 1);
        if (error) break;
        if (!data || data.length === 0) break;
        todos = todos.concat(data);
        if (data.length < lim) break;
        from += lim;
      }

      // 3. Mapping token → contratista
      const detalles = await traerTodo(() => sb.from("certronic_empleados_detalle")
        .select("token_certronic, contratista")
        .eq("fecha_snapshot", fechaSnap)
        .order("id"));
      const tokenAContr = new Map();
      for (const d of detalles || []) {
        if (d.contratista) tokenAContr.set(d.token_certronic, d.contratista);
      }

      // 4. Agrupar por contratista (1 doc único por contratista, sin duplicar entre empleados)
      const porContratista = new Map();
      for (const d of todos) {
        const c = tokenAContr.get(d.token_certronic);
        if (!c) continue;
        if (!porContratista.has(c)) porContratista.set(c, new Map());
        const m = porContratista.get(c);
        if (!m.has(d.documento)) m.set(d.documento, d.cumple);
      }

      // 5. Calcular % cumplimiento + semáforo
      const resultado = new Map();
      for (const [contratista, docsMap] of porContratista.entries()) {
        const total = docsMap.size;
        const cumplen = Array.from(docsMap.values()).filter(v => v === true).length;
        const porcentaje = total > 0 ? Math.round((cumplen * 100) / total) : 0;
        let semaforo = "rojo";
        if (porcentaje === 100) semaforo = "verde";
        else if (porcentaje >= 50) semaforo = "amarillo";
        resultado.set(contratista, { porcentaje, semaforo, cumplen, total });
      }
      console.log(`[CumplInicial] Cargados ${resultado.size} contratistas`);
      setCumplInicial(resultado);
    } catch (e) {
      console.warn("[CumplInicial] Error:", e.message);
    }
  };

  const cargarOverrides = async () => {    try {
      const { data, error } = await sb.from("certronic_overrides_analista")
        .select("*")
        .eq("activo", true);
      if (error) {
        if (error.message && error.message.includes("does not exist")) {
          console.log("[Overrides] Tabla aún no existe, saltando");
          return;
        }
        throw error;
      }
      const map = new Map();
      for (const o of data || []) {
        const k = overrideKey(o.contratista, o.categoria, o.subcontratista_nombre, o.doc_campo);
        map.set(k, o);
      }
      console.log(`[Overrides] Cargados ${map.size} overrides activos`);
      setOverrides(map);
    } catch (e) {
      console.warn("[Overrides] Error cargando:", e.message);
    }
  };

  const guardarOverride = async ({ contratista, categoria, subcontratista, docCampo, estadoCertronic, fechaSnapshot, estadoOverride, motivo, fechaCambio }) => {
    if (!motivo || !motivo.trim()) {
      alert("El motivo es obligatorio");
      return false;
    }
    if (!fechaCambio) {
      alert("La fecha del cambio es obligatoria");
      return false;
    }
    try {
      // Si ya existe un override activo para esta tupla, lo invalidamos primero
      const k = overrideKey(contratista, categoria, subcontratista, docCampo);
      const existente = overrides.get(k);
      if (existente) {
        await sb.from("certronic_overrides_analista")
          .update({ activo: false, invalidado_at: new Date().toISOString(), invalidado_motivo: "Reemplazado por nuevo override" })
          .eq("id", existente.id);
      }
      // Insertar el nuevo
      const { data, error } = await sb.from("certronic_overrides_analista")
        .insert({
          contratista,
          categoria,
          subcontratista_nombre: subcontratista || null,
          doc_campo: docCampo,
          estado_certronic_original: estadoCertronic || null,
          fecha_snapshot_original: fechaSnapshot || null,
          estado_override: estadoOverride,
          motivo: motivo.trim(),
          fecha_cambio: fechaCambio,
          editado_por: "analista",
          activo: true,
        })
        .select()
        .single();
      if (error) throw error;
      // Actualizar el map local
      const nuevoMap = new Map(overrides);
      nuevoMap.set(k, data);
      setOverrides(nuevoMap);
      return true;
    } catch (e) {
      console.error("[Overrides] Error guardando:", e);
      alert("Error guardando el override: " + (e.message || e));
      return false;
    }
  };

  const quitarOverride = async (override) => {
    if (!confirm(`¿Quitar este override?\n\nEstado override: ${override.estado_override}\nMotivo: ${override.motivo}\n\nVuelve a mostrarse el estado de Certronic.`)) return;
    try {
      const { error } = await sb.from("certronic_overrides_analista")
        .update({ activo: false, invalidado_at: new Date().toISOString(), invalidado_motivo: "Eliminado manualmente por analista" })
        .eq("id", override.id);
      if (error) throw error;
      const k = overrideKey(override.contratista, override.categoria, override.subcontratista_nombre, override.doc_campo);
      const nuevoMap = new Map(overrides);
      nuevoMap.delete(k);
      setOverrides(nuevoMap);
    } catch (e) {
      console.error("[Overrides] Error quitando:", e);
      alert("Error quitando el override: " + (e.message || e));
    }
  };

  // Auto-invalidar overrides cuando Certronic cambió el campo.
  // Solo se compara contra el período vigente: los overrides no guardan
  // período, y comparar contra un mes anterior desactivaba overrides válidos.
  useEffect(() => {
    if (overrides.size === 0) return;
    if (!periodos.length || periodo !== periodos[0]) return;
    if (!datos.pc.length && !datos.ryc.length && !datos.sub.length) return;
    
    const aInvalidar = [];
    for (const [k, o] of overrides.entries()) {
      // Buscar la fila correspondiente en los datos actuales
      let dataset = [];
      if (o.categoria === "PC") dataset = datos.pc;
      else if (o.categoria === "RYC") dataset = datos.ryc;
      else if (o.categoria === "SUB") dataset = datos.sub;
      
      const fila = dataset.find(d => 
        d.transporte === o.contratista && 
        (!o.subcontratista_nombre || d.subcontratista_nombre === o.subcontratista_nombre)
      );
      if (!fila) continue;  // ya no existe esa fila, dejarlo igual
      
      const valorActual = fila[o.doc_campo];
      // Si Certronic cambió el valor (a algo distinto del original que tenía cuando se hizo el override)
      if (valorActual && o.estado_certronic_original && valorActual !== o.estado_certronic_original) {
        aInvalidar.push(o);
      }
    }
    
    if (aInvalidar.length > 0) {
      console.log(`[Overrides] Invalidando ${aInvalidar.length} overrides porque Certronic actualizó esos campos`);
      (async () => {
        for (const o of aInvalidar) {
          await sb.from("certronic_overrides_analista")
            .update({ 
              activo: false, 
              invalidado_at: new Date().toISOString(), 
              invalidado_motivo: "Certronic actualizó el campo" 
            })
            .eq("id", o.id);
        }
        // Recargar overrides
        cargarOverrides();
      })();
    }
  }, [datos]);

  // ── Helpers ──
  const operacionAMandante = (op) => {
    if (!op) return "Mercado Libre";
    const u = String(op).toUpperCase();
    if (u.includes("F_") || u.includes("FALABELLA")) return "Falabella";
    if (u.includes("R_") || u.includes("ROSEN")) return "Rosen";
    if (u.includes("C_") || u.includes("CANON") || u.includes("CANNON")) return "Canon";
    if (u.includes("ESPORADIC")) return "Esporádicos";
    return "Mercado Libre";
  };

  const fmt$ = (n) => "$" + Math.round(n || 0).toLocaleString("es-CL");

  // ── Datos derivados ──
  const todosActivos = useMemo(() => {
    const todos = [...datos.pc, ...datos.ryc, ...datos.sub];
    return todos.filter(d => !d.recurso_inhabilitado);
  }, [datos]);

  const todosInhabilitados = useMemo(() => {
    const todos = [...datos.pc, ...datos.ryc, ...datos.sub];
    return todos.filter(d => d.recurso_inhabilitado);
  }, [datos]);

  // Empresas únicas inhabilitadas (cada empresa puede aparecer en PC + RyC + SUB)
  const empresasInhabilitadasUnicas = useMemo(() => {
    return new Set(todosInhabilitados.map(d => d.transporte)).size;
  }, [todosInhabilitados]);

  // Empresas únicas activas
  const empresasActivasUnicas = useMemo(() => {
    return new Set([...datos.pc, ...datos.ryc, ...datos.sub]
      .filter(d => !d.recurso_inhabilitado)
      .map(d => d.transporte)).size;
  }, [datos]);

  // KPIs (cuentan TODO: activos + inhabilitados, los inhabilitados son ciudadanos completos)
  const kpis = useMemo(() => {
    const base = [...datos.pc, ...datos.ryc, ...datos.sub];
    const certificados = base.filter(d => d.estado_final === "CERTIFICADO").length;
    const parciales = base.filter(d => d.estado_final === "PENDIENTE").length;
    const sinCert = base.filter(d => d.estado_final === "NO_CERTIFICADO").length;
    return {
      total: base.length,
      certificados, parciales, sinCert,
      pctAvance: base.length ? Math.round(certificados / base.length * 100) : 0,
      anomalias: base.filter(d => d.tiene_anomalia).length,
      inhabilitados: todosInhabilitados.length,
    };
  }, [datos, todosActivos, todosInhabilitados]);

  // ─── ACTIVOS CRÍTICOS (Opción B): empresas activas con retención ───
  const activosCriticos = useMemo(() => {
    // Empresas que NO están inhabilitadas, tienen empleados/vehículos activos
    // y tienen retención > 0
    return [...datos.pc, ...datos.ryc, ...datos.sub]
      .filter(d => !d.recurso_inhabilitado)
      .filter(d => Number(d.pct_retencion) > 0)
      .filter(d => (d.empleados_activos || 0) > 0 || (d.vehiculos_activos || 0) > 0)
      .sort((a, b) => Number(b.pct_retencion) - Number(a.pct_retencion));
  }, [datos]);

  // Operaciones únicas (para filtro) — siempre incluye todo
  const operacionesUnicas = useMemo(() => {
    const todos = [...datos.pc, ...datos.ryc, ...datos.sub];
    return [...new Set(todos.map(d => d.operacion).filter(Boolean))].sort();
  }, [datos]);

  // Documentos por categoría
  const docsPorCategoria = {
    pc: [
      { key: "doc_f30", label: "F30" },
      { key: "doc_f30_1", label: "F30-1" },
      { key: "doc_liquidaciones", label: "LIQUIDACIONES" },
      { key: "doc_cotizaciones", label: "COTIZACIONES" },
      { key: "doc_mutualidad", label: "MUTUALIDAD" },
    ],
    ryc: [
      { key: "doc_f30", label: "F30" },
      { key: "doc_mutualidad", label: "MUTUALIDAD" },
    ],
    sub: [
      { key: "doc_boleta_honorarios", label: "BOLETA HON." },
      { key: "doc_comprobante_pago", label: "COMP. PAGO" },
    ],
  };

  // 🆕 Helper: normaliza texto (sin acentos, sin tildes, lowercase) para búsqueda inteligente
  const normalizar = (s) => (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Filtrado para tabla por categoría
  const datosCategoriaActual = useMemo(() => {
    let arr = datos[tabCategoria] || [];
    
    // 🆕 Filtro de estado activo/inhabilitado
    if (filtroActivo === "solo_activos") arr = arr.filter(d => !d.recurso_inhabilitado);
    if (filtroActivo === "solo_inhabilitados") arr = arr.filter(d => d.recurso_inhabilitado);
    
    // 🆕 Búsqueda inteligente: tolerante a acentos, mayúsculas, parciales
    // Soporta múltiples palabras: "bastian diaz" encuentra "Bastian Andres Diaz"
    if (busqueda) {
      const palabras = normalizar(busqueda).split(/\s+/).filter(Boolean);
      arr = arr.filter(d => {
        const camposBusqueda = [
          d.transporte,
          d.subcontratista_nombre,
          d.email,
          d.operacion,
          d.rut,
        ].map(normalizar).join(" ");
        // TODAS las palabras deben aparecer (AND lógico)
        return palabras.every(p => camposBusqueda.includes(p));
      });
    }
    
    if (filtroEstado !== "todos") arr = arr.filter(d => d.estado_final === filtroEstado);
    if (filtroMandante !== "todos") arr = arr.filter(d => operacionAMandante(d.operacion) === filtroMandante);
    
    arr = [...arr].sort((a, b) => {
      const va = a[ordenCol], vb = b[ordenCol];
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number") return ordenAsc ? va - vb : vb - va;
      return ordenAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return arr;
  }, [datos, tabCategoria, busqueda, filtroEstado, filtroMandante, filtroActivo, ordenCol, ordenAsc]);

  // ─── Descargar Excel multi-hoja ───
  const descargarExcel = async () => {
    if (!window.XLSX) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const XLSX = window.XLSX;
    if (!XLSX) { alert("No se pudo cargar la librería de Excel."); return; }

    const meses = ["","ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
    const [anioStr, mesStr] = periodo.split("-");
    const nombreMes = meses[parseInt(mesStr)] || mesStr;
    const anio = parseInt(anioStr);

    const wb = window.XLSX.utils.book_new();
    // 🆕 Excel ahora incluye TODOS los registros (activos + inhabilitados)
    const todosPC = datos.pc;
    const todosRYC = datos.ryc;
    const todosSUB = datos.sub;
    const totalTodos = todosPC.length + todosRYC.length + todosSUB.length;

    // RESUMEN
    const resumen = [
      [`BIGTICKET — CERTIFICACIÓN DOCUMENTAL ${nombreMes} ${anio}`],
      [`Generado: ${new Date().toLocaleString("es-CL")}`],
      [`Total registros: ${totalTodos} (incluye activos + inhabilitados)`],
      [`Inhabilitados: ${todosInhabilitados.length} · resaltados con columna ESTADO`],
      [],
      ["MÉTRICA", "TOTAL", "PERSONAL CONTRATADO", "REP. Y CONDUCTOR", "SUBCONTRATISTA"],
      ["Total registros", kpis.total, todosPC.length, todosRYC.length, todosSUB.length],
      ["Certificados", kpis.certificados,
        todosPC.filter(d => d.estado_final === "CERTIFICADO").length,
        todosRYC.filter(d => d.estado_final === "CERTIFICADO").length,
        todosSUB.filter(d => d.estado_final === "CERTIFICADO").length],
      ["Pendientes (parcial)", kpis.parciales,
        todosPC.filter(d => d.estado_final === "PENDIENTE").length,
        todosRYC.filter(d => d.estado_final === "PENDIENTE").length,
        todosSUB.filter(d => d.estado_final === "PENDIENTE").length],
      ["Sin certificar", kpis.sinCert,
        todosPC.filter(d => d.estado_final === "NO_CERTIFICADO").length,
        todosRYC.filter(d => d.estado_final === "NO_CERTIFICADO").length,
        todosSUB.filter(d => d.estado_final === "NO_CERTIFICADO").length],
      ["Inhabilitados", kpis.inhabilitados,
        todosPC.filter(d => d.recurso_inhabilitado).length,
        todosRYC.filter(d => d.recurso_inhabilitado).length,
        todosSUB.filter(d => d.recurso_inhabilitado).length],
      ["% Avance",
        `${kpis.pctAvance}%`,
        `${todosPC.length ? Math.round(todosPC.filter(d => d.estado_final === "CERTIFICADO").length / todosPC.length * 100) : 0}%`,
        `${todosRYC.length ? Math.round(todosRYC.filter(d => d.estado_final === "CERTIFICADO").length / todosRYC.length * 100) : 0}%`,
        `${todosSUB.length ? Math.round(todosSUB.filter(d => d.estado_final === "CERTIFICADO").length / todosSUB.length * 100) : 0}%`],
      [],
      ["🚨 ACTIVOS CRÍTICOS (con retención)", activosCriticos.length],
    ];
    const wsResumen = window.XLSX.utils.aoa_to_sheet(resumen);
    wsResumen["!cols"] = [{ wch: 30 }, { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "RESUMEN");

    // Helper
    const construirHoja = (filas, headers, mapFn) => {
      const datos2D = [headers, ...filas.map(mapFn)];
      const ws = window.XLSX.utils.aoa_to_sheet(datos2D);
      ws["!cols"] = headers.map(h => ({ wch: Math.max(h.length + 2, 14) }));
      return ws;
    };

    const headersPC = ["AÑO","MES","CERTIFICACIÓN","OPERACIÓN","TRANSPORTE","E-MAIL","ESTADO CONTRATISTA",
                       "F30","F30-1","LIQUIDACIONES","COTIZACIONES","MUTUALIDAD",
                       "% RETENCIÓN","% AVANCE","ESTADO CERT.","EMPLEADOS ACTIVOS","VEHÍCULOS ACTIVOS","OBSERVACIONES"];
    const wsPC = construirHoja(todosPC, headersPC, d => [
      d.anio, d.mes, nombreMes, d.operacion || "", d.transporte || "", d.email || "",
      d.recurso_inhabilitado ? "INHABILITADO" : "Activo",
      d.doc_f30 || "—", d.doc_f30_1 || "—", d.doc_liquidaciones || "—",
      d.doc_cotizaciones || "—", d.doc_mutualidad || "—",
      d.pct_retencion ? `${d.pct_retencion}%` : "—",
      d.pct_avance != null ? `${d.pct_avance}%` : "—",
      d.estado_final || "—", d.empleados_activos || 0, d.vehiculos_activos || 0,
      d.anomalia_descripcion || "",
    ]);
    XLSX.utils.book_append_sheet(wb, wsPC, "Personal Contratado");

    const headersRYC = ["AÑO","MES","CERTIFICACIÓN","OPERACIÓN","TRANSPORTE","E-MAIL","ESTADO CONTRATISTA",
                        "F30","MUTUALIDAD","% RETENCIÓN","% AVANCE","ESTADO CERT.","EMPLEADOS ACTIVOS","VEHÍCULOS ACTIVOS"];
    const wsRYC = construirHoja(todosRYC, headersRYC, d => [
      d.anio, d.mes, nombreMes, d.operacion || "", d.transporte || "", d.email || "",
      d.recurso_inhabilitado ? "INHABILITADO" : "Activo",
      d.doc_f30 || "—", d.doc_mutualidad || "—",
      d.pct_retencion ? `${d.pct_retencion}%` : "—",
      d.pct_avance != null ? `${d.pct_avance}%` : "—",
      d.estado_final || "—", d.empleados_activos || 0, d.vehiculos_activos || 0,
    ]);
    XLSX.utils.book_append_sheet(wb, wsRYC, "Representante y Conductor");

    const headersSUB = ["AÑO","MES","CERTIFICACIÓN","OPERACIÓN","TRANSPORTE","SUBCONTRATISTA","ESTADO CONTRATISTA",
                        "FECHA INGRESO","BOLETA HON.","COMP. PAGO",
                        "% RETENCIÓN","% AVANCE","ESTADO CERT.","OBSERVACIONES"];
    const wsSUB = construirHoja(todosSUB, headersSUB, d => [
      d.anio, d.mes, nombreMes, d.operacion || "", d.transporte || "", d.subcontratista_nombre || "",
      d.recurso_inhabilitado ? "INHABILITADO" : "Activo",
      d.fecha_ingreso || "—", d.doc_boleta_honorarios || "—", d.doc_comprobante_pago || "—",
      d.pct_retencion ? `${d.pct_retencion}%` : "—",
      d.pct_avance != null ? `${d.pct_avance}%` : "—",
      d.estado_final || "—", d.anomalia_descripcion || "",
    ]);
    XLSX.utils.book_append_sheet(wb, wsSUB, "Subcontratista");

    // ACTIVOS CRÍTICOS
    const headersCrit = ["TRANSPORTE","CATEGORÍA","OPERACIÓN","SUBCONTRATISTA","E-MAIL",
                         "EMPLEADOS","VEHÍCULOS","% RETENCIÓN","% AVANCE","ESTADO"];
    const wsCrit = construirHoja(activosCriticos, headersCrit, d => [
      d.transporte || "", d.categoria, d.operacion || "", d.subcontratista_nombre || "", d.email || "",
      d.empleados_activos || 0, d.vehiculos_activos || 0,
      d.pct_retencion ? `${d.pct_retencion}%` : "—",
      d.pct_avance != null ? `${d.pct_avance}%` : "—",
      d.estado_final || "—",
    ]);
    XLSX.utils.book_append_sheet(wb, wsCrit, "🚨 ACTIVOS CRÍTICOS");

    window.XLSX.writeFile(wb, `Certificacion_Bigticket_${nombreMes}_${anio}.xlsx`);
  };

  // ─── Helpers de UI ───
  // 🆕 Versión modificada que acepta contexto para click→modal y muestra indicador de override
  const renderIconoDoc = (estado, ctx = null) => {
    // ctx: { contratista, categoria, subcontratista, docCampo, docLabel, fechaSnapshot }
    const conf = {
      VALIDADO: { ico: "✓", color: "#16a34a", bg: "#dcfce7", titulo: "Validado" },
      RECEPCIONADO: { ico: "◐", color: "#1e40af", bg: "#dbeafe", titulo: "Recepcionado" },
      ENVIADO: { ico: "↗", color: "#3730a3", bg: "#e0e7ff", titulo: "Enviado" },
      PENDIENTE: { ico: "⏳", color: "#92400e", bg: "#fef3c7", titulo: "Pendiente" },
      NO_APLICA: { ico: "—", color: "#94a3b8", bg: "#f1f5f9", titulo: "No aplica" },
    };
    
    // ¿Hay override activo para este doc?
    let override = null;
    let estadoMostrar = estado;
    if (ctx) {
      const k = overrideKey(ctx.contratista, ctx.categoria, ctx.subcontratista, ctx.docCampo);
      override = overrides.get(k);
      if (override) {
        estadoMostrar = override.estado_override;
      }
    }
    
    const c = conf[estadoMostrar] || { ico: "?", color: "#64748b", bg: "#f1f5f9", titulo: estadoMostrar || "Sin dato" };
    
    // Tooltip con info del override
    let tooltip = c.titulo;
    if (override) {
      tooltip = `OVERRIDE ANALISTA\nEstado Certronic: ${conf[estado]?.titulo || estado || "—"}\nEstado override: ${c.titulo}\nMotivo: ${override.motivo}\nEditado: ${override.fecha_cambio}`;
    }
    
    const clickeable = !!ctx;
    
    return (
      <div 
        title={tooltip} 
        onClick={clickeable ? (e) => {
          e.stopPropagation();
          setModalOverride({
            contratista: ctx.contratista,
            categoria: ctx.categoria,
            subcontratista: ctx.subcontratista,
            docCampo: ctx.docCampo,
            docLabel: ctx.docLabel,
            estadoCertronic: estado,
            fechaSnapshot: ctx.fechaSnapshot,
            overrideExistente: override || null,
          });
        } : undefined}
        style={{
          width: 28, height: 28, borderRadius: 6,
          background: c.bg, color: c.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, margin: "0 auto",
          cursor: clickeable ? "pointer" : "default",
          position: "relative",
          border: override ? "2px solid #f59e0b" : undefined,
        }}>
        {c.ico}
        {override && (
          <span style={{
            position: "absolute", top: -3, right: -3,
            width: 10, height: 10, borderRadius: "50%",
            background: "#f59e0b", border: "2px solid #fff",
          }} title="Editado por analista" />
        )}
      </div>
    );
  };

  const renderEstadoFinal = (estado) => {
    const conf = {
      CERTIFICADO: { label: "✓ Certificado", bg: "#dcfce7", color: "#166534" },
      PENDIENTE: { label: "⏳ Parcial", bg: "#fef3c7", color: "#92400e" },
      NO_CERTIFICADO: { label: "✗ Sin cert.", bg: "#fee2e2", color: "#c0392b" },
    };
    const c = conf[estado] || { label: estado || "—", bg: "#f1f5f9", color: "#64748b" };
    return (
      <span style={{
        display: "inline-block", padding: "3px 10px", borderRadius: 12,
        fontSize: 11, fontWeight: 600, background: c.bg, color: c.color, whiteSpace: "nowrap",
      }}>{c.label}</span>
    );
  };

  const toggleOrden = (col) => {
    if (ordenCol === col) setOrdenAsc(!ordenAsc);
    else { setOrdenCol(col); setOrdenAsc(true); }
  };
  const flecha = (col) => ordenCol === col ? (ordenAsc ? " ▲" : " ▼") : "";

  // ── RENDER ──
  return (
    <div className="pg" style={{ paddingBottom: 40 }}>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">Pagos · Certificación Documental</div>
          <div className="sec-sub">
            {empresasActivasUnicas} empresas activas · {empresasInhabilitadasUnicas} inhabilitadas · {operacionesUnicas.length} operaciones
            {(() => {
              const ok = ultimaCorridaConDatos(corridas);
              if (!ok) return null;
              return <> · Datos al {new Date(ok.fecha_run).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</>;
            })()}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ width: "auto", minWidth: 150 }}>
            {periodos.map((p, idx) => {
              const [a, m] = p.split("-");
              const nm = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"][parseInt(m)];
              // El primero (más reciente) se marca como vigente
              const esVigente = idx === 0;
              const label = esVigente ? `🟢 ${nm} ${a} (vigente)` : `${nm} ${a}`;
              return <option key={p} value={p}>{label}</option>;
            })}
          </select>
        </div>
      </div>

      {/* Aviso de actualización de Certronic */}
      {!avisoOculto && (
        <AvisoActualizacion corridas={corridas} tecnico={esTecnico} onOcultar={() => setAvisoOculto(true)} />
      )}

      {/* TABS de vista principal */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "2px solid #e4e7ec", flexWrap: "wrap" }}>
        {[
          { id: "inicial", label: "Dashboard Inicial", n: null },
          { id: "dashboard", label: "Dashboard Mensual", n: kpis.total },
          { id: "empleados", label: "Empleados", n: null },
          { id: "vehiculos", label: "Vehículos", n: null },
          { id: "criticos", label: "Activos Críticos", n: activosCriticos.length, alert: activosCriticos.length > 0 },
          { id: "hallazgos", label: "Hallazgos", n: null },
          { id: "rse", label: "🛡️ Riesgo RSE", n: null },
          { id: "historico", label: "📊 Histórico", n: null },
          { id: "matriz", label: "Matriz Documentos", n: null },
        ].map(t => (
          <button key={t.id} onClick={() => setVistaActiva(t.id)}
            style={{
              padding: "10px 14px", border: "none", cursor: "pointer",
              borderBottom: vistaActiva === t.id ? "3px solid #002E5D" : "3px solid transparent",
              background: "transparent",
              color: vistaActiva === t.id ? "#002E5D" : (t.alert ? "#c0392b" : t.warn ? "#92400e" : "#666"),
              fontWeight: vistaActiva === t.id ? 700 : 500,
              fontSize: 13, fontFamily: "'Open Sans', sans-serif",
              marginBottom: -2,
            }}>
            {t.label}
            {t.n != null && <span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 600 }}>({t.n})</span>}
          </button>
        ))}
      </div>

      {loading && <div className="loading">Cargando datos…</div>}

      {!loading && (
        <>
          {/* ─── VISTA: DASHBOARD ─── */}
          {vistaActiva === "dashboard" && (
            <DashboardCertificacion
              datos={datos}
              kpis={kpis}
              empresasActivasUnicas={empresasActivasUnicas}
              empresasInhabilitadasUnicas={empresasInhabilitadasUnicas}
              tabCategoria={tabCategoria} setTabCategoria={setTabCategoria}
              busqueda={busqueda} setBusqueda={setBusqueda}
              filtroEstado={filtroEstado} setFiltroEstado={setFiltroEstado}
              filtroMandante={filtroMandante} setFiltroMandante={setFiltroMandante}
              filtroActivo={filtroActivo} setFiltroActivo={setFiltroActivo}
              operacionesUnicas={operacionesUnicas}
              datosCategoriaActual={datosCategoriaActual}
              docsPorCategoria={docsPorCategoria}
              renderIconoDoc={renderIconoDoc} renderEstadoFinal={renderEstadoFinal}
              toggleOrden={toggleOrden} flecha={flecha}
              operacionAMandante={operacionAMandante}
              cumplInicial={cumplInicial}
            />
          )}

          {/* ─── VISTA: DASHBOARD INICIAL (NUEVO) ─── */}
          {vistaActiva === "inicial" && <DashboardInicial />}

          {/* ─── VISTA: EMPLEADOS (NUEVO) ─── */}
          {vistaActiva === "empleados" && <DashboardEmpleados />}

          {/* ─── VISTA: VEHÍCULOS (NUEVO) ─── */}
          {vistaActiva === "vehiculos" && <DashboardVehiculos />}

          {/* ─── VISTA: ACTIVOS CRÍTICOS ─── */}
          {vistaActiva === "criticos" && (
            <ActivosCriticos
              activosCriticos={activosCriticos}
              renderEstadoFinal={renderEstadoFinal}
              operacionAMandante={operacionAMandante}
            />
          )}

          {/* ─── VISTA: HALLAZGOS ─── */}
          {vistaActiva === "hallazgos" && (
            <HallazgosAutomaticos
              datos={datos}
              activosCriticos={activosCriticos}
              todosInhabilitados={todosInhabilitados}
              empresasInhabilitadasUnicas={empresasInhabilitadasUnicas}
              operacionAMandante={operacionAMandante}
            />
          )}

          {/* ─── VISTA: RIESGO RSE (NUEVO) ─── */}
          {vistaActiva === "rse" && <DashboardRiesgoRSE />}

          {/* ─── VISTA: HISTÓRICO (NUEVO - Sprint 3 Fase B.2) ─── */}
          {vistaActiva === "historico" && <DashboardHistorico operacionAMandante={operacionAMandante} />}

          {/* ─── VISTA: MATRIZ ─── */}
          {vistaActiva === "matriz" && <EditorMatriz />}
        </>
      )}
      
      {/* 🆕 MODAL DE OVERRIDE DEL ANALISTA */}
      {modalOverride && (
        <ModalOverride
          contexto={modalOverride}
          onClose={() => setModalOverride(null)}
          onGuardar={async (datos) => {
            const ok = await guardarOverride({
              contratista: modalOverride.contratista,
              categoria: modalOverride.categoria,
              subcontratista: modalOverride.subcontratista,
              docCampo: modalOverride.docCampo,
              estadoCertronic: modalOverride.estadoCertronic,
              fechaSnapshot: modalOverride.fechaSnapshot,
              estadoOverride: datos.estado,
              motivo: datos.motivo,
              fechaCambio: datos.fecha,
            });
            if (ok) setModalOverride(null);
          }}
          onQuitar={async () => {
            if (modalOverride.overrideExistente) {
              await quitarOverride(modalOverride.overrideExistente);
              setModalOverride(null);
            }
          }}
        />
      )}
    </div>
  );
}

export default ModuloPagos;

