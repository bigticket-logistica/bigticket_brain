// ═══════════════════════════════════════════════════════════════════════════
// BIGTICKET CHILE · Editor de mapa de las Zonas de Pago
// Requiere:  "leaflet": "^1.9.4" en package.json
// ---------------------------------------------------------------------------
// · Al abrir, encuadra automáticamente todas las zonas existentes.
// · El selector de CECOS filtra las zonas visibles y acerca el mapa a ellas.
// · "Ver entregas" pinta en verde dónde se entregó de verdad (últimos 7 días),
//   para dibujar sobre datos y no a ojo. Disponible en cualquier modo.
// · CÍRCULO: un click fija el centro; el radio se ajusta con el control.
// · POLÍGONO: cada click agrega un vértice; se guarda con 3 o más.
// No usa L.marker (sus PNG no se resuelven con Vite y aparecen descolocados):
// todo se dibuja con circleMarker, que es vectorial.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, Fragment } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const NAVY = "#1a3a6b", ORANGE = "#F47B20", AMBAR = "#b45309", VIOLETA = "#5b21b6";
const VERDE = "#0d8043";

export default function MapaZonas({ zonas, segmentaciones, api, onCerrar, onCreada }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const capaZonas = useRef(null);
  const capaDibujo = useRef(null);
  const capaPuntos = useRef(null);

  const [modo, setModo] = useState("ver");
  const [cecosVista, setCecosVista] = useState("");        // filtro de zonas visibles
  const [centro, setCentro] = useState(null);
  const [radio, setRadio] = useState(5000);
  const [vertices, setVertices] = useState([]);
  const [form, setForm] = useState({ nombre: "", segmentacion: "" });
  const [guardando, setGuardando] = useState(false);
  const [puntosOn, setPuntosOn] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState("");

  const modoRef = useRef(modo);   modoRef.current = modo;
  const radioRef = useRef(radio); radioRef.current = radio;

  const codigos = [...new Set(zonas.map(z => z.codigo_meli).filter(Boolean))].sort();

  // ── montaje ──
  useEffect(() => {
    const mapa = L.map(divRef.current, { center: [-35, -71], zoom: 5 });
    const calles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapa);
    const satelite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Imagery © Esri" });
    L.control.layers({ "Calles": calles, "Satélite": satelite }, null,
                     { position: "topright", collapsed: false }).addTo(mapa);

    capaZonas.current = L.layerGroup().addTo(mapa);
    capaPuntos.current = L.layerGroup().addTo(mapa);
    capaDibujo.current = L.layerGroup().addTo(mapa);
    mapRef.current = mapa;

    mapa.on("click", (e) => {
      const { lat, lng } = e.latlng;
      if (modoRef.current === "circulo") {
        setCentro({ lat: +lat.toFixed(5), lon: +lng.toFixed(5) });
      } else if (modoRef.current === "poligono") {
        setVertices(v => [...v, [+lat.toFixed(5), +lng.toFixed(5)]]);
      }
    });

    // el mapa arranca mostrando el tamaño correcto aunque el modal recién se abra
    setTimeout(() => mapa.invalidateSize(), 60);
    return () => mapa.remove();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── pintar las zonas y encuadrarlas ──
  useEffect(() => {
    const mapa = mapRef.current;
    if (!mapa || !capaZonas.current) return;
    capaZonas.current.clearLayers();
    const visibles = zonas.filter(z => !cecosVista || z.codigo_meli === cecosVista);
    const bordes = [];
    for (const z of visibles) {
      const color = z.segmentacion ? NAVY : AMBAR;
      const ficha = `<strong>${z.nombre}</strong><br/>${z.codigo_meli || ""} · ` +
        `${z.segmentacion || "<span style='color:#b45309'>SIN SEGMENTACIÓN</span>"}` +
        (z.cecos_admin ? `<br/>${z.cecos_admin}` : "") +
        (z.tipo_geo === "circulo" ? `<br/>radio ${Number(z.radio_m).toLocaleString("es-CL")} m` : "<br/>polígono") +
        `<br/>${Number(z.paquetes_ayer || 0).toLocaleString("es-CL")} paq. ayer`;
      if (z.tipo_geo === "circulo" && z.lat != null) {
        const c = L.circle([z.lat, z.lon], { radius: z.radio_m, color, weight: 1.6, fillOpacity: 0.08 })
          .bindPopup(ficha).addTo(capaZonas.current);
        bordes.push(c.getBounds());
      } else if (z.poligono_geojson) {
        try {
          const g = L.geoJSON(JSON.parse(z.poligono_geojson),
            { style: { color: VIOLETA, weight: 2, fillOpacity: 0.12 } })
            .bindPopup(ficha).addTo(capaZonas.current);
          bordes.push(g.getBounds());
        } catch { /* geojson inválido */ }
      }
    }
    if (bordes.length) {
      const todo = bordes.reduce((a, b) => a.extend(b), L.latLngBounds(bordes[0].getSouthWest(), bordes[0].getNorthEast()));
      mapa.fitBounds(todo, { padding: [30, 30], maxZoom: 12 });
    }
  }, [zonas, cecosVista]);

  // ── redibujar lo que se está creando ──
  useEffect(() => {
    if (!capaDibujo.current) return;
    capaDibujo.current.clearLayers();
    if (modo === "circulo" && centro) {
      L.circle([centro.lat, centro.lon], { radius: radio, color: ORANGE, weight: 2.5, fillOpacity: 0.18 })
        .addTo(capaDibujo.current);
      L.circleMarker([centro.lat, centro.lon],
        { radius: 5, color: "#fff", weight: 2, fillColor: ORANGE, fillOpacity: 1 }).addTo(capaDibujo.current);
    } else if (modo === "poligono" && vertices.length) {
      if (vertices.length >= 3) {
        L.polygon(vertices, { color: ORANGE, weight: 2.5, fillOpacity: 0.18 }).addTo(capaDibujo.current);
      } else {
        L.polyline(vertices, { color: ORANGE, weight: 2.5, dashArray: "6 5" }).addTo(capaDibujo.current);
      }
      vertices.forEach(p => L.circleMarker(p,
        { radius: 5, color: "#fff", weight: 2, fillColor: ORANGE, fillOpacity: 1 }).addTo(capaDibujo.current));
    }
  }, [modo, centro, radio, vertices]);

  const limpiar = () => { setCentro(null); setVertices([]); };
  const cambiarModo = (m) => { setModo(m); limpiar(); setMsg(""); };

  // ── entregas reales ──
  const verEntregas = async () => {
    if (puntosOn) { capaPuntos.current.clearLayers(); setPuntosOn(false); setMsg(""); return; }
    if (!cecosVista) { setMsg("Elige un CECOS arriba para ver sus entregas."); return; }
    setCargando(true);
    try {
      const desde = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const d = await api(`vw_puntos_entrega?codigo_meli=eq.${cecosVista}&fecha_operativa=gte.${desde}&limit=4000`);
      capaPuntos.current.clearLayers();
      for (const pt of d) {
        L.circleMarker([pt.lat, pt.lon], {
          radius: Math.min(8, 2 + Math.log2(pt.paquetes + 1)),
          color: VERDE, weight: 1, fillColor: "#22c55e", fillOpacity: 0.6,
        }).bindTooltip(`${pt.paquetes} paq · ${pt.comunas || ""}`).addTo(capaPuntos.current);
      }
      setPuntosOn(true);
      setMsg(d.length ? `${d.length} puntos de entrega · ${cecosVista} · últimos 7 días`
                      : `Sin entregas en 7 días para ${cecosVista}`);
    } catch (e) { setMsg("Error: " + e.message); }
    finally { setCargando(false); }
  };

  const CODIGO_OK = /^(S[A-Z]{2}\d|CL[A-Z]{2,3}\d{1,2})$/;
  const guardar = async () => {
    if (!form.nombre || !form.segmentacion) { setMsg("Completa nombre y segmentación."); return; }
    if (!cecosVista) { setMsg("Elige el CECOS arriba: la zona pertenece a un centro."); return; }
    if (!CODIGO_OK.test(cecosVista)) { setMsg(`"${cecosVista}" no es un código MELI válido.`); return; }
    if (modo === "circulo" && !centro) { setMsg("Haz click en el mapa para fijar el centro."); return; }
    if (modo === "poligono" && vertices.length < 3) { setMsg("El polígono necesita 3 vértices o más."); return; }
    setGuardando(true);
    try {
      if (modo === "circulo") {
        await api("rpc/crear_zona_pago", { method: "POST", body: JSON.stringify({
          p_nombre: form.nombre, p_cecos: cecosVista, p_segmentacion: form.segmentacion,
          p_lat: centro.lat, p_lon: centro.lon, p_radio_m: Number(radio),
          p_nota: "Dibujada en el mapa del Brain." }) });
      } else {
        await api("rpc/crear_zona_pago_poligono", { method: "POST", body: JSON.stringify({
          p_nombre: form.nombre, p_cecos: cecosVista, p_segmentacion: form.segmentacion,
          p_puntos: vertices }) });
      }
      setMsg(`✓ "${form.nombre}" creada en ${cecosVista}`);
      limpiar(); setForm({ nombre: "", segmentacion: "" });
      onCreada && onCreada();
    } catch (e) { setMsg("Error: " + e.message); }
    finally { setGuardando(false); }
  };

  const btn = (activo) => ({ padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
    cursor: "pointer", border: "1px solid " + (activo ? NAVY : "#dfe4ec"),
    background: activo ? NAVY : "#fff", color: activo ? "#fff" : "#475569" });
  const inp = { padding: "5px 8px", borderRadius: 6, border: "1px solid #dfe4ec", fontSize: 12 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 1000,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      {/* height definido: sin esto el mapa no tiene espacio donde crecer y queda angosto */}
      <div style={{ background: "#fff", borderRadius: 12, width: "min(1180px, 97vw)",
                    height: "min(92vh, 860px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <div style={{ padding: "11px 16px", display: "flex", gap: 9, alignItems: "center",
                      flexWrap: "wrap", borderBottom: "1px solid #eef1f5", flexShrink: 0 }}>
          <strong style={{ color: NAVY, fontSize: 14 }}>Zonas de pago</strong>
          <span style={btn(modo === "ver")}      onClick={() => cambiarModo("ver")}>Ver</span>
          <span style={btn(modo === "circulo")}  onClick={() => cambiarModo("circulo")}>⊕ Círculo</span>
          <span style={btn(modo === "poligono")} onClick={() => cambiarModo("poligono")}>▰ Polígono</span>
          <select value={cecosVista} onChange={e => { setCecosVista(e.target.value);
                    capaPuntos.current.clearLayers(); setPuntosOn(false); }} style={{ ...inp, minWidth: 130 }}>
            <option value="">Todos los CECOS</option>
            {codigos.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span style={btn(puntosOn)} onClick={verEntregas}
                title="Dónde se entregó de verdad en los últimos 7 días: dibuja sobre los datos">
            {cargando ? "…" : puntosOn ? "✓ Entregas" : "◉ Ver entregas"}
          </span>
          <span style={{ flex: 1 }} />
          <span style={btn(false)} onClick={onCerrar}>Cerrar</span>
        </div>

        {modo !== "ver" && (
          <div style={{ padding: "9px 16px", display: "flex", gap: 9, alignItems: "center",
                        flexWrap: "wrap", background: "#fdf6e3", borderBottom: "1px solid #f3e2b8",
                        flexShrink: 0 }}>
            <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                   placeholder="Nombre de la zona" style={{ ...inp, width: 150 }} />
            <select value={form.segmentacion} onChange={e => setForm(f => ({ ...f, segmentacion: e.target.value }))}
                    style={{ ...inp, minWidth: 150 }}>
              <option value="">— segmentación —</option>
              {segmentaciones.map(s => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)}
            </select>
            {modo === "circulo" && (
              <label style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" }}>
                radio {Number(radio).toLocaleString("es-CL")} m
                <input type="range" min={500} max={30000} step={250} value={radio}
                       onChange={e => setRadio(Number(e.target.value))}
                       style={{ verticalAlign: "middle", marginLeft: 6, width: 150 }} />
              </label>
            )}
            {modo === "poligono" && (
              <Fragment>
                <span style={{ fontSize: 11.5, color: "#64748b" }}>{vertices.length} vértices</span>
                <span style={btn(false)} onClick={() => setVertices(v => v.slice(0, -1))}>Deshacer</span>
              </Fragment>
            )}
            <span style={{ ...btn(true), padding: "6px 15px", opacity: guardando ? 0.6 : 1 }} onClick={guardar}>
              {guardando ? "Guardando…" : "Guardar zona"}
            </span>
          </div>
        )}

        <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative" }}>
          <div ref={divRef} style={{ position: "absolute", inset: 0,
                                     cursor: modo === "ver" ? "grab" : "crosshair" }} />
          {modo !== "ver" && (
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
                          background: "rgba(26,58,107,.93)", color: "#fff", padding: "7px 16px",
                          borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 500,
                          pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,.25)" }}>
              {modo === "circulo"
                ? (centro ? "Centro fijado · ajusta el radio y guarda"
                          : "👆 Click en el mapa para fijar el centro")
                : (vertices.length === 0 ? "👆 Click en el mapa: cada click agrega un vértice"
                   : vertices.length < 3 ? `${vertices.length} de 3 vértices mínimos`
                   : `${vertices.length} vértices · ya puedes guardar`)}
            </div>
          )}
        </div>

        <div style={{ padding: "7px 16px", fontSize: 11, color: "#8a94a6",
                      borderTop: "1px solid #eef1f5", flexShrink: 0, display: "flex", gap: 8 }}>
          <span>Azul: con segmentación · Ámbar: sin segmentación (no pagan) · Violeta: polígonos · Verde: entregas reales</span>
          <span style={{ flex: 1 }} />
          {msg && <strong style={{ color: msg.startsWith("✓") ? VERDE : msg.startsWith("Error") ? "#b42318" : NAVY }}>{msg}</strong>}
        </div>
      </div>
    </div>
  );
}
