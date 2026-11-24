import { useEffect, useMemo, useState } from "react";
import { sb } from "../../shared";
import { btnIcon, inputMini, lbl, tdE2, thE2, thE2L } from "./comun";

export function EditorMatriz() {
  const [reglas, setReglas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroMandante, setFiltroMandante] = useState("todos");
  const [filtroCategoria, setFiltroCategoria] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState(null); // id de la regla en edición
  const [formNueva, setFormNueva] = useState(null); // datos del form para nueva regla
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await sb.from("certronic_matriz_documentos")
        .select("*")
        .is("fecha_fin_vigencia", null)
        .order("mandante")
        .order("categoria")
        .order("doc_nombre");
      setReglas(data || []);
    } catch(e) {
      console.error(e);
      alert("Error cargando matriz: " + e.message);
    }
    setLoading(false);
  };

  const mandantes = useMemo(() => {
    return [...new Set(reglas.map(r => r.mandante))].sort();
  }, [reglas]);

  const reglasFiltradas = useMemo(() => {
    let arr = reglas;
    if (filtroMandante !== "todos") arr = arr.filter(r => r.mandante === filtroMandante);
    if (filtroCategoria !== "todos") arr = arr.filter(r => r.categoria === filtroCategoria);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      arr = arr.filter(r =>
        (r.doc_nombre || "").toLowerCase().includes(q) ||
        (r.observaciones || "").toLowerCase().includes(q)
      );
    }
    return arr;
  }, [reglas, filtroMandante, filtroCategoria, busqueda]);

  const guardarEdicion = async (regla) => {
    setGuardando(true);
    try {
      const { error } = await sb.from("certronic_matriz_documentos")
        .update({
          pct_retencion: Number(regla.pct_retencion) || 0,
          impide_acceso: regla.impide_acceso,
          impide_pago: regla.impide_pago,
          criticidad: regla.criticidad,
          periodicidad: regla.periodicidad,
          observaciones: regla.observaciones,
        })
        .eq("id", regla.id);
      if (error) throw error;
      setEditando(null);
      await cargar();
    } catch(e) {
      alert("Error guardando: " + e.message);
    }
    setGuardando(false);
  };

  const eliminarRegla = async (id) => {
    if (!confirm("¿Marcar esta regla como no vigente? (no se borra, queda histórica)")) return;
    setGuardando(true);
    try {
      const { error } = await sb.from("certronic_matriz_documentos")
        .update({ fecha_fin_vigencia: new Date().toISOString().slice(0, 10) })
        .eq("id", id);
      if (error) throw error;
      await cargar();
    } catch(e) {
      alert("Error: " + e.message);
    }
    setGuardando(false);
  };

  const guardarNueva = async () => {
    if (!formNueva.mandante || !formNueva.doc_nombre || !formNueva.categoria) {
      alert("Mandante, categoría y nombre del documento son obligatorios.");
      return;
    }
    setGuardando(true);
    try {
      const { error } = await sb.from("certronic_matriz_documentos").insert([{
        mandante: formNueva.mandante,
        categoria: formNueva.categoria,
        doc_codigo: formNueva.doc_codigo || null,
        doc_nombre: formNueva.doc_nombre,
        doc_nombre_norm: (formNueva.doc_nombre || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(),
        periodicidad: formNueva.periodicidad,
        criticidad: formNueva.criticidad,
        impide_acceso: formNueva.impide_acceso,
        impide_pago: formNueva.impide_pago,
        pct_retencion: Number(formNueva.pct_retencion) || 0,
        observaciones: formNueva.observaciones || null,
        fecha_inicio_vigencia: new Date().toISOString().slice(0, 10),
      }]);
      if (error) throw error;
      setFormNueva(null);
      await cargar();
    } catch(e) {
      alert("Error: " + e.message);
    }
    setGuardando(false);
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#002E5D" }}>Matriz de Documentos por Mandante</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            Reglas de qué documentos exige cada mandante y % de retención. {reglas.length} reglas vigentes.
          </div>
        </div>
        <button className="btn-blue" onClick={() => setFormNueva({
          mandante: mandantes[0] || "",
          categoria: "Empresa",
          doc_codigo: "",
          doc_nombre: "",
          periodicidad: "Mensual",
          criticidad: "Alta",
          impide_acceso: "NO",
          impide_pago: "SI",
          pct_retencion: 0.10,
          observaciones: "",
        })}>
          + Nueva regla
        </button>
      </div>

      {/* Filtros */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 200px", gap: 8, marginBottom: 12 }}>
        <input placeholder="🔎 Buscar documento..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <select value={filtroMandante} onChange={(e) => setFiltroMandante(e.target.value)}>
          <option value="todos">Todos los mandantes</option>
          {mandantes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
          <option value="todos">Todas las categorías</option>
          <option value="Empresa">Empresa</option>
          <option value="Trabajador">Trabajador</option>
          <option value="Vehiculo">Vehículo</option>
        </select>
      </div>

      {/* Form nueva regla (modal inline) */}
      {formNueva && (
        <FormNuevaRegla
          formNueva={formNueva}
          setFormNueva={setFormNueva}
          mandantes={mandantes}
          guardando={guardando}
          onGuardar={guardarNueva}
          onCancelar={() => setFormNueva(null)}
        />
      )}

      {loading ? (
        <div className="loading">Cargando matriz…</div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: "60vh", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
              <tr style={{ background: "#002E5D", color: "#fff" }}>
                <th style={thE2L}>Mandante</th>
                <th style={thE2L}>Categoría</th>
                <th style={thE2L}>Documento</th>
                <th style={thE2}>Periodicidad</th>
                <th style={thE2}>Criticidad</th>
                <th style={thE2}>Imp.Acc</th>
                <th style={thE2}>Imp.Pago</th>
                <th style={thE2}>% Reten.</th>
                <th style={thE2}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {reglasFiltradas.map((r, i) => (
                <FilaRegla key={r.id} regla={r} index={i}
                  editando={editando === r.id}
                  onEditar={() => setEditando(r.id)}
                  onCancelar={() => setEditando(null)}
                  onGuardar={guardarEdicion}
                  onEliminar={() => eliminarRegla(r.id)}
                  guardando={guardando} />
              ))}
            </tbody>
          </table>
          {reglasFiltradas.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "#888", fontSize: 12 }}>
              No hay reglas que coincidan con los filtros.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-componente: Fila de regla (con modo edición inline) ────────
function FilaRegla({ regla, index, editando, onEditar, onCancelar, onGuardar, onEliminar, guardando }) {
  const [edit, setEdit] = useState(regla);
  useEffect(() => { setEdit(regla); }, [regla, editando]);

  if (!editando) {
    return (
      <tr style={{ borderBottom: "1px solid #f0f0f0", background: index % 2 === 0 ? "#fff" : "#fafbfc" }}>
        <td style={{...tdE2, fontWeight: 600, color: "#002E5D"}}>{regla.mandante}</td>
        <td style={tdE2}>{regla.categoria}</td>
        <td style={{...tdE2, textAlign: "left"}}>
          {regla.doc_codigo && <span style={{ fontSize: 9, color: "#94a3b8", marginRight: 4 }}>{regla.doc_codigo}</span>}
          {regla.doc_nombre}
          {regla.observaciones && <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{regla.observaciones}</div>}
        </td>
        <td style={tdE2}>{regla.periodicidad || "—"}</td>
        <td style={tdE2}>{regla.criticidad || "—"}</td>
        <td style={tdE2}>{regla.impide_acceso === "SI" ? "✓" : "✗"}</td>
        <td style={tdE2}>{regla.impide_pago === "SI" ? "✓" : "✗"}</td>
        <td style={{...tdE2, fontWeight: 700, color: regla.pct_retencion > 0 ? "#c0392b" : "#94a3b8"}}>
          {regla.pct_retencion ? `${Math.round(regla.pct_retencion * 100)}%` : "—"}
        </td>
        <td style={tdE2}>
          <button onClick={onEditar} style={btnIcon}>✏️</button>
          <button onClick={onEliminar} style={{...btnIcon, color: "#c0392b"}}>🗑</button>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ background: "#fef3c7", borderBottom: "2px solid #fbbf24" }}>
      <td style={tdE2}>{regla.mandante}</td>
      <td style={tdE2}>{regla.categoria}</td>
      <td style={{...tdE2, textAlign: "left", fontSize: 11}}>{regla.doc_nombre}</td>
      <td style={tdE2}>
        <select value={edit.periodicidad || ""} onChange={(e) => setEdit({...edit, periodicidad: e.target.value})}
          style={inputMini}>
          <option value="">—</option>
          <option value="Mensual">Mensual</option>
          <option value="Anual">Anual</option>
          <option value="Inicial">Inicial</option>
          <option value="Esporadico">Esporádico</option>
          <option value="Con Vencimiento">Con Vencimiento</option>
          <option value="Presentación Única">Presentación Única</option>
          <option value="Cese">Cese</option>
        </select>
      </td>
      <td style={tdE2}>
        <select value={edit.criticidad || ""} onChange={(e) => setEdit({...edit, criticidad: e.target.value})}
          style={inputMini}>
          <option value="">—</option>
          <option value="Alta">Alta</option>
          <option value="Media">Media</option>
          <option value="Baja">Baja</option>
        </select>
      </td>
      <td style={tdE2}>
        <select value={edit.impide_acceso || ""} onChange={(e) => setEdit({...edit, impide_acceso: e.target.value})}
          style={inputMini}>
          <option value="">—</option>
          <option value="SI">SI</option>
          <option value="NO">NO</option>
        </select>
      </td>
      <td style={tdE2}>
        <select value={edit.impide_pago || ""} onChange={(e) => setEdit({...edit, impide_pago: e.target.value})}
          style={inputMini}>
          <option value="">—</option>
          <option value="SI">SI</option>
          <option value="NO">NO</option>
        </select>
      </td>
      <td style={tdE2}>
        <input type="number" step="0.01" min="0" max="1"
          value={edit.pct_retencion || 0}
          onChange={(e) => setEdit({...edit, pct_retencion: e.target.value})}
          style={{...inputMini, width: 70}} />
        <div style={{ fontSize: 9, color: "#64748b" }}>0.10 = 10%</div>
      </td>
      <td style={tdE2}>
        <button onClick={() => onGuardar(edit)} disabled={guardando} style={{...btnIcon, color: "#16a34a"}}>💾</button>
        <button onClick={onCancelar} style={btnIcon}>✗</button>
      </td>
    </tr>
  );
}

// ─── Sub-componente: Form nueva regla ────────────────────────────────
function FormNuevaRegla({ formNueva, setFormNueva, mandantes, guardando, onGuardar, onCancelar }) {
  const [nuevoMandante, setNuevoMandante] = useState(false);
  return (
    <div style={{
      background: "#eef2ff", border: "2px solid #3b82f6", borderRadius: 8,
      padding: 14, marginBottom: 14,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e40af", marginBottom: 10 }}>
        + Nueva regla en la matriz
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <div>
          <label style={lbl}>Mandante</label>
          {nuevoMandante ? (
            <div style={{ display: "flex", gap: 4 }}>
              <input value={formNueva.mandante} onChange={(e) => setFormNueva({...formNueva, mandante: e.target.value})}
                placeholder="Nombre del mandante" />
              <button onClick={() => setNuevoMandante(false)} style={btnIcon}>↩</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 4 }}>
              <select value={formNueva.mandante} onChange={(e) => setFormNueva({...formNueva, mandante: e.target.value})}>
                {mandantes.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <button onClick={() => { setFormNueva({...formNueva, mandante: ""}); setNuevoMandante(true); }} 
                style={btnIcon} title="Crear nuevo mandante">+</button>
            </div>
          )}
        </div>
        <div>
          <label style={lbl}>Categoría</label>
          <select value={formNueva.categoria} onChange={(e) => setFormNueva({...formNueva, categoria: e.target.value})}>
            <option value="Empresa">Empresa</option>
            <option value="Trabajador">Trabajador</option>
            <option value="Vehiculo">Vehículo</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Código (opcional)</label>
          <input value={formNueva.doc_codigo || ""} onChange={(e) => setFormNueva({...formNueva, doc_codigo: e.target.value})}
            placeholder="ej: 1.1" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>Nombre del documento *</label>
          <input value={formNueva.doc_nombre} onChange={(e) => setFormNueva({...formNueva, doc_nombre: e.target.value})}
            placeholder="ej: Certificado de Antecedentes" />
        </div>
        <div>
          <label style={lbl}>Periodicidad</label>
          <select value={formNueva.periodicidad} onChange={(e) => setFormNueva({...formNueva, periodicidad: e.target.value})}>
            <option value="Mensual">Mensual</option>
            <option value="Anual">Anual</option>
            <option value="Inicial">Inicial</option>
            <option value="Esporadico">Esporádico</option>
            <option value="Con Vencimiento">Con Vencimiento</option>
            <option value="Presentación Única">Presentación Única</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Criticidad</label>
          <select value={formNueva.criticidad} onChange={(e) => setFormNueva({...formNueva, criticidad: e.target.value})}>
            <option value="Alta">Alta</option>
            <option value="Media">Media</option>
            <option value="Baja">Baja</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Impide Acceso</label>
          <select value={formNueva.impide_acceso} onChange={(e) => setFormNueva({...formNueva, impide_acceso: e.target.value})}>
            <option value="SI">SI</option>
            <option value="NO">NO</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Impide Pago</label>
          <select value={formNueva.impide_pago} onChange={(e) => setFormNueva({...formNueva, impide_pago: e.target.value})}>
            <option value="SI">SI</option>
            <option value="NO">NO</option>
          </select>
        </div>
        <div>
          <label style={lbl}>% Retención (0-1)</label>
          <input type="number" step="0.01" min="0" max="1"
            value={formNueva.pct_retencion}
            onChange={(e) => setFormNueva({...formNueva, pct_retencion: e.target.value})} />
          <div style={{ fontSize: 9, color: "#64748b" }}>0.10 = 10%</div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>Observaciones</label>
          <input value={formNueva.observaciones || ""} onChange={(e) => setFormNueva({...formNueva, observaciones: e.target.value})}
            placeholder="opcional" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button onClick={onCancelar} className="btn-back">Cancelar</button>
        <button onClick={onGuardar} className="btn-blue" disabled={guardando}>
          {guardando ? "⏳..." : "💾 Crear regla"}
        </button>
      </div>
    </div>
  );
}
