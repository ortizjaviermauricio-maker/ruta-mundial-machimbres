import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodificarArchivo, normalizarNumero, parsearPremiosCSV } from '../src/csv.js';

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
