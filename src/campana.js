// Todo lo que cambia de una campaña a otra está aquí y en los colores de styles.css.
export const CAMPANA = {
  nombre: '39 años Machimbres y Maderas',
  desde: 'DESDE 1987',
  titular: 'ESTAMOS DE ANIVERSARIO',
  subtitulo: '39 AÑOS CONSTRUYENDO TUS IDEAS',
  invitacion: 'Compra, gira la ruleta y gana.',
  // Copie aquí la ruta del PDF aprobado por el asesor legal, por ejemplo '/Reglamento_39_Anos.pdf'.
  reglamentoPdf: '',
};

export const SEDES_RESPALDO = [
  { nombre: 'Machimbres y Maderas S.A.S.', prefijo: 'FE' },
  { nombre: 'DEKO LÁMINAS', prefijo: 'FD' },
  { nombre: 'Satélite', prefijo: 'STFD' },
];

export function money(valor) {
  return Number(valor || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
}

// El registro pide un solo campo; el servidor guarda nombre y apellido por separado para el ranking.
export function separarNombre(completo) {
  const partes = String(completo || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) return { nombre: partes[0] || '', apellido: '' };
  return { nombre: partes.slice(0, -1).join(' '), apellido: partes[partes.length - 1] };
}

// Vuelta final de la ruleta: suma giros completos desde la posición actual. Es solo visual; el servidor decide.
export function siguienteRotacion(actual, azar = Math.random()) {
  return actual + 360 * 6 + Math.floor(azar * 360);
}
