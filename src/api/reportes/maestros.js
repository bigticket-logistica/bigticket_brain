// ══════════════════════════════════════════════════════════════
// BIGTICKET BRAIN — API: Reporte Maestros (Excel)
// Ruta: /api/reporte-maestros?fecha=YYYY-MM-DD
// Genera un Excel con 3 hojas: Resumen, Detalle, Por Conductor
// ══════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';

const sb = createClient(
  'https://psvdtgjvognbmxfvqbaa.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzdmR0Z2p2b2duYm14ZnZxYmFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzAwMTQsImV4cCI6MjA4NzYwNjAxNH0.zEBcFOT8u9BViQ1YVMm-QYsPKy1TZCKU2nJXqJR1Em0'
);

// Colores Bigticket
const AZUL = 'FF1A3A6B';
const NARANJA = 'FFF47B20';
const GRIS_CLARO = 'FFF8F9FA';
const BLANCO = 'FFFFFFFF';

export default async function handler(req, res) {
  try {
    const fecha = req.query.fecha || new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const fechaInicio = `${fecha}T00:00:00.000Z`;
    const fechaFin = `${fecha}T23:59:59.999Z`;

    // Traer viajes del día con drivers
    const { data: viajes, error } = await sb
      .from('viajes')
      .select('*, driver:drivers(nombre, rut, telefono, tipo_vehiculo)')
      .gte('fecha_salida', fechaInicio)
      .lte('fecha_salida', fechaFin)
      .order('fecha_salida', { ascending: true });

    if (error) throw error;
    if (!viajes || viajes.length === 0) {
      return res.status(404).json({ error: 'Sin viajes para la fecha', fecha });
    }

    // Crear workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Biggi — Bigticket';
    wb.created = new Date();

    // ══════════ HOJA 1: RESUMEN EJECUTIVO ══════════
    const s1 = wb.addWorksheet('Resumen', {
      properties: { tabColor: { argb: NARANJA } },
    });

    // Cálculos
    const total = viajes.length;
    const totalAsignados = viajes.reduce((a, v) => a + (v.paquetes_asignados || 0), 0);
    const totalEntregados = viajes.reduce((a, v) => a + (v.paquetes_entregados || 0), 0);
    const totalDevueltos = viajes.reduce((a, v) => a + (v.paquetes_devueltos || 0), 0);
    const totalNovedades = viajes.reduce((a, v) => a + (v.paquetes_novedades || 0), 0);
    const pctCumplimiento = totalAsignados > 0 ? (totalEntregados / totalAsignados * 100) : 0;
    const kmTotales = viajes.reduce((a, v) => a + (v.km_recorridos || 0), 0);
    const pesoTotal = viajes.reduce((a, v) => a + (parseFloat(v.peso_kg) || 0), 0);
    const tiempoPromedio = viajes.length > 0
      ? Math.round(viajes.reduce((a, v) => a + (v.tiempo_minutos || 0), 0) / viajes.length)
      : 0;

    // Top conductores por volumen entregado
    const porConductor = {};
    viajes.forEach(v => {
      const n = v.driver?.nombre || 'Sin conductor';
      if (!porConductor[n]) porConductor[n] = { viajes: 0, entregados: 0, asignados: 0 };
      porConductor[n].viajes++;
      porConductor[n].entregados += v.paquetes_entregados || 0;
      porConductor[n].asignados += v.paquetes_asignados || 0;
    });
    const top3 = Object.entries(porConductor)
      .sort((a, b) => b[1].entregados - a[1].entregados)
      .slice(0, 3);

    // Header hoja 1
    s1.mergeCells('A1:D1');
    const titulo = s1.getCell('A1');
    titulo.value = `REPORTE MAESTRO DE JORNADA — ${fecha}`;
    titulo.font = { bold: true, size: 16, color: { argb: BLANCO } };
    titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    titulo.alignment = { horizontal: 'center', vertical: 'middle' };
    s1.getRow(1).height = 30;

    s1.getCell('A3').value = 'MÉTRICA';
    s1.getCell('B3').value = 'VALOR';
    ['A3', 'B3'].forEach(c => {
      s1.getCell(c).font = { bold: true, color: { argb: BLANCO } };
      s1.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA } };
      s1.getCell(c).alignment = { horizontal: 'center' };
    });

    const filas = [
      ['Total de viajes', total],
      ['Paquetes asignados', totalAsignados],
      ['Paquetes entregados', totalEntregados],
      ['Paquetes devueltos', totalDevueltos],
      ['Paquetes con novedades', totalNovedades],
      ['% Cumplimiento', `${pctCumplimiento.toFixed(1)}%`],
      ['Km totales recorridos', kmTotales.toFixed(1)],
      ['Peso total (kg)', pesoTotal.toFixed(1)],
      ['Tiempo promedio por viaje (min)', tiempoPromedio],
    ];
    filas.forEach((f, i) => {
      s1.getCell(`A${4 + i}`).value = f[0];
      s1.getCell(`B${4 + i}`).value = f[1];
      s1.getCell(`A${4 + i}`).font = { bold: true };
      if (i % 2 === 0) {
        ['A', 'B'].forEach(col => {
          s1.getCell(`${col}${4 + i}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CLARO } };
        });
      }
    });

    // Top 3 conductores
    s1.mergeCells('A14:D14');
    s1.getCell('A14').value = 'TOP 3 CONDUCTORES';
    s1.getCell('A14').font = { bold: true, color: { argb: BLANCO } };
    s1.getCell('A14').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    s1.getCell('A14').alignment = { horizontal: 'center' };

    ['Posición', 'Conductor', 'Viajes', 'Entregados'].forEach((h, i) => {
      const c = s1.getCell(15, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: BLANCO } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA } };
      c.alignment = { horizontal: 'center' };
    });
    top3.forEach(([nombre, data], i) => {
      s1.getCell(16 + i, 1).value = `#${i + 1}`;
      s1.getCell(16 + i, 2).value = nombre;
      s1.getCell(16 + i, 3).value = data.viajes;
      s1.getCell(16 + i, 4).value = data.entregados;
    });

    s1.getColumn('A').width = 32;
    s1.getColumn('B').width = 18;
    s1.getColumn('C').width = 14;
    s1.getColumn('D').width = 14;

    // ══════════ HOJA 2: DETALLE VIAJES ══════════
    const s2 = wb.addWorksheet('Detalle', { properties: { tabColor: { argb: AZUL } } });

    const headers2 = [
      'TMS ID', 'Conductor', 'RUT', 'Vehículo', 'Salida', 'Llegada',
      'Asignados', 'Entregados', 'Devueltos', 'Novedades',
      '% Eficiencia', 'Km', 'Peso (kg)', 'Tiempo (min)', 'Estado', 'Observaciones'
    ];
    s2.addRow(headers2);
    const hr2 = s2.getRow(1);
    hr2.font = { bold: true, color: { argb: BLANCO } };
    hr2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    hr2.alignment = { horizontal: 'center', vertical: 'middle' };
    hr2.height = 25;

    viajes.forEach((v, i) => {
      const row = s2.addRow([
        v.tms_id || '',
        v.driver?.nombre || '—',
        v.driver?.rut || '—',
        v.driver?.tipo_vehiculo || '—',
        v.fecha_salida ? new Date(v.fecha_salida).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '',
        v.fecha_llegada ? new Date(v.fecha_llegada).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '',
        v.paquetes_asignados || 0,
        v.paquetes_entregados || 0,
        v.paquetes_devueltos || 0,
        v.paquetes_novedades || 0,
        v.eficiencia_pct ? `${parseFloat(v.eficiencia_pct).toFixed(1)}%` : '',
        v.km_recorridos || 0,
        v.peso_kg || 0,
        v.tiempo_minutos || 0,
        v.estado || '',
        v.observaciones || '',
      ]);
      if (i % 2 === 0) {
        row.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CLARO } };
        });
      }
      // Resaltar viajes con novedades
      if (v.tiene_novedad || (v.paquetes_novedades || 0) > 0) {
        row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
        row.getCell(10).font = { color: { argb: 'FF9C0006' }, bold: true };
      }
    });

    // Auto-ancho
    s2.columns.forEach(col => {
      let max = 10;
      col.eachCell({ includeEmpty: true }, c => {
        const len = String(c.value || '').length;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 30);
    });

    // ══════════ HOJA 3: POR CONDUCTOR ══════════
    const s3 = wb.addWorksheet('Por Conductor', { properties: { tabColor: { argb: 'FF16A34A' } } });

    const agrupado = {};
    viajes.forEach(v => {
      const n = v.driver?.nombre || 'Sin conductor';
      if (!agrupado[n]) {
        agrupado[n] = {
          nombre: n,
          rut: v.driver?.rut || '',
          vehiculo: v.driver?.tipo_vehiculo || '',
          viajes: 0,
          asignados: 0,
          entregados: 0,
          devueltos: 0,
          novedades: 0,
          km: 0,
          peso: 0,
        };
      }
      agrupado[n].viajes++;
      agrupado[n].asignados += v.paquetes_asignados || 0;
      agrupado[n].entregados += v.paquetes_entregados || 0;
      agrupado[n].devueltos += v.paquetes_devueltos || 0;
      agrupado[n].novedades += v.paquetes_novedades || 0;
      agrupado[n].km += parseFloat(v.km_recorridos) || 0;
      agrupado[n].peso += parseFloat(v.peso_kg) || 0;
    });

    const headers3 = ['Conductor', 'RUT', 'Vehículo', 'Viajes', 'Asignados', 'Entregados', '% Cumplimiento', 'Devueltos', 'Novedades', 'Km', 'Peso (kg)'];
    s3.addRow(headers3);
    const hr3 = s3.getRow(1);
    hr3.font = { bold: true, color: { argb: BLANCO } };
    hr3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    hr3.alignment = { horizontal: 'center', vertical: 'middle' };
    hr3.height = 25;

    Object.values(agrupado)
      .sort((a, b) => b.entregados - a.entregados)
      .forEach((c, i) => {
        const pct = c.asignados > 0 ? (c.entregados / c.asignados * 100) : 0;
        const row = s3.addRow([
          c.nombre, c.rut, c.vehiculo,
          c.viajes, c.asignados, c.entregados,
          `${pct.toFixed(1)}%`,
          c.devueltos, c.novedades,
          c.km.toFixed(1), c.peso.toFixed(1),
        ]);
        if (i % 2 === 0) {
          row.eachCell(c => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CLARO } };
          });
        }
      });

    s3.columns.forEach(col => {
      let max = 10;
      col.eachCell({ includeEmpty: true }, c => {
        const len = String(c.value || '').length;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 28);
    });

    // Generar y enviar
    const buffer = await wb.xlsx.writeBuffer();
    const nombreArchivo = `Reporte_Maestros_${fecha}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.setHeader('Content-Length', buffer.byteLength);
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    console.error('Error reporte-maestros:', err);
    return res.status(500).json({ error: err.message });
  }
}
