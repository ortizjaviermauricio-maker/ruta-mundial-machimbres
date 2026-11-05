// Todo lo que cambia de una campaña a otra está aquí. La marca no debe quedar repartida en los componentes.
export const CAMPANA = {
  nombre: '39 años Machimbres y Maderas',
  tituloLinea1: 'CELEBRAMOS',
  tituloLinea2: '39 AÑOS',
  tituloDestacado: 'CONTIGO',
  lema: 'COMPRA • REGISTRA • GIRA • GANA',
  ruleta: 'Ruleta de los 39 años',
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
