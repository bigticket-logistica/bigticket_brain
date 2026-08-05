// ═══════════════════════════════════════════════════════════════════════════
// BIGTICKET CHILE · Editor de mapa de las Zonas de Pago
// Requiere:  npm install leaflet   (una vez, en el repo del Brain)
// ---------------------------------------------------------------------------
// Muestra todas las zonas existentes (círculos y polígonos) sobre OpenStreetMap
// y permite crear nuevas con el mouse:
//   · CÍRCULO   un click fija el centro; el radio se ajusta con el control y
//               se ve en vivo sobre el mapa.
//   · POLÍGONO  cada click agrega un vértice; "Deshacer" quita el último y
//               "Guardar" cierra el anillo (mínimo 3).
// Los polígonos dibujados nacen con prioridad 5: ganan a los círculos.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, Fragment } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const NAVY = "#1a3a6b", ORANGE = "#F47B20", AMBAR = "#b45309", VIOLETA = "#5b21b6";

export default function MapaZonas({ zonas, segmentaciones, api, onCerrar, onCreada }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const capaDibujo = useRef(null);      // lo que se está dibujando
  const [modo, setModo] = useState("ver");            // ver | circulo | poligono
  const [centro, setCentro] = useState(null);          // { lat, lon } del círculo
  const [radio, setRadio] = useState(5000);
  const [vertices, setVertices] = useState([]);        // [[lat, lon], ...]
  const [form, setForm] = useState({ nombre: "", cecos: "", segmentacion: "" });
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  // El estado vive en refs para que el handler de click del mapa (que Leaflet
  // registra una sola vez) siempre vea el valor vigente.
  const modoRef = useRef(modo);   modoRef.current = modo;
  const radioRef = useRef(radio); radioRef.current = radio;

  // ── montar el mapa una sola vez ──
  useEffect(() => {
    const mapa = L.map(divRef.current, { center: [-33.45, -70.66], zoom: 6 });
    // Dos capas base intercambiables. Ninguna necesita API key ni pago.
    const calles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap",
    }).addTo(mapa);
    const satelite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Imagery © Esri" });
    L.control.layers({ "Calles": calles, "Satélite": satelite }, null,
                     { position: "topright", collapsed: false }).addTo(mapa);
    mapRef.current = mapa;
    capaDibujo.current = L.layerGroup().addTo(mapa);

    // las zonas existentes
    const capaZonas = L.layerGroup().addTo(mapa);
    for (const z of zonas) {
      const color = z.segmentacion ? NAVY : AMBAR;
      const popup = `<strong>${z.nombre}</strong><br/>${z.codigo_meli || ""} · ${z.segmentacion || "SIN SEGMENTACIÓN"}` +
                    (z.tipo_geo === "circulo" ? `<br/>radio ${Number(z.radio_m).toLocaleString("es-CL")} m` : "<br/>polígono");
      if (z.tipo_geo === "circulo" && z.lat != null) {
        L.circle([z.lat, z.lon], { radius: z.radio_m, color, weight: 1.5, fillOpacity: 0.08 })
          .bindPopup(popup).addTo(capaZonas);
      } else if (z.poligono_geojson) {
        try {
          L.geoJSON(JSON.parse(z.poligono_geojson), {
            style: { color: VIOLETA, weight: 2, fillOpacity: 0.10 },
          }).bindPopup(popup).addTo(capaZonas);
        } catch { /* geojson inválido: se omite */ }
      }
    }

    // los clicks de dibujo
    mapa.on("click", (e) => {
      const { lat, lng } = e.latlng;
      if (modoRef.current === "circulo") {
        setCentro({ lat: +lat.toFixed(5), lon: +lng.toFixed(5) });
        capaDibujo.current.clearLayers();
        L.circle([lat, lng], { radius: radioRef.current, color: ORANGE, weight: 2, fillOpacity: 0.15 })
          .addTo(capaDibujo.current);
        L.circleMarker([lat, lng], { radius: 5, color: "#fff", weight: 2, fillColor: ORANGE, fillOpacity: 1 }).addTo(capaDibujo.current);
      } else if (modoRef.current === "poligono") {
        setVertices(v => {
          const nuevo = [...v, [+lat.toFixed(5), +lng.toFixed(5)]];
          capaDibujo.current.clearLayers();
          if (nuevo.length >= 3) {
            L.polygon(nuevo, { color: ORANGE, weight: 2, fillOpacity: 0.15 }).addTo(capaDibujo.current);
          } else {
            L.polyline(nuevo, { color: ORANGE, weight: 2, dashArray: "5 5" }).addTo(capaDibujo.current);
          }
          nuevo.forEach(p => L.circleMarker(p, { radius: 4, color: ORANGE }).addTo(capaDibujo.current));
          return nuevo;
        });
      }
    });
    return () => mapa.remove();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // el radio en vivo del círculo
  useEffect(() => {
    if (modo === "circulo" && centro) {
      capaDibujo.current.clearLayers();
      L.circle([centro.lat, centro.lon], { radius: radio, color: ORANGE, weight: 2, fillOpacity: 0.15 })
        .addTo(capaDibujo.current);
      L.circleMarker([centro.lat, centro.lon], { radius: 5, color: "#fff", weight: 2, fillColor: ORANGE, fillOpacity: 1 }).addTo(capaDibujo.current);
    }
  }, [radio]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Puntos de entrega reales: dibujar sobre datos, no a ojo ──
  const capaPuntos = useRef(null);
  const [puntosOn, setPuntosOn] = useState(false);
  const [cargandoPuntos, setCargandoPuntos] = useState(false);
  const verPuntos = async () => {
    if (puntosOn) {
      capaPuntos.current && capaPuntos.current.clearLayers();
      setPuntosOn(false); return;
    }
    if (!form.cecos) { setMsg("Escribe el código MELI (ej. SLT1) para ver sus entregas."); return; }
    setCargandoPuntos(true);
    try {
      const desde = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const d = await api(`vw_puntos_entrega?codigo_meli=eq.${form.cecos}&fecha_operativa=gte.${desde}&limit=4000`);
      if (!capaPuntos.current) capaPuntos.current = L.layerGroup().addTo(mapRef.current);
      capaPuntos.current.clearLayers();
      for (const pt of d) {
        L.circleMarker([pt.lat, pt.lon], {
          radius: Math.min(7, 2 + Math.log2(pt.paquetes + 1)),
          color: "#0d8043", weight: 1, fillColor: "#22c55e", fillOpacity: 0.55,
        }).bindTooltip(`${pt.paquetes} paq · ${pt.comunas || ""}`).addTo(capaPuntos.current);
      }
      setPuntosOn(true);
      setMsg(d.length ? `${d.length} puntos de entrega de los últimos 7 días` : "Sin entregas en 7 días para ese código");
    } catch (e) { setMsg("Error cargando puntos: " + e.message); }
    finally { setCargandoPuntos(false); }
  };

  const limpiar = () => { setCentro(null); setVertices([]); capaDibujo.current.clearLayers(); };
  const cambiarModo = (m) => { setModo(m); limpiar(); setMsg(""); };

  const CODIGOS_VALIDOS = /^(S[A-Z]{2}\d|CL[A-Z]{2,3}\d{1,2}|CLXCQ1|CLRM03)$/;
  const guardar = async () => {
    if (!form.nombre || !form.cecos || !form.segmentacion) {
      setMsg("Completa nombre, código MELI y segmentación."); return;
    }
    if (!CODIGOS_VALIDOS.test(form.cecos)) {
      setMsg(`"${form.cecos}" no parece un código MELI real (ej: SLT1, SRM2, SBB1). Una zona con código inválido nunca recibiría paquetes.`); return;
    }
    if (modo === "circulo" && !centro) { setMsg("Haz click en el mapa para fijar el centro."); return; }
    if (modo === "poligono" && vertices.length < 3) { setMsg("El polígono necesita al menos 3 vértices."); return; }
    setGuardando(true);
    try {
      if (modo === "circulo") {
        await api("rpc/crear_zona_pago", { method: "POST", body: JSON.stringify({
          p_nombre: form.nombre, p_cecos: form.cecos, p_segmentacion: form.segmentacion,
          p_lat: centro.lat, p_lon: centro.lon, p_radio_m: Number(radio),
          p_nota: "Dibujada en el mapa del Brain." }) });
      } else {
        await api("rpc/crear_zona_pago_poligono", { method: "POST", body: JSON.stringify({
          p_nombre: form.nombre, p_cecos: form.cecos, p_segmentacion: form.segmentacion,
          p_puntos: vertices }) });
      }
      setMsg(`✓ Zona "${form.nombre}" creada`);
      limpiar(); setForm({ nombre: "", cecos: "", segmentacion: "" });
      onCreada && onCreada();
    } catch (e) { setMsg("Error: " + e.message); }
    finally { setGuardando(false); }
  };

  const btn = (activo) => ({ padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
    cursor: "pointer", border: "1px solid " + (activo ? NAVY : "#dfe4ec"),
    background: activo ? NAVY : "#fff", color: activo ? "#fff" : "#475569" });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 1000,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "min(1100px, 96vw)",
                    maxHeight: "94vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", display: "flex", gap: 10, alignItems: "center",
                      flexWrap: "wrap", borderBottom: "1px solid #eef1f5", flexShrink: 0 }}>
          <strong style={{ color: NAVY, fontSize: 14 }}>Mapa de zonas de pago</strong>
          <span style={btn(modo === "ver")}      onClick={() => cambiarModo("ver")}>Ver</span>
          <span style={btn(modo === "circulo")}  onClick={() => cambiarModo("circulo")}>⊕ Círculo</span>
          <span style={btn(modo === "poligono")} onClick={() => cambiarModo("poligono")}>▰ Polígono</span>
          {modo === "circulo" && (
            <label style={{ fontSize: 11.5, color: "#64748b" }}>
              radio {Number(radio).toLocaleString("es-CL")} m
              <input type="range" min={500} max={30000} step={250} value={radio}
                     onChange={e => setRadio(Number(e.target.value))}
                     style={{ verticalAlign: "middle", marginLeft: 6, width: 140 }} />
            </label>
          )}
          {modo === "poligono" && (
            <Fragment>
              <span style={{ fontSize: 11.5, color: "#64748b" }}>{vertices.length} vértices</span>
              <button style={btn(false)} onClick={() => setVertices(v => {
                const nuevo = v.slice(0, -1);
                capaDibujo.current.clearLayers();
                if (nuevo.length >= 2) L.polyline(nuevo, { color: ORANGE, weight: 2, dashArray: "5 5" }).addTo(capaDibujo.current);
                nuevo.forEach(p => L.circleMarker(p, { radius: 4, color: ORANGE }).addTo(capaDibujo.current));
                return nuevo;
              })}>Deshacer</button>
            </Fragment>
          )}
          <span style={{ flex: 1 }} />
          <button style={btn(false)} onClick={onCerrar}>Cerrar</button>
        </div>

        {modo !== "ver" && (
          <div style={{ padding: "10px 16px", display: "flex", gap: 8, alignItems: "flex-end",
                        flexWrap: "wrap", background: "#fdf6e3", borderBottom: "1px solid #f3e2b8",
                        flexShrink: 0 }}>
            <label style={{ fontSize: 10.5, color: "#64748b" }}>Nombre<br/>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                     placeholder="Cahuil" style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #dfe4ec", width: 130 }} /></label>
            <label style={{ fontSize: 10.5, color: "#64748b" }}>Código MELI<br/>
              <input value={form.cecos} onChange={e => setForm(f => ({ ...f, cecos: e.target.value.toUpperCase() }))}
                     placeholder="SLT1" style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #dfe4ec", width: 76 }} /></label>
            <label style={{ fontSize: 10.5, color: "#64748b" }}>Segmentación<br/>
              <select value={form.segmentacion} onChange={e => setForm(f => ({ ...f, segmentacion: e.target.value }))}
                      style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #dfe4ec", minWidth: 140 }}>
                <option value="">— elegir —</option>
                {segmentaciones.map(s => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)}
              </select></label>
            <button onClick={verPuntos} disabled={cargandoPuntos} style={btn(puntosOn)}
                    title="Muestra dónde se entregó de verdad en los últimos 7 días, para dibujar sobre los datos">
              {cargandoPuntos ? "…" : puntosOn ? "✓ Entregas" : "◉ Ver entregas"}
            </button>
            <button onClick={guardar} disabled={guardando}
                    style={{ ...btn(true), padding: "7px 16px" }}>
              {guardando ? "Guardando…" : modo === "circulo" ? "Guardar círculo" : "Guardar polígono"}
            </button>
            {msg && <span style={{ fontSize: 12, color: msg.startsWith("✓") ? "#0d8043" : "#b42318" }}>{msg}</span>}
          </div>
        )}

        <div style={{ flex: "1 1 auto", minHeight: 260, position: "relative" }}>
          <div ref={divRef} style={{ position: "absolute", inset: 0,
                                     cursor: modo === "ver" ? "grab" : "crosshair" }} />
          {/* instrucción flotante: el mapa se dibuja clickeando, sin lápiz */}
          {modo !== "ver" && (
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
                          background: "rgba(26,58,107,.92)", color: "#fff", padding: "7px 16px",
                          borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 500,
                          pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,.25)" }}>
              {modo === "circulo"
                ? (centro ? "Centro fijado · ajusta el radio arriba y completa el formulario"
                          : "👆 Haz CLICK sobre el mapa para fijar el centro del círculo")
                : (vertices.length === 0 ? "👆 Haz CLICK sobre el mapa: cada click agrega un vértice del polígono"
                   : vertices.length < 3 ? `${vertices.length} de mínimo 3 vértices · sigue clickeando el contorno`
                   : `${vertices.length} vértices · sigue agregando o presiona Guardar polígono`)}
            </div>
          )}
        </div>
        <div style={{ padding: "7px 16px", fontSize: 11, color: "#8a94a6", borderTop: "1px solid #eef1f5", flexShrink: 0 }}>
          Azul: zonas con segmentación · Ámbar: sin segmentación (no pagan) · Violeta: polígonos ·
          Verde: entregas reales ·
          En modo dibujo, cada click sobre el mapa {modo === "poligono" ? "agrega un vértice" : "fija el centro"}.
        </div>
      </div>
    </div>
  );
}
