// Todo lo que cambia de una campaña a otra está aquí y en los colores de styles.css.
export const CAMPANA = {
  nombre: 'Cada lámina cuenta',
  desde: 'DESDE 1987',
  titular: 'CADA LÁMINA CUENTA',
  subtitulo: '39 AÑOS SIENDO PARTE DE TUS PROYECTOS',
  invitacion: 'Compra, registra tu factura y gira la ruleta.',
  compromiso: 'Invertimos en tecnología y capacitación para entregarte el mejor producto transformado y darle mayor valor a tus proyectos.',
  pilares: ['Tecnología', 'Capacitación', 'Producto transformado'],
  // Marcas de lámina del catálogo de ventas. Con logo si hay archivo; no implican patrocinio.
  marcas: [
    { nombre: 'Tablemac' },
    { nombre: 'Primadera', logo: '/primadera-logo.svg' },
    { nombre: 'Ecofort', logo: '/ecofort-logo.png' },
    { nombre: 'Moduofi' },
    { nombre: 'Masisa' },
    { nombre: 'Cimca' },
    { nombre: 'Pelikano' },
    { nombre: 'Rehau' },
  ],
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

export function puntos(valor) {
  return Number(valor || 0).toLocaleString('es-CO');
}

export function girosPorCompra(valor, config) {
  const porGiro = Math.max(Number(config.valorPorOportunidad || 1), 1);
  return Math.min(Math.floor(Number(valor || 0) / porGiro), Number(config.maxOportunidades || 0));
}

// Misma fórmula del ranking en el servidor: compra acumulada del cliente, sin tope por factura.
export function puntosPorCompra(total, config) {
  const porGiro = Math.max(Number(config.valorPorOportunidad || 1), 1);
  return Math.floor(Number(total || 0) / porGiro) * Number(config.puntosPorOportunidad || 0);
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
