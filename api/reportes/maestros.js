// ══════════════════════════════════════════════════════════════
// BIGTICKET BRAIN — API: Reporte Maestros (Excel)
// Ruta: /api/reportes/maestros?fecha=YYYY-MM-DD
// ══════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';

const sb = createClient(
  'https://psvdtgjvognbmxfvqbaa.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzdmR0Z2p2b2duYm14ZnZxYmFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzAwMTQsImV4cCI6MjA4NzYwNjAxNH0.zEBcFOT8u9BViQ1YVMm-QYsPKy1TZCKU2nJXqJR1Em0'
);

const AZUL    = 'FF1A3A6B';
const NARANJA = 'FFF47B20';
const GRIS    = 'FFF8F9FA';
const BLANCO  = 'FFFFFFFF';
const ROJO    = 'FFFFC7CE';

export default async function handler(req, res) {
  try {
    const fecha = req.query.fecha || new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const { data: viajes, error } = await sb
      .from('viajes')
      .select('tms_raw, eficiencia_pct, km_recorridos')
      .gte('fecha_salida', `${fecha}T00:00:00.000Z`)
      .lte('fecha_salida', `${fecha}T23:59:59.999Z`)
      .order('fecha_salida', { ascending: true });

    if (error) throw error;
    if (!viajes?.length) return res.status(404).json({ error: 'Sin viajes para la fecha', fecha });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Biggi — Bigticket';
    wb.created = new Date();

    // ══════ HOJA 1: DETALLE VIAJES ══════
    const s1 = wb.addWorksheet('Detalle', { properties: { tabColor: { argb: NARANJA } } });

    const headers = [
      'SERVICIO', 'CECO', 'FECHA', 'ID VIAJE', 'PATENTE',
      'DRIVER', 'PARADAS', 'CARGADOS', 'ENTREGADOS',
      'DEVUELTOS', 'TOTAL ENTREGAS', 'KM RECORRIDOS', 'TIPOLOGIA'
    ];

    // Header row
    const hr = s1.addRow(headers);
    hr.height = 28;
    hr.eachCell(c => {
      c.font = { bold: true, color: { argb: BLANCO }, size: 11 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = {
        bottom: { style: 'medium', color: { argb: NARANJA } }
      };
    });

    // Filas de datos
    let totalCargados = 0, totalEntregados = 0, totalDevueltos = 0, totalKm = 0, totalParadas = 0;

    viajes.forEach((v, i) => {
      const r = v.tms_raw || {};
      const cargados   = r['Envíos despachados'] || 0;
      const entregados = r['Envíos entregados'] || 0;
      const devueltos  = Math.max(0, cargados - entregados);
      const paradas    = r['Envíos despachados'] || 0;
      const km         = r['Kilómetros recorridos'] || v.km_recorridos || 0;
      const eficiencia = r['Entrega exitosa'] != null ? r['Entrega exitosa'] : (v.eficiencia_pct || 0);
      const sc         = r['Service center'] || '';
      const ceco       = sc ? `ML_MX_${sc}` : '';

      totalCargados   += cargados;
      totalEntregados += entregados;
      totalDevueltos  += devueltos;
      totalKm         += parseFloat(km) || 0;
      totalParadas    += paradas;

      const row = s1.addRow([
        'UM',
        ceco,
        r['Fecha'] || fecha,
        r['Id de la ruta'] || '',
        r['Placa'] || '',
        r['Nombre del transportista'] || '',
        paradas,
        cargados,
        entregados,
        devueltos,
        `${parseFloat(eficiencia).toFixed(1)}%`,
        parseFloat(km).toFixed(2),
        r['Vehículo'] || '',
      ]);

      // Alternar color fila
      if (i % 2 === 0) {
        row.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
        });
      }

      // Resaltar si hay devueltos
      if (devueltos > 0) {
        row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO } };
        row.getCell(10).font = { bold: true, color: { argb: 'FF9C0006' } };
      }

      row.eachCell(c => {
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border = { bottom: { style: 'thin', color: { argb: 'FFE4E7EC' } } };
      });
      // Driver alineado a la izquierda
      row.getCell(6).alignment = { horizontal: 'left', vertical: 'middle' };
    });

    // Fila totales
    const pctTotal = totalCargados > 0 ? (totalEntregados / totalCargados * 100).toFixed(1) : '0.0';
    const rowTotal = s1.addRow([
      '', `TOTAL — ${viajes.length} viajes`, '', '', '',
      '', totalParadas, totalCargados, totalEntregados,
      totalDevueltos, `${pctTotal}%`, totalKm.toFixed(2), ''
    ]);
    rowTotal.height = 22;
    rowTotal.eachCell(c => {
      c.font = { bold: true, color: { argb: BLANCO } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Anchos de columnas
    const anchos = [10, 18, 12, 14, 16, 34, 10, 11, 13, 11, 15, 16, 24];
    s1.columns.forEach((col, i) => { col.width = anchos[i] || 14; });

    // ══════ HOJA 2: RESUMEN EJECUTIVO ══════
    const s2 = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: AZUL } } });
    s2.getColumn('A').width = 35;
    s2.getColumn('B').width = 20;

    // Título
    s2.mergeCells('A1:B1');
    const t = s2.getCell('A1');
    t.value = `RESUMEN MAESTRO DE JORNADA — ${fecha}`;
    t.font = { bold: true, size: 14, color: { argb: BLANCO } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    s2.getRow(1).height = 32;

    // KPIs
    const kpis = [
      ['Total de viajes', viajes.length],
      ['Total paquetes cargados', totalCargados],
      ['Total paquetes entregados', totalEntregados],
      ['Total paquetes devueltos', totalDevueltos],
      ['% Cumplimiento global', `${pctTotal}%`],
      ['Km totales recorridos', `${totalKm.toFixed(2)} km`],
    ];

    kpis.forEach(([label, valor], i) => {
      const rn = 3 + i;
      s2.getCell(`A${rn}`).value = label;
      s2.getCell(`B${rn}`).value = valor;
      s2.getCell(`A${rn}`).font = { bold: true };
      s2.getCell(`A${rn}`).alignment = { vertical: 'middle' };
      s2.getCell(`B${rn}`).alignment = { horizontal: 'center', vertical: 'middle' };
      s2.getRow(rn).height = 22;
      if (i % 2 === 0) {
        ['A', 'B'].forEach(col => {
          s2.getCell(`${col}${rn}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
        });
      }
    });

    // Top conductores
    const porDriver = {};
    viajes.forEach(v => {
      const r = v.tms_raw || {};
      const n = r['Nombre del transportista'] || 'Sin conductor';
      if (!porDriver[n]) porDriver[n] = { entregados: 0, cargados: 0, viajes: 0 };
      porDriver[n].entregados += r['Envíos entregados'] || 0;
      porDriver[n].cargados += r['Envíos despachados'] || 0;
      porDriver[n].viajes++;
    });

    const top = Object.entries(porDriver).sort((a, b) => b[1].entregados - a[1].entregados).slice(0, 5);

    s2.mergeCells('A10:B10');
    s2.getCell('A10').value = 'TOP 5 CONDUCTORES';
    s2.getCell('A10').font = { bold: true, color: { argb: BLANCO } };
    s2.getCell('A10').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA } };
    s2.getCell('A10').alignment = { horizontal: 'center' };
    s2.getRow(10).height = 22;

    ['Conductor', 'Entregados'].forEach((h, i) => {
      const c = s2.getCell(11, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: BLANCO } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
      c.alignment = { horizontal: 'center' };
    });

    top.forEach(([nombre, d], i) => {
      s2.getCell(12 + i, 1).value = nombre;
      s2.getCell(12 + i, 2).value = d.entregados;
      s2.getCell(12 + i, 2).alignment = { horizontal: 'center' };
      if (i % 2 === 0) {
        ['A', 'B'].forEach(col => {
          s2.getCell(12 + i, col === 'A' ? 1 : 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
        });
      }
    });

    // Generar y enviar
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte_Maestros_${fecha}.xlsx"`);
    res.setHeader('Content-Length', buffer.byteLength);
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    console.error('Error reporte-maestros:', err);
    return res.status(500).json({ error: err.message });
  }
}
