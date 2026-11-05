import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { money } from './campana';
import { decodificarArchivo, parsearPremiosCSV } from './csv';

const COLUMNAS_PARTICIPANTE = 'id,fecha,nombre,apellido,celular,email,sede,factura,prefijo_factura,valor,vendedor,puntos,oportunidades,usadas,estado,validado_por,validado_at,nota_validacion,marca_compra,patrocinadores_ids';
const PATROCINADOR_VACIO = { nombre: '', empresa: '', responsable: '', telefono: '', correo: '', logo_url: '', pagina_web: '', instagram: '', whatsapp: '', activo: true, orden: 99 };

function escapar(texto) {
  return String(texto ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

function descargarExcel(nombre, filas) {
  if (!filas.length) {
    alert('No hay registros para descargar.');
    return;
  }
  const columnas = Object.keys(filas[0]);
  const html = `<html><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>${columnas.map((c) => `<th>${escapar(c)}</th>`).join('')}</tr></thead><tbody>${filas.map((f) => `<tr>${columnas.map((c) => `<td>${escapar(f[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  descargar(`${nombre}.xls`, html, 'application/vnd.ms-excel;charset=utf-8');
}

function fecha(valor) {
  return valor ? new Date(valor).toLocaleString('es-CO', { hour12: false }) : '';
}

function aFechaLocal(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function leerImagen(file, maximo) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/') || file.size > maximo) {
      reject(new Error(`Use una imagen menor a ${Math.round(maximo / 1000)} KB.`));
      return;
    }
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    lector.readAsDataURL(file);
  });
}

export default function Admin() {
  const [sesion, setSesion] = useState(null);
  const [rol, setRol] = useState(null);
  const [listo, setListo] = useState(false);
  const [login, setLogin] = useState({ correo: '', clave: '' });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSesion(data.session); setListo(true); });
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSesion(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sesion) {
      setRol(null);
      return;
    }
    supabase.rpc('rol_actual').then(({ data }) => setRol(data || 'ninguno'));
  }, [sesion]);

  async function entrar(e) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email: login.correo.trim(), password: login.clave });
    setLogin({ correo: login.correo, clave: '' });
    if (error) alert('Correo o contraseña incorrectos.');
  }

  async function recuperarClave() {
    if (!login.correo.trim()) {
      alert('Escriba su correo primero.');
      return;
    }
    await supabase.auth.resetPasswordForEmail(login.correo.trim(), { redirectTo: window.location.origin });
    alert('Si el correo está autorizado, recibirá un enlace para cambiar la contraseña.');
  }

  if (!listo) return <p>Cargando…</p>;

  if (!sesion) {
    return (
      <div className="loginBox">
        <h2>Acceso del personal</h2>
        <form onSubmit={entrar}>
          <input required type="email" placeholder="Correo" autoComplete="username" value={login.correo} onChange={(e) => setLogin({ ...login, correo: e.target.value })} />
          <input required type="password" placeholder="Contraseña" autoComplete="current-password" value={login.clave} onChange={(e) => setLogin({ ...login, clave: e.target.value })} />
          <button className="primary" type="submit">Ingresar</button>
        </form>
        <button className="linkButton" type="button" onClick={recuperarClave}>Olvidé mi contraseña</button>
      </div>
    );
  }

  if (!rol) return <p>Verificando permisos…</p>;

  if (rol === 'ninguno') {
    return (
      <div className="loginBox">
        <h2>Sin permisos</h2>
        <p>Este correo no está autorizado para el panel de la campaña.</p>
        <button className="logout" onClick={() => supabase.auth.signOut()}>Salir</button>
      </div>
    );
  }

  return <Panel rol={rol} correo={sesion.user.email} />;
}

function Panel({ rol, correo }) {
  const esAdmin = rol === 'admin';
  const [participantes, setParticipantes] = useState([]);
  const [ganadores, setGanadores] = useState([]);
  const [premios, setPremios] = useState([]);
  const [patrocinadores, setPatrocinadores] = useState([]);
  const [auditoria, setAuditoria] = useState([]);
  const [config, setConfig] = useState(null);
  const [valores, setValores] = useState({});
  const [formPatrocinador, setFormPatrocinador] = useState(PATROCINADOR_VACIO);
  const [claves, setClaves] = useState({ nueva: '', confirmar: '' });

  const cargar = useCallback(async () => {
    const [p, g] = await Promise.all([
      supabase.from('participantes').select(COLUMNAS_PARTICIPANTE).order('fecha', { ascending: false }),
      supabase.from('ganadores').select('*').order('fecha', { ascending: false }),
    ]);
    if (!p.error) setParticipantes(p.data);
    if (!g.error) setGanadores(g.data);
    if (!esAdmin) return;
    const [pr, s, a, c] = await Promise.all([
      supabase.from('premios').select('*').order('peso', { ascending: false }),
      supabase.from('patrocinadores').select('*').order('orden'),
      supabase.from('auditoria_admin').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('configuracion_campana').select('value').eq('key', 'principal').maybeSingle(),
    ]);
    if (!pr.error) setPremios(pr.data);
    if (!s.error) setPatrocinadores(s.data);
    if (!a.error) setAuditoria(a.data);
    if (!c.error && c.data) setConfig((actual) => actual ?? c.data.value);
  }, [esAdmin]);

  useEffect(() => {
    cargar();
    const intervalo = window.setInterval(cargar, 15000);
    return () => window.clearInterval(intervalo);
  }, [cargar]);

  const pendientes = useMemo(() => participantes.filter((p) => p.estado === 'pendiente').reverse(), [participantes]);
  const aprobadas = useMemo(() => participantes.filter((p) => p.estado === 'aprobada'), [participantes]);
  const porEntregar = useMemo(() => ganadores.filter((g) => g.estado === 'pendiente'), [ganadores]);

  const metricas = useMemo(() => ({
    ventas: aprobadas.reduce((t, p) => t + Number(p.valor), 0),
    puntos: aprobadas.reduce((t, p) => t + Number(p.puntos), 0),
    ganados: ganadores.filter((g) => g.es_premio).length,
    entregados: ganadores.filter((g) => g.estado === 'entregado').length,
  }), [aprobadas, ganadores]);

  const ventasPorSede = useMemo(() => {
    const mapa = new Map();
    aprobadas.forEach((p) => {
      const fila = mapa.get(p.sede) || { sede: p.sede, prefijo: p.prefijo_factura, ventas: 0, facturas: 0, puntos: 0 };
      fila.ventas += Number(p.valor);
      fila.facturas += 1;
      fila.puntos += Number(p.puntos);
      mapa.set(p.sede, fila);
    });
    return [...mapa.values()];
  }, [aprobadas]);

  const ventasPorPatrocinador = useMemo(() => patrocinadores.map((s) => {
    const asociadas = aprobadas.filter((p) => (p.patrocinadores_ids || []).map(Number).includes(Number(s.id)));
    const ids = new Set(asociadas.map((p) => p.id));
    return {
      patrocinador: s.nombre,
      facturas: asociadas.length,
      ventas: asociadas.reduce((t, p) => t + Number(p.valor), 0),
      puntos: asociadas.reduce((t, p) => t + Number(p.puntos), 0),
      premios_ganados: ganadores.filter((g) => g.es_premio && ids.has(g.participante_id)).length,
    };
  }).filter((f) => f.facturas > 0), [patrocinadores, aprobadas, ganadores]);

  async function validar(p, aprobar) {
    const nota = aprobar ? null : prompt('Motivo del rechazo (lo verá el cliente):', '');
    if (!aprobar && nota === null) return;
    const valor = valores[p.id] === undefined || valores[p.id] === '' ? null : Number(valores[p.id]);
    const { error } = await supabase.rpc('validar_factura', { p_id: p.id, p_aprobar: aprobar, p_valor: valor, p_nota: nota });
    if (error) alert(error.message);
    await cargar();
  }

  async function entregar(id) {
    const { error } = await supabase.rpc('marcar_entrega', { p_ganador: id });
    if (error) alert(error.message);
    await cargar();
  }

  async function guardarConfig(e) {
    e.preventDefault();
    const { error } = await supabase.from('configuracion_campana').update({ value: config, updated_at: new Date().toISOString() }).eq('key', 'principal');
    if (error) {
      alert(`No se pudo guardar: ${error.message}`);
      return;
    }
    await supabase.rpc('registrar_auditoria', { p_accion: 'Configuración actualizada', p_detalle: `Campaña ${config.activa ? 'abierta' : 'cerrada'}.` });
    alert('Configuración guardada.');
    await cargar();
  }

  async function actualizarPremio(id, campo, valor) {
    const { error } = await supabase.from('premios').update({ [campo]: valor }).eq('id', id);
    if (error) alert(`No se pudo guardar: ${error.message}`);
    await cargar();
  }

  async function subirCSV(e) {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    try {
      const contenido = decodificarArchivo(await archivo.arrayBuffer());
      const { premios: nuevos, advertencias } = parsearPremiosCSV(contenido, patrocinadores);
      const aviso = advertencias.length ? `\n\nAdvertencias:\n${advertencias.join('\n')}` : '';
      if (!confirm(`Se reemplazarán los premios actuales por ${nuevos.length} del archivo.${aviso}\n\n¿Continuar?`)) return;
      const { error } = await supabase.rpc('reemplazar_premios', { p_premios: nuevos });
      if (error) throw error;
      alert('Premios cargados.');
      await cargar();
    } catch (error) {
      alert(error.message);
    }
  }

  async function guardarPatrocinador(e) {
    e.preventDefault();
    const { error } = await supabase.from('patrocinadores').insert({ ...formPatrocinador, nombre: formPatrocinador.nombre.trim(), orden: Number(formPatrocinador.orden || 99) });
    if (error) {
      alert(error.code === '23505' ? 'Ese patrocinador ya existe.' : `No se pudo guardar: ${error.message}`);
      return;
    }
    setFormPatrocinador(PATROCINADOR_VACIO);
    await cargar();
  }

  async function actualizarPatrocinador(id, campo, valor) {
    const { error } = await supabase.from('patrocinadores').update({ [campo]: valor, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) alert(`No se pudo guardar: ${error.message}`);
    await cargar();
  }

  async function subirLogo(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    try {
      const logo = await leerImagen(archivo, 700000);
      setFormPatrocinador((f) => ({ ...f, logo_url: logo }));
    } catch (error) {
      alert(error.message);
    }
  }

  async function generarBackup() {
    const { data: autorizaciones } = await supabase.from('autorizaciones_datos').select('*');
    const corte = { fecha: new Date().toISOString(), config, premios, patrocinadores, participantes, ganadores, autorizaciones, auditoria };
    const { error } = await supabase.from('backups_campana').insert({ tipo: 'manual', data: corte, usuario: correo });
    if (error) alert(`La copia no quedó en la base: ${error.message}`);
    descargar(`backup_campana_${corte.fecha.slice(0, 10)}.json`, JSON.stringify(corte, null, 2), 'application/json;charset=utf-8');
  }

  async function reiniciar() {
    const confirmacion = prompt('Esto borra participantes, autorizaciones y resultados en todos los dispositivos. Haga un backup antes. Escriba BORRAR TODO para continuar:');
    if (confirmacion === null) return;
    const { error } = await supabase.rpc('reiniciar_campana', { p_confirmacion: confirmacion });
    alert(error ? error.message : 'Campaña reiniciada.');
    await cargar();
  }

  async function cambiarClave(e) {
    e.preventDefault();
    if (claves.nueva.length < 10) {
      alert('La clave debe tener mínimo 10 caracteres.');
      return;
    }
    if (claves.nueva !== claves.confirmar) {
      alert('La confirmación no coincide.');
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: claves.nueva });
    setClaves({ nueva: '', confirmar: '' });
    alert(error ? error.message : 'Clave actualizada.');
  }

  return (
    <>
      <div className="adminHeader">
        <div><h2>{esAdmin ? 'Panel administrativo' : 'Validación en caja'}</h2><p>{correo}</p></div>
        <button className="logout" onClick={() => supabase.auth.signOut()}>Salir</button>
      </div>

      <div className="card adminSubCard">
        <h2>Facturas por validar ({pendientes.length})</h2>
        <p className="muted">Compare la factura física con estos datos. Corrija el valor si no coincide antes de aprobar.</p>
        {pendientes.length === 0 && <p>No hay facturas pendientes.</p>}
        {pendientes.map((p) => (
          <div className="filaValidacion" key={p.id}>
            <div>
              <strong>{p.factura}</strong>
              <small>{p.nombre} {p.apellido} · {p.sede}{p.marca_compra ? ` · Marcas: ${p.marca_compra}` : ''}</small>
              <small>Valor digitado: {money(p.valor)} · {fecha(p.fecha)}</small>
            </div>
            <input type="number" min="0" aria-label={`Valor confirmado de ${p.factura}`} placeholder={String(p.valor)} value={valores[p.id] ?? ''} onChange={(e) => setValores({ ...valores, [p.id]: e.target.value })} />
            <button className="primary" onClick={() => validar(p, true)}>Aprobar</button>
            <button className="logout" onClick={() => validar(p, false)}>Rechazar</button>
          </div>
        ))}
      </div>

      <div className="card adminSubCard">
        <h2>Premios por entregar ({porEntregar.length})</h2>
        {porEntregar.length === 0 && <p>No hay premios pendientes de entrega.</p>}
        {porEntregar.map((g) => (
          <div className="filaValidacion" key={g.id}>
            <div>
              <strong>{g.premio}</strong>
              <small>{g.nombre} · {g.factura} · {g.sede} · {fecha(g.fecha)}</small>
            </div>
            <button className="primary" onClick={() => entregar(g.id)}>Marcar entregado</button>
          </div>
        ))}
      </div>

      {esAdmin && (
        <>
          <div className="adminDashboard">
            <div><span>Ventas validadas</span><strong>{money(metricas.ventas)}</strong></div>
            <div><span>Facturas aprobadas</span><strong>{aprobadas.length}</strong></div>
            <div><span>Giros realizados</span><strong>{ganadores.length}</strong></div>
            <div><span>Premios ganados</span><strong>{metricas.ganados}</strong></div>
            <div><span>Premios entregados</span><strong>{metricas.entregados}</strong></div>
            <div><span>Puntos generados</span><strong>{metricas.puntos}</strong></div>
          </div>

          <div className="card adminSubCard">
            <h2>Ventas por sede</h2>
            <div className="salesGrid">
              {ventasPorSede.length === 0 && <p className="muted">Aún no hay ventas validadas.</p>}
              {ventasPorSede.map((v) => <div key={v.sede}><b>{v.prefijo}</b><strong>{money(v.ventas)}</strong><span>{v.facturas} factura(s) · {v.puntos} pts</span></div>)}
            </div>
          </div>

          <div className="card adminSubCard">
            <h2>Ventas por patrocinador</h2>
            <div className="salesGrid">
              {ventasPorPatrocinador.length === 0 && <p className="muted">Aún no hay ventas asociadas a patrocinadores.</p>}
              {ventasPorPatrocinador.map((v) => <div key={v.patrocinador}><b>{v.patrocinador}</b><strong>{money(v.ventas)}</strong><span>{v.facturas} factura(s) · {v.puntos} pts</span></div>)}
            </div>
          </div>

          <div className="adminGrid">
            <button onClick={() => descargarExcel('participantes', participantes)}>Participantes Excel</button>
            <button onClick={() => descargarExcel('ganadores', ganadores)}>Ganadores Excel</button>
            <button onClick={() => descargarExcel('ventas_por_sede', ventasPorSede)}>Ventas Excel</button>
            <button onClick={() => descargarExcel('ventas_por_patrocinador', ventasPorPatrocinador)}>Patrocinadores Excel</button>
            <button onClick={() => descargarExcel('auditoria', auditoria)}>Auditoría Excel</button>
            <button onClick={generarBackup}>Backup JSON</button>
            <label className="uploadBtn">Subir CSV premios<input type="file" accept=".csv" onChange={subirCSV} /></label>
            <button className="danger" onClick={reiniciar}>Reiniciar campaña</button>
          </div>

          {config && (
            <div className="card adminSubCard">
              <h2>Configuración</h2>
              <p className="muted">Antes de abrir la campaña actualice la última factura emitida por sede. La primera válida es el número siguiente.</p>
              <form className="grid" onSubmit={guardarConfig}>
                <label className="checkLine"><input type="checkbox" checked={Boolean(config.activa)} onChange={(e) => setConfig({ ...config, activa: e.target.checked })} /> Campaña abierta</label>
                <label className="checkLine"><input type="checkbox" checked={config.unPremioPorFactura !== false} onChange={(e) => setConfig({ ...config, unPremioPorFactura: e.target.checked })} /> Un solo premio por factura</label>
                <label>Inicio<input type="datetime-local" value={aFechaLocal(config.fechaInicio)} onChange={(e) => setConfig({ ...config, fechaInicio: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
                <label>Cierre<input type="datetime-local" value={aFechaLocal(config.fechaFin)} onChange={(e) => setConfig({ ...config, fechaFin: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
                {[['compraMinima', 'Compra mínima'], ['valorPorOportunidad', 'Valor por oportunidad'], ['puntosPorOportunidad', 'Puntos por oportunidad'], ['maxOportunidades', 'Máximo de oportunidades'], ['ultimaFacturaFE', 'Última factura FE'], ['ultimaFacturaFD', 'Última factura FD'], ['ultimaFacturaSTFD', 'Última factura STFD']].map(([campo, etiqueta]) => (
                  <label key={campo}>{etiqueta}<input type="number" min="0" value={config[campo] ?? 0} onChange={(e) => setConfig({ ...config, [campo]: Number(e.target.value) })} /></label>
                ))}
                <label>Versión del reglamento<input value={config.reglamento || ''} onChange={(e) => setConfig({ ...config, reglamento: e.target.value })} /></label>
                <label>Versión de la autorización<input value={config.autorizacion || ''} onChange={(e) => setConfig({ ...config, autorizacion: e.target.value })} /></label>
                <button className="primary" type="submit">Guardar configuración</button>
              </form>
            </div>
          )}

          <div className="card adminSubCard">
            <h2>Premios y probabilidades</h2>
            <p className="muted">Los cambios se guardan al salir de cada campo. El cliente no ve las probabilidades.</p>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Premio</th><th>Categoría</th><th>Stock</th><th>Peso</th><th>Visible</th><th>Sin límite</th><th>Patrocinador</th></tr></thead>
                <tbody>
                  {premios.map((p) => (
                    <tr key={`${p.id}-${p.cantidad}-${p.peso}`}>
                      <td><input defaultValue={p.premio} onBlur={(e) => e.target.value !== p.premio && actualizarPremio(p.id, 'premio', e.target.value)} /></td>
                      <td><input defaultValue={p.categoria} onBlur={(e) => e.target.value !== p.categoria && actualizarPremio(p.id, 'categoria', e.target.value)} /></td>
                      <td><input type="number" min="0" defaultValue={p.cantidad} onBlur={(e) => Number(e.target.value) !== p.cantidad && actualizarPremio(p.id, 'cantidad', Number(e.target.value))} /></td>
                      <td><input type="number" min="0" step="0.1" defaultValue={p.peso} onBlur={(e) => Number(e.target.value) !== Number(p.peso) && actualizarPremio(p.id, 'peso', Number(e.target.value))} /></td>
                      <td><input type="checkbox" checked={p.visible_cliente} onChange={(e) => actualizarPremio(p.id, 'visible_cliente', e.target.checked)} /></td>
                      <td><input type="checkbox" checked={!p.entrega_premio} onChange={(e) => actualizarPremio(p.id, 'entrega_premio', !e.target.checked)} /></td>
                      <td>
                        <select value={p.patrocinador_id || ''} onChange={(e) => actualizarPremio(p.id, 'patrocinador_id', e.target.value ? Number(e.target.value) : null)}>
                          <option value="">General</option>
                          {patrocinadores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card adminSubCard">
            <h2>Patrocinadores</h2>
            <form className="grid" onSubmit={guardarPatrocinador}>
              {[['nombre', 'Nombre'], ['empresa', 'Empresa'], ['responsable', 'Responsable'], ['whatsapp', 'WhatsApp'], ['correo', 'Correo'], ['pagina_web', 'Página web'], ['instagram', 'Instagram']].map(([campo, etiqueta]) => (
                <label key={campo}>{etiqueta}<input required={campo === 'nombre'} value={formPatrocinador[campo]} onChange={(e) => setFormPatrocinador({ ...formPatrocinador, [campo]: e.target.value })} /></label>
              ))}
              <label>Orden<input type="number" value={formPatrocinador.orden} onChange={(e) => setFormPatrocinador({ ...formPatrocinador, orden: e.target.value })} /></label>
              <label>Logo<input type="file" accept="image/*" onChange={subirLogo} /></label>
              <button className="primary" type="submit">Agregar patrocinador</button>
            </form>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Logo</th><th>Patrocinador</th><th>Orden</th><th>Activo</th></tr></thead>
                <tbody>
                  {patrocinadores.map((s) => (
                    <tr key={`${s.id}-${s.orden}`}>
                      <td>{s.logo_url ? <img className="miniLogo" src={s.logo_url} alt={s.nombre} /> : 'Sin logo'}</td>
                      <td><strong>{s.nombre}</strong></td>
                      <td><input type="number" defaultValue={s.orden} onBlur={(e) => Number(e.target.value) !== s.orden && actualizarPatrocinador(s.id, 'orden', Number(e.target.value))} /></td>
                      <td><input type="checkbox" checked={s.activo} onChange={(e) => actualizarPatrocinador(s.id, 'activo', e.target.checked)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card adminSubCard">
            <h2>Histórico de cambios</h2>
            <div className="auditList">
              {auditoria.length === 0 && <p>No hay cambios registrados.</p>}
              {auditoria.slice(0, 50).map((c) => <div key={c.id}><b>{fecha(c.created_at)}</b><span>{c.accion}</span><small>{c.usuario} · {c.detalle}</small></div>)}
            </div>
          </div>
        </>
      )}

      <div className="card adminSubCard">
        <h2>Cambiar mi contraseña</h2>
        <form className="grid" onSubmit={cambiarClave}>
          <label>Nueva clave<input type="password" autoComplete="new-password" value={claves.nueva} onChange={(e) => setClaves({ ...claves, nueva: e.target.value })} /></label>
          <label>Confirmar<input type="password" autoComplete="new-password" value={claves.confirmar} onChange={(e) => setClaves({ ...claves, confirmar: e.target.value })} /></label>
          <button className="primary" type="submit">Guardar nueva clave</button>
        </form>
      </div>
    </>
  );
}
