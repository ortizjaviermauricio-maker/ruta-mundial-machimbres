import test from 'node:test';
import assert from 'node:assert/strict';
import { separarNombre, siguienteRotacion } from '../src/campana.js';

test('separa el nombre completo para el ranking', () => {
  assert.deepEqual(separarNombre('  Ana   Rojas '), { nombre: 'Ana', apellido: 'Rojas' });
  assert.deepEqual(separarNombre('Ana María Rojas'), { nombre: 'Ana María', apellido: 'Rojas' });
  assert.deepEqual(separarNombre('Ana'), { nombre: 'Ana', apellido: '' });
});

test('la ruleta siempre avanza al menos seis vueltas', () => {
  assert.equal(siguienteRotacion(100, 0), 2260);
  assert.ok(siguienteRotacion(100, 0.999) < 100 + 360 * 7);
});
