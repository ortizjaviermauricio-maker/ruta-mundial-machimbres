// Lectura del CSV de premios. Sin dependencias de React para poder probarlo con `npm test`.

export function decodificarArchivo(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    // Excel en español suele guardar el CSV como Windows-1252.
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export function detectarSeparador(linea) {
  return [';', '\t', ',']
    .map((sep) => ({ sep, total: linea.split(sep).length - 1 }))
    .sort((a, b) => b.total - a.total)[0].sep;
}

export function parsearLinea(linea, separador) {
  const valores = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i];
    if (c === '"' && linea[i + 1] === '"') {
      actual += '"';
      i += 1;
    } else if (c === '"') {
      entreComillas = !entreComillas;
    } else if (c === separador && !entreComillas) {
      valores.push(actual.trim());
      actual = '';
    } else {
      actual += c;
    }
  }
  valores.push(actual.trim());
  return valores;
}

// Acepta 0.5, 0,5, 60%, 1.000 (miles), 1.000,50 y 1,000.50.
export function normalizarNumero(valor, defecto = 0) {
  let limpio = String(valor ?? '').replace('%', '').trim();
  if (!limpio) return defecto;
  const ultimoPunto = limpio.lastIndexOf('.');
  const ultimaComa = limpio.lastIndexOf(',');
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    const decimal = ultimoPunto > ultimaComa ? '.' : ',';
    const miles = decimal === '.' ? ',' : '.';
    limpio = limpio.split(miles).join('').replace(decimal, '.');
  } else if (ultimaComa >= 0) {
    limpio = /^\d{1,3}(,\d{3})+$/.test(limpio) ? limpio.replaceAll(',', '') : limpio.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) {
    limpio = limpio.replaceAll('.', '');
  }
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : defecto;
}

export function normalizarBooleano(valor, defecto = false) {
  const limpio = String(valor ?? '').trim().toLowerCase();
  if (['true', 'verdadero', 'si', 'sí', '1', 'x', 'activo'].includes(limpio)) return true;
  if (['false', 'falso', 'no', '0', 'inactivo'].includes(limpio)) return false;
  return defecto;
}

function claveTexto(texto) {
  return String(texto || '').trim().toLowerCase();
}

// Devuelve { premios, advertencias } o lanza un Error con un mensaje para el administrador.
// `sedes` (opcional) es la lista de configuracion_campana.sedes; una sede desconocida queda como premio general.
export function parsearPremiosCSV(contenido, patrocinadores = [], sedes = []) {
  const lineas = contenido.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lineas.length < 2) throw new Error('El archivo está vacío.');

  const separador = detectarSeparador(lineas[0]);
  const encabezados = parsearLinea(lineas[0], separador).map(claveTexto);
  if (!encabezados.includes('nombre') && !encabezados.includes('premio')) {
    throw new Error('El CSV debe incluir una columna llamada nombre o premio.');
  }

  const advertencias = [];
  const premios = lineas.slice(1).map((linea, indice) => {
    const valores = parsearLinea(linea, separador);
    const fila = Object.fromEntries(encabezados.map((h, i) => [h, valores[i] ?? '']));
    const premio = String(fila.nombre || fila.premio || '').trim();
    if (!premio) throw new Error(`La fila ${indice + 2} no tiene nombre de premio.`);

    const esSinPremio = claveTexto(premio) === 'sigue intentando';
    const marca = claveTexto(fila.patrocinador || fila.aliado || fila.aplica_si_marca);
    const esGeneral = !marca || marca === 'general' || marca === 'ninguno';
    const patrocinador = esGeneral
      ? null
      : patrocinadores.find((p) => claveTexto(p.nombre) === marca || claveTexto(p.empresa) === marca);
    if (!esGeneral && !patrocinador) {
      advertencias.push(`${premio}: no existe el patrocinador "${marca}"; quedó como premio general.`);
    }

    const sedeTexto = String(fila.sede || '').trim();
    const sedeGeneral = !sedeTexto || claveTexto(sedeTexto) === 'general';
    const sedeConocida = sedeGeneral
      ? null
      : sedes.find((s) => claveTexto(s.nombre) === claveTexto(sedeTexto) || claveTexto(s.prefijo) === claveTexto(sedeTexto));
    if (!sedeGeneral && !sedeConocida) {
      advertencias.push(`${premio}: no existe la sede "${sedeTexto}"; quedó como premio general.`);
    }

    const peso = normalizarNumero(fila.probabilidad || fila.peso, -1);
    if (peso < 0) throw new Error(`La probabilidad del premio "${premio}" no es válida.`);

    return {
      premio,
      categoria: fila.categoria || fila.tipo || 'producto',
      cantidad: Math.max(0, Math.trunc(normalizarNumero(fila.stock || fila.cantidad, 0))),
      peso,
      visible_cliente: fila.visible === undefined || fila.visible === ''
        ? !esSinPremio
        : normalizarBooleano(fila.visible, true),
      entrega_premio: !(esSinPremio || normalizarBooleano(fila.ilimitado, false)),
      activo: true,
      patrocinador_id: patrocinador?.id || null,
      sede: sedeConocida?.nombre || null,
    };
  });

  return { premios, advertencias };
}

// Porcentaje real de cada premio: su peso entre la suma de los que pueden salir.
// Es el caso de una factura con todas las marcas; sin una marca, sus premios no participan.
// Con `sede`, solo cuentan los premios generales y los de esa sede (los demás quedan en 0).
// Sin `sede`, se ignora el filtro por sede.
export function porcentajesPremios(premios, sede = null) {
  const deLaSede = (p) => !sede || !p.sede || p.sede === sede;
  const participa = (p) => deLaSede(p) && p.activo !== false && Number(p.peso) > 0 && (!p.entrega_premio || Number(p.cantidad) > 0);
  const total = premios.filter(participa).reduce((suma, p) => suma + Number(p.peso), 0);
  return Object.fromEntries(premios.map((p) => [p.id, participa(p) && total > 0 ? (Number(p.peso) / total) * 100 : 0]));
}

function celdaCSV(valor) {
  const texto = String(valor ?? '');
  return /[;"\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

export const ENCABEZADOS_PREMIOS = ['nombre', 'categoria', 'stock', 'probabilidad', 'visible', 'ilimitado', 'patrocinador', 'sede'];

// CSV con las mismas columnas que recibe parsearPremiosCSV, para editarlo en Excel y volverlo a subir.
export function premiosACSV(premios, patrocinadores = []) {
  const filas = premios.map((p) => [
    p.premio,
    p.categoria,
    p.cantidad,
    p.peso,
    p.visible_cliente ? 'TRUE' : 'FALSE',
    p.entrega_premio ? 'FALSE' : 'TRUE',
    patrocinadores.find((s) => Number(s.id) === Number(p.patrocinador_id))?.nombre || 'General',
    p.sede || 'General',
  ]);
  return [ENCABEZADOS_PREMIOS, ...filas].map((fila) => fila.map(celdaCSV).join(';')).join('\r\n');
}
