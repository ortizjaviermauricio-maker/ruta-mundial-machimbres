import test from 'node:test';
import assert from 'node:assert/strict';
import { compraParaGirar, girosPorCompra, puntos, separarNombre, siguienteRotacion } from '../src/campana.js';

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

test('la compra anunciada siempre alcanza para un giro', () => {
  assert.equal(compraParaGirar(reglas), 1000000);
  assert.equal(compraParaGirar({ ...reglas, valorPorOportunidad: 400000 }), 500000);
});

test('calcula giros con tope por factura', () => {
  assert.equal(girosPorCompra(999999, reglas), 0);
  assert.equal(girosPorCompra(3200000, reglas), 3);
  assert.equal(girosPorCompra(9000000, reglas), 5);
});

test('muestra puntos con separador de miles', () => {
  assert.equal(puntos(25000), '25.000');
});
