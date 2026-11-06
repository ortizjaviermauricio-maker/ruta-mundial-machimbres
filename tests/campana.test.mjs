import test from 'node:test';
import assert from 'node:assert/strict';
import { girosPorCompra, puntos, puntosPorCompra, separarNombre, siguienteRotacion } from '../src/campana.js';

test('separa el nombre completo para el ranking', () => {
  assert.deepEqual(separarNombre('  Ana   Rojas '), { nombre: 'Ana', apellido: 'Rojas' });
  assert.deepEqual(separarNombre('Ana María Rojas'), { nombre: 'Ana María', apellido: 'Rojas' });
  assert.deepEqual(separarNombre('Ana'), { nombre: 'Ana', apellido: '' });
});

test('la ruleta siempre avanza al menos seis vueltas', () => {
  assert.equal(siguienteRotacion(100, 0), 2260);
  assert.ok(siguienteRotacion(100, 0.999) < 100 + 360 * 7);
});

const reglas = { compraMinima: 500000, valorPorOportunidad: 1000000, maxOportunidades: 5 };

test('los puntos salen de la compra acumulada, sin tope', () => {
  const config = { ...reglas, puntosPorOportunidad: 5000 };
  assert.equal(puntosPorCompra(1800000, config), 5000);
  assert.equal(puntosPorCompra(20000000, config), 100000);
});

test('calcula giros con tope por factura', () => {
  assert.equal(girosPorCompra(999999, reglas), 0);
  assert.equal(girosPorCompra(3200000, reglas), 3);
  assert.equal(girosPorCompra(9000000, reglas), 5);
});

test('muestra puntos con separador de miles', () => {
  assert.equal(puntos(25000), '25.000');
});
