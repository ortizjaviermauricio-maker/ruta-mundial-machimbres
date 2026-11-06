import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodificarArchivo, normalizarNumero, parsearPremiosCSV, porcentajesPremios, premiosACSV } from '../src/csv.js';

test('números con punto o coma decimal no se multiplican', () => {
  assert.equal(normalizarNumero('0.5'), 0.5);
  assert.equal(normalizarNumero('0,5'), 0.5);
  assert.equal(normalizarNumero('1.5'), 1.5);
  assert.equal(normalizarNumero('1.000'), 1000);
  assert.equal(normalizarNumero('1.000,50'), 1000.5);
  assert.equal(normalizarNumero('1,000.50'), 1000.5);
  assert.equal(normalizarNumero('999999'), 999999);
});

test('carga el CSV real de premios con BOM y tildes', () => {
  const archivo = readFileSync(new URL('../premios_machimbres_FINAL_reglas_ok.csv', import.meta.url));
  const { premios } = parsearPremiosCSV(decodificarArchivo(archivo));
  assert.equal(premios.length, 13);
  assert.equal(premios[0].premio, 'Sigue intentando');
  assert.equal(premios[0].entrega_premio, false);
  assert.equal(premios[0].visible_cliente, false);
  assert.equal(premios[2].premio, 'Camiseta Selección');
  assert.equal(premios[3].peso, 0.5);
  assert.equal(premios[3].entrega_premio, true);
});

test('un CSV en Windows-1252 conserva las tildes', () => {
  const bytes = Uint8Array.from([...'nombre;probabilidad\nSelecci', 0xf3, ...'n;2'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c)));
  const { premios } = parsearPremiosCSV(decodificarArchivo(bytes));
  assert.equal(premios[0].premio, 'Selección');
});

test('rechaza archivos sin columna de premio', () => {
  assert.throws(() => parsearPremiosCSV('a;b\n1;2'), /nombre o premio/);
});

const lista = [
  { id: 'a', premio: 'Sigue intentando', categoria: 'Sin premio', cantidad: 0, peso: 60, visible_cliente: false, entrega_premio: false },
  { id: 'b', premio: 'Gorra; roja', categoria: 'Premio', cantidad: 5, peso: 30, visible_cliente: true, entrega_premio: true, patrocinador_id: 1 },
  { id: 'c', premio: 'Agotado', categoria: 'Premio', cantidad: 0, peso: 10, visible_cliente: true, entrega_premio: true },
];

test('el porcentaje real excluye premios agotados', () => {
  const p = porcentajesPremios(lista);
  assert.ok(Math.abs(p.a - 66.67) < 0.01);
  assert.ok(Math.abs(p.b - 33.33) < 0.01);
  assert.equal(p.c, 0);
});

test('acepta probabilidad con signo de porcentaje', () => {
  assert.equal(normalizarNumero('12,5%'), 12.5);
});

test('el CSV descargado se puede volver a subir', () => {
  const patrocinadores = [{ id: 1, nombre: 'Ecofort' }];
  const { premios } = parsearPremiosCSV(premiosACSV(lista, patrocinadores), patrocinadores);
  assert.equal(premios.length, 3);
  assert.deepEqual(
    { ...premios[1] },
    { premio: 'Gorra; roja', categoria: 'Premio', cantidad: 5, peso: 30, visible_cliente: true, entrega_premio: true, activo: true, patrocinador_id: 1 },
  );
  assert.equal(premios[0].entrega_premio, false);
  assert.equal(premios[0].visible_cliente, false);
});
