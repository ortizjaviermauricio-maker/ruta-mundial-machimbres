// Lanza giros simultáneos reales contra el Postgres local para probar los bloqueos.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const [puerto, base] = process.argv.slice(2);
const psql = (sql) => run('psql', ['-h', '/tmp/pgruleta', '-p', puerto, '-U', 'postgres', '-d', base, '-qAtc', sql]);
const valor = async (sql) => (await psql(sql)).stdout.trim().split('\n').pop();

await psql(`delete from public.ganadores where true; delete from public.participantes where true; delete from public.premios where true;
  update public.configuracion_campana set value = value || '{"activa":true,"unPremioPorFactura":false,"ultimaFacturaFE":0,"valorPorOportunidad":500000,"maxOportunidades":10}'::jsonb;
  insert into public.premios (premio, cantidad, peso, entrega_premio) values ('Unico', 5, 1000, true), ('Sigue intentando', 0, 1, false);`);

// 3 giros de la misma factura lanzados 12 veces a la vez: solo 3 pueden pasar.
const token = await valor(`select public.registrar_factura('{"nombre":"Uno","celular":"3001112233","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"tipoDocumento":"CC","numeroDocumento":"12345678","factura":"FE1","valorCompra":1500000}')->>'token'`);
await psql(`set role postgres; update public.participantes set estado = 'aprobada';`);
const intentos = await Promise.allSettled(Array.from({ length: 12 }, () => psql(`select public.girar('${token}')`)));
const exitosos = intentos.filter((r) => r.status === 'fulfilled').length;
if (exitosos !== 3) throw new Error(`misma factura: pasaron ${exitosos} giros, esperados 3`);

// 20 facturas distintas compiten por las 2 unidades restantes o menos: el inventario nunca baja de 0.
const tokens = [];
for (let i = 2; i <= 21; i += 1) {
  tokens.push(await valor(`select public.registrar_factura('{"nombre":"N${i}","celular":"30011122${i}","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"tipoDocumento":"CC","numeroDocumento":"12345678","factura":"FE${i}","valorCompra":500000}')->>'token'`));
}
await psql(`update public.participantes set estado = 'aprobada' where estado = 'pendiente';`);
await Promise.allSettled(tokens.map((t) => psql(`select public.girar('${t}')`)));
const entregados = Number(await valor(`select count(*) from public.ganadores where premio = 'Unico'`));
const stock = Number(await valor(`select cantidad from public.premios where premio = 'Unico'`));
if (entregados !== 5 || stock !== 0) throw new Error(`inventario: ganados ${entregados}, stock ${stock}`);

console.log('CONCURRENCIA_OK', { exitosos, entregados, stock });
