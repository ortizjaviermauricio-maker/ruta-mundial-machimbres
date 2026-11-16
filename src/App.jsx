import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import './styles.css';
import { supabase } from './supabase';
import Rueda from './Rueda.jsx';
import { CAMPANA, SEDES_RESPALDO, girosPorCompra, money, puntos, separarNombre, siguienteRotacion } from './campana';

const Admin = lazy(() => import('./Admin.jsx'));

const CLAVE_TOKEN = 'campana_factura_token';
const NAVEGACION = ['Inicio', 'Participar', 'Ruleta', 'Ranking', 'Más'];
const FORM_VACIO = { nombreCompleto: '', celular: '', sede: '', factura: '', valorCompra: '', autorizacion: false, aceptaReglamento: false, codigoPrueba: '', tipoDocumento: 'CC', numeroDocumento: '', patrocinadorIds: [], valoresMarca: {} };
const CONFIG_VACIA = { activa: false, compraMinima: 0, valorPorOportunidad: 1, puntosPorOportunidad: 0, maxOportunidades: 0, sedes: SEDES_RESPALDO };
const DURACION_GIRO = 3300;

function leerToken() {
  try {
    return localStorage.getItem(CLAVE_TOKEN) || '';
  } catch {
    return '';
  }
}

function guardarToken(token) {
  try {
    if (token) localStorage.setItem(CLAVE_TOKEN, token);
    else localStorage.removeItem(CLAVE_TOKEN);
  } catch {
    // Sin almacenamiento el cliente puede recuperar la factura con su celular.
  }
}

export default function App() {
  const [vista, setVista] = useState('Inicio');
  const [publico, setPublico] = useState({ config: CONFIG_VACIA, premios: [], patrocinadores: [], ranking: [], rankingMarcas: [] });
  const [errorCarga, setErrorCarga] = useState('');
  const [token, setToken] = useState(leerToken);
  const [factura, setFactura] = useState(null);

  const { config, premios, patrocinadores, ranking } = publico;
  const rankingMarcas = publico.rankingMarcas || [];
  const sedes = config.sedes?.length ? config.sedes : SEDES_RESPALDO;

  const cargarPublico = useCallback(async () => {
    const { data, error } = await supabase.rpc('campana_publica');
    if (error) {
      setErrorCarga('No pudimos cargar la campaña. Intenta de nuevo en unos minutos.');
      return;
    }
    setErrorCarga('');
    setPublico(data);
  }, []);

  const cargarFactura = useCallback(async () => {
    if (!token) {
      setFactura(null);
      return;
    }
    const { data, error } = await supabase.rpc('estado_factura', { p_token: token });
    if (error) return;
    if (!data) {
      guardarToken('');
      setToken('');
      setFactura(null);
      return;
    }
    setFactura(data);
  }, [token]);

  useEffect(() => {
    cargarPublico();
    const intervalo = window.setInterval(cargarPublico, 30000);
    return () => window.clearInterval(intervalo);
  }, [cargarPublico]);

  useEffect(() => {
    cargarFactura();
  }, [cargarFactura]);

  // Mientras la caja valida, la pantalla del cliente se actualiza sola.
  useEffect(() => {
    if (factura?.estado !== 'pendiente') return undefined;
    const intervalo = window.setInterval(cargarFactura, 5000);
    return () => window.clearInterval(intervalo);
  }, [factura?.estado, cargarFactura]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [vista]);

  function usarToken(nuevo) {
    guardarToken(nuevo);
    setToken(nuevo);
  }

  function nuevaFactura() {
    usarToken('');
    setFactura(null);
    setVista('Participar');
  }

  async function alRegistrar(nuevoToken) {
    usarToken(nuevoToken);
    setVista('Ruleta');
  }

  const personal = vista === 'Personal';

  return (
    <div className={`app ${personal ? 'ancho' : ''}`}>
      <header className="cabecera">
        <img src="/logo-machimbres.png" alt="Machimbres y Maderas" />
        <span>{CAMPANA.desde}</span>
      </header>

      {errorCarga && <div className="aviso error" role="alert">{errorCarga}</div>}
      {config.modoPruebas && !personal && <div className="aviso prueba">MODO PRUEBAS: nada de lo registrado aquí es real.</div>}
      {!errorCarga && !config.activa && !personal && <div className="aviso">La campaña todavía no está abierta. Muy pronto podrás participar.</div>}

      <main className="vista">
        {vista === 'Inicio' && <Inicio config={config} patrocinadores={patrocinadores} alParticipar={() => setVista(factura ? 'Ruleta' : 'Participar')} />}
        {vista === 'Participar' && <Registro config={config} sedes={sedes} patrocinadores={patrocinadores} alRegistrar={alRegistrar} />}
        {vista === 'Ruleta' && (
          <Ruleta
            token={token}
            factura={factura}
            alCambiar={() => Promise.all([cargarFactura(), cargarPublico()])}
            alRecuperar={usarToken}
            alNuevaFactura={nuevaFactura}
          />
        )}
        {vista === 'Ranking' && <Ranking ranking={ranking} rankingMarcas={rankingMarcas} sedes={sedes} token={token} />}
        {vista === 'Más' && <Mas alElegir={setVista} />}
        {vista === 'Premios' && <Premios premios={premios} sedes={sedes} />}
        {vista === 'Cómo funciona' && <ComoFunciona config={config} sedes={sedes} />}
        {vista === 'Reglamento' && <Reglamento />}
        {vista === 'Sedes' && <Sedes sedes={sedes} />}
        {personal && <div className="cuerpo"><Suspense fallback={<p>Cargando…</p>}><Admin /></Suspense></div>}
      </main>

      <nav className="navegacion" aria-label="Principal">
        {NAVEGACION.map((item) => (
          <button key={item} type="button" className={vista === item ? 'activa' : ''} aria-current={vista === item ? 'page' : undefined} onClick={() => setVista(item)}>{item}</button>
        ))}
      </nav>
    </div>
  );
}

function Inicio({ config, patrocinadores, alParticipar }) {
  return (
    <div className="cuerpo oscuro centrado inicio">
      <h1 className="titular" style={{ fontSize: 52 }}>{CAMPANA.titular}</h1>
      <p className="titular acento" style={{ fontSize: 25 }}>{CAMPANA.subtitulo}</p>
      <Rueda />
      <p className="nota">{CAMPANA.invitacion}</p>
      <button type="button" className="boton" onClick={alParticipar}>REGISTRAR MI FACTURA</button>
      {Number(config.compraMinima) > 0 && <p className="nota">Compras desde {money(config.compraMinima)} suman al ranking. Cada {money(config.valorPorOportunidad)} te da un giro.</p>}
      <section className="compromiso">
        <p>{CAMPANA.compromiso}</p>
        <ul>{CAMPANA.pilares.map((pilar) => <li key={pilar}>{pilar}</li>)}</ul>
      </section>
      <section className="marcas-lamina">
        <h2>Marcas de láminas que manejamos</h2>
        <ul>{CAMPANA.marcas.map((m) => <li key={m.nombre}>{m.logo ? <img src={m.logo} alt={m.nombre} /> : m.nombre}</li>)}</ul>
      </section>
      {patrocinadores.length > 0 && <Aliados patrocinadores={patrocinadores} />}
    </div>
  );
}

function Aliados({ patrocinadores }) {
  return (
    <div className="aliados" aria-label="Aliados de la campaña">
      {patrocinadores.map((p) => {
        const enlace = p.pagina_web || p.instagram || (p.whatsapp ? `https://wa.me/${String(p.whatsapp).replace(/\D/g, '')}` : '');
        const contenido = p.logo_url ? <img src={p.logo_url} alt={p.nombre} /> : <strong>{p.nombre}</strong>;
        return enlace
          ? <a key={p.id} href={enlace} target="_blank" rel="noopener noreferrer">{contenido}</a>
          : <span key={p.id}>{contenido}</span>;
      })}
    </div>
  );
}

function Registro({ config, sedes, patrocinadores, alRegistrar }) {
  const [form, setForm] = useState(FORM_VACIO);
  const [enviando, setEnviando] = useState(false);
  const [yaAutorizo, setYaAutorizo] = useState(false);
  const [textoAutorizacion, setTextoAutorizacion] = useState('');
  // La sede se deduce del prefijo de la factura, igual que en el servidor.
  const facturaLimpia = form.factura.replace(/[\s-]/g, '');
  const sedeDetectada = [...sedes].sort((a, b) => b.prefijo.length - a.prefijo.length)
    .find((s) => new RegExp(`^${s.prefijo}\\d+$`).test(facturaLimpia));
  const valor = Number(form.valorCompra || 0);
  const giros = girosPorCompra(valor, config);

  useEffect(() => {
    supabase.rpc('texto_autorizacion').then(({ data }) => setTextoAutorizacion(data || ''));
  }, []);

  // Quien ya autorizó con este celular no vuelve a recibir la solicitud de datos.
  useEffect(() => {
    const celular = form.celular.replace(/\D/g, '');
    if (celular.length < 7) {
      setYaAutorizo(false);
      return undefined;
    }
    let vigente = true;
    const espera = window.setTimeout(async () => {
      const { data } = await supabase.rpc('autorizacion_vigente', { p_celular: celular });
      if (vigente) setYaAutorizo(Boolean(data));
    }, 400);
    return () => {
      vigente = false;
      window.clearTimeout(espera);
    };
  }, [form.celular]);

  function alternarMarca(id) {
    setForm((prev) => {
      const activa = prev.patrocinadorIds.includes(id);
      const valoresMarca = { ...prev.valoresMarca };
      if (activa) delete valoresMarca[id];
      return { ...prev, valoresMarca, patrocinadorIds: activa ? prev.patrocinadorIds.filter((x) => x !== id) : [...prev.patrocinadorIds, id] };
    });
  }
  const sumaMarcas = form.patrocinadorIds.reduce((t, id) => t + Number(form.valoresMarca[id] || 0), 0);
  const marcasExcedidas = sumaMarcas > valor;

  async function enviar(e) {
    e.preventDefault();
    if (marcasExcedidas) {
      alert('La suma de las marcas no puede superar el valor de la factura.');
      return;
    }
    setEnviando(true);
    const { nombreCompleto, ...resto } = form;
    const { data, error } = await supabase.rpc('registrar_factura', {
      p_datos: {
        ...resto,
        valoresMarca: Object.fromEntries(form.patrocinadorIds.map((id) => [id, Number(form.valoresMarca[id] || 0)])),
        autorizacion: !yaAutorizo && form.autorizacion,
        ...separarNombre(nombreCompleto),
        sede: sedeDetectada?.nombre || '',
        userAgent: navigator.userAgent,
        idioma: navigator.language,
        plataforma: navigator.platform,
        origen: window.location.href,
      },
    });
    setEnviando(false);
    if (error) {
      alert(error.message);
      return;
    }
    alRegistrar(data.token);
  }

  return (
    <>
      <div className="barra"><h1>REGISTRA TU FACTURA</h1></div>
      <div className="cuerpo">
        <form className="formulario" onSubmit={enviar}>
          <label>Nombre completo<input id="nombre" required autoComplete="name" value={form.nombreCompleto} onChange={(e) => setForm({ ...form, nombreCompleto: e.target.value })} /></label>
          <label>Celular<input id="celular" required inputMode="tel" autoComplete="tel" value={form.celular} onChange={(e) => setForm({ ...form, celular: e.target.value })} /></label>
          <div className="dos">
            <label>Factura<input id="factura" required placeholder={`${sedes.map((x) => x.prefijo).join(', ')} + número`} autoCapitalize="characters" value={form.factura} onChange={(e) => setForm({ ...form, factura: e.target.value.toUpperCase() })} /></label>
            <label>Valor exacto<input id="valor" required type="number" inputMode="numeric" min="0" value={form.valorCompra} onChange={(e) => setForm({ ...form, valorCompra: e.target.value })} /></label>
          </div>
          {facturaLimpia && (
            <p className="nota" aria-live="polite" style={{ fontSize: 14 }}>
              {sedeDetectada ? `Sede: ${sedeDetectada.nombre}` : `La factura debe empezar con ${sedes.map((x) => x.prefijo).join(', ')}.`}
            </p>
          )}
          {patrocinadores.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, fontSize: 15, marginBottom: 5 }}>¿Compraste láminas de estas marcas?</legend>
              <p className="nota" style={{ fontSize: 14, margin: '0 0 6px' }}>Marca el proveedor y escribe cuánto de esta factura fue de esa marca. Suma para su ranking.</p>
              <div className="marcas">
                {patrocinadores.map((p) => (
                  <div key={p.id} className="marca-valor">
                    <label>
                      <input type="checkbox" checked={form.patrocinadorIds.includes(p.id)} onChange={() => alternarMarca(p.id)} />
                      {p.logo_url ? <img src={p.logo_url} alt={p.nombre} /> : p.nombre}
                    </label>
                    {form.patrocinadorIds.includes(p.id) && (
                      <input
                        aria-label={`Valor de ${p.nombre} en esta factura`}
                        placeholder={`Valor ${p.nombre}`}
                        required
                        type="number"
                        inputMode="numeric"
                        min="1"
                        value={form.valoresMarca[p.id] || ''}
                        onChange={(e) => setForm({ ...form, valoresMarca: { ...form.valoresMarca, [p.id]: e.target.value } })}
                      />
                    )}
                  </div>
                ))}
              </div>
              {marcasExcedidas && <p className="nota" role="alert" style={{ fontSize: 14, color: '#b42318' }}>La suma de las marcas ({money(sumaMarcas)}) supera el valor de la factura.</p>}
            </fieldset>
          )}
          {valor > 0 && (
            <div className="calculo">
              <span>{valor < Number(config.compraMinima) ? `Compra mínima: ${money(config.compraMinima)}` : giros > 0 ? 'Con esta compra tienes' : `Suma al ranking. Cada ${money(config.valorPorOportunidad)} da un giro`}</span>
              <strong>{giros} {giros === 1 ? 'GIRO' : 'GIROS'}</strong>
            </div>
          )}
          <p className="nota" style={{ fontSize: 14 }}>Registra los datos tal como aparecen en tu factura. La presentarás para reclamar tu premio.</p>
          {yaAutorizo
            ? <p className="nota" style={{ fontSize: 14 }}>Ya tenemos tu autorización de datos personales.</p>
            : (
              <>
                <div className="dos">
                  <label>Tipo de documento
                    <select id="tipo-documento" value={form.tipoDocumento} onChange={(e) => setForm({ ...form, tipoDocumento: e.target.value })}>
                      <option value="CC">Cédula</option>
                      <option value="NIT">NIT</option>
                      <option value="CE">Cédula de extranjería</option>
                      <option value="PA">Pasaporte</option>
                    </select>
                  </label>
                  <label>Número de documento<input id="numero-documento" required autoComplete="off" value={form.numeroDocumento} onChange={(e) => setForm({ ...form, numeroDocumento: e.target.value })} /></label>
                </div>
                <label className="casilla">
                  <input id="autorizacion" type="checkbox" required checked={form.autorizacion} onChange={(e) => setForm({ ...form, autorizacion: e.target.checked })} />
                  <span>{textoAutorizacion} {config.habeas && `Consultas y reclamos: ${config.habeas}.`}</span>
                </label>
              </>
            )}
          <label className="casilla">
            <input id="reglamento" type="checkbox" required checked={form.aceptaReglamento} onChange={(e) => setForm({ ...form, aceptaReglamento: e.target.checked })} />
            <span>Acepto el reglamento de la campaña.{' '}
              {CAMPANA.reglamentoPdf && <a href={CAMPANA.reglamentoPdf} target="_blank" rel="noopener noreferrer">Ver reglamento</a>}
            </span>
          </label>
          {config.modoPruebas && <label>Código de prueba<input id="codigo-prueba" required autoComplete="off" value={form.codigoPrueba} onChange={(e) => setForm({ ...form, codigoPrueba: e.target.value.trim() })} /></label>}
          <button className="boton empuje" type="submit" disabled={enviando || !config.activa || valor < Number(config.compraMinima)}>{enviando ? 'REGISTRANDO…' : 'CONTINUAR'}</button>
        </form>
      </div>
    </>
  );
}

function Ruleta({ token, factura, alCambiar, alRecuperar, alNuevaFactura }) {
  const [rotacion, setRotacion] = useState(0);
  const [girando, setGirando] = useState(false);
  const [resultado, setResultado] = useState(null);

  async function girar() {
    setGirando(true);
    setResultado(null);
    const { data, error } = await supabase.rpc('girar', { p_token: token });
    if (error) {
      setGirando(false);
      alert(error.message);
      await alCambiar();
      return;
    }
    setRotacion((actual) => siguienteRotacion(actual));
    window.setTimeout(async () => {
      setGirando(false);
      setResultado(data);
      await alCambiar();
    }, DURACION_GIRO);
  }

  if (resultado) {
    return <Resultado resultado={resultado} factura={factura} alSeguir={() => setResultado(null)} alNuevaFactura={alNuevaFactura} />;
  }
  if (!factura) return <Recuperar alRecuperar={alRecuperar} />;

  if (factura.estado === 'pendiente') {
    return (
      <>
        <div className="barra"><h1>¡YA CASI!</h1></div>
        <div className="cuerpo centrado">
          <p className="titular" style={{ fontSize: 38 }}>MUESTRA ESTA PANTALLA Y TU FACTURA EN CAJA</p>
          <div className="ficha">
            <span className="nota">Factura</span>
            <strong>{factura.factura}</strong>
            <span className="giros">{factura.oportunidades} {factura.oportunidades === 1 ? 'giro' : 'giros'} por habilitar</span>
          </div>
          <p className="nota" aria-live="polite">Cuando el asesor apruebe tu factura, esta pantalla cambiará sola.</p>
        </div>
      </>
    );
  }

  if (factura.estado === 'rechazada') {
    return (
      <>
        <div className="barra"><h1>FACTURA NO APROBADA</h1></div>
        <div className="cuerpo centrado">
          <div className="ficha"><span className="nota">Factura</span><strong>{factura.factura}</strong></div>
          <p className="nota">{factura.nota || 'Acércate a la caja para revisarla.'}</p>
          <button type="button" className="boton empuje" onClick={alNuevaFactura}>REGISTRAR OTRA FACTURA</button>
        </div>
      </>
    );
  }

  if (factura.oportunidades === 0) {
    return (
      <>
        <div className="barra"><h1>FACTURA REGISTRADA</h1></div>
        <div className="cuerpo centrado">
          <div className="ficha"><span className="nota">Factura</span><strong>{factura.factura}</strong></div>
          <p className="nota">Esta compra no alcanza para un giro, pero se acumula en tu puntaje del ranking.</p>
          <button type="button" className="boton empuje" onClick={alNuevaFactura}>REGISTRAR OTRA FACTURA</button>
        </div>
      </>
    );
  }

  const sinGiros = factura.restantes <= 0;
  return (
    <div className="cuerpo oscuro centrado">
      <h1 className="titular" style={{ fontSize: 42 }} aria-live="polite">
        {girando ? 'GIRANDO…' : sinGiros ? 'YA USASTE TUS GIROS' : `TIENES ${factura.restantes} ${factura.restantes === 1 ? 'GIRO' : 'GIROS'}`}
      </h1>
      <p className="nota">Factura {factura.factura}</p>
      {factura.marcas && <p className="nota">También participas por beneficios de {factura.marcas}</p>}
      <Rueda rotacion={rotacion} />
      {sinGiros
        ? <button type="button" className="boton empuje" onClick={alNuevaFactura}>REGISTRAR OTRA FACTURA</button>
        : <button type="button" className="boton empuje" disabled={girando} onClick={girar}>GIRAR</button>}
    </div>
  );
}

// Último día para reclamar: vence_at es la medianoche siguiente en Colombia.
function fechaLimite(venceAt) {
  const d = new Date(new Date(venceAt).getTime() - 1000);
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
}

function Resultado({ resultado, factura, alSeguir, alNuevaFactura }) {
  return (
    <div className={`resultado ${resultado.es_premio ? '' : 'sin'}`}>
      <p className="titular" style={{ fontSize: resultado.es_premio ? 34 : 26 }}>{resultado.es_premio ? '¡GANASTE!' : '¡GRACIAS POR CONSTRUIR HISTORIA CON NOSOTROS!'}</p>
      <div className="tarjeta">
        <strong>{resultado.es_premio ? resultado.premio : 'Esta vez no ganaste, pero sigue intentándolo.'}</strong>
        {factura && <span className="nota">Factura {factura.factura}</span>}
      </div>
      <p style={{ fontWeight: 600 }}>{resultado.es_premio ? 'Reclámalo en caja con tu factura original y tu documento.' : 'Eres un cliente muy importante para Machimbres y Maderas. Gracias por ser parte de estos 39 años.'}</p>
      {resultado.es_premio && resultado.vence_at && (
        <div className="tarjeta" role="alert">
          <strong>Tienes {resultado.dias_reclamo || 8} días para reclamarlo: hasta el {fechaLimite(resultado.vence_at)}.</strong>
          <span>Si no lo reclamas en ese plazo, pierdes el premio y vuelve a la ruleta para otros clientes.</span>
        </div>
      )}
      {resultado.es_premio && resultado.restantes > 0 && <p>Ya ganaste tu premio de la campaña: {resultado.restantes === 1 ? 'tu giro restante no dará' : `tus ${resultado.restantes} giros restantes no darán`} otro premio, pero tus compras siguen sumando al ranking.</p>}
      {resultado.restantes > 0
        ? <button type="button" className="boton oscuro-b empuje" onClick={alSeguir}>{resultado.es_premio ? 'USAR GIROS RESTANTES' : 'SEGUIR GIRANDO'}</button>
        : <button type="button" className="boton oscuro-b empuje" onClick={alNuevaFactura}>REGISTRAR OTRA FACTURA</button>}
    </div>
  );
}

function Recuperar({ alRecuperar }) {
  const [datos, setDatos] = useState({ factura: '', celular: '' });

  async function recuperar(e) {
    e.preventDefault();
    const { data, error } = await supabase.rpc('recuperar_factura', { p_factura: datos.factura, p_celular: datos.celular });
    if (error) {
      alert(error.message);
      return;
    }
    alRecuperar(data.token);
  }

  return (
    <>
      <div className="barra"><h1>RETOMA TUS GIROS</h1></div>
      <div className="cuerpo">
        <p className="nota">Si ya registraste tu factura, escribe sus datos para continuar.</p>
        <form className="formulario" onSubmit={recuperar}>
          <label>Factura<input id="rec-factura" required value={datos.factura} onChange={(e) => setDatos({ ...datos, factura: e.target.value.toUpperCase() })} /></label>
          <label>Celular<input id="rec-celular" required inputMode="tel" value={datos.celular} onChange={(e) => setDatos({ ...datos, celular: e.target.value })} /></label>
          <button className="boton empuje" type="submit">RETOMAR MIS GIROS</button>
        </form>
      </div>
    </>
  );
}

function Ranking({ ranking, rankingMarcas, sedes, token }) {
  const [pestana, setPestana] = useState('general');
  const [yo, setYo] = useState(null);
  useEffect(() => {
    if (!token) return;
    supabase.rpc('mi_posicion', { p_token: token }).then(({ data }) => setYo(data || null));
  }, [token, ranking]);
  const marca = rankingMarcas.find((m) => String(m.id) === pestana);
  const filas = marca ? marca.ranking : ranking;
  const mia = marca ? yo?.marcas?.find((m) => String(m.id) === pestana) : yo?.general;
  const prefijo = (nombre) => sedes.find((s) => s.nombre === nombre)?.prefijo;
  return (
    <>
      <div className="barra"><h1>RANKING</h1></div>
      <div className="cuerpo">
        {rankingMarcas.length > 0 && (
          <div className="pestanas" role="tablist">
            <button type="button" role="tab" aria-selected={pestana === 'general'} onClick={() => setPestana('general')}>General</button>
            {rankingMarcas.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={pestana === String(m.id)} onClick={() => setPestana(String(m.id))}>{m.nombre}</button>
            ))}
          </div>
        )}
        <p className="nota" style={{ fontSize: 14 }}>
          {marca
            ? `Suma lo que registras de ${marca.nombre} en tus facturas. Ganan los ${marca.ganadores} primeros.`
            : 'Suman todas tus compras registradas en cualquier sede.'}
        </p>
        {mia && <div className="mi-posicion">Tu posición: <b>{mia.posicion}</b> · {puntos(mia.puntos)} pts</div>}
        {filas.length === 0 && <p className="nota">Aún no hay participantes.</p>}
        <div>
          {filas.map((p) => (
            <div className="fila" key={p.posicion}>
              <b>{p.posicion}</b>
              <div>{p.sede}<small>{prefijo(p.sede) ? `Sede ${prefijo(p.sede)}` : 'Sede'}</small></div>
              <strong>{puntos(p.puntos)} pts</strong>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Mas({ alElegir }) {
  return (
    <>
      <div className="barra"><h1>MÁS</h1></div>
      <div className="lista">
        {['Premios', 'Cómo funciona', 'Reglamento', 'Sedes', 'Personal'].map((item) => (
          <button key={item} type="button" onClick={() => alElegir(item)}>{item}<span aria-hidden="true">›</span></button>
        ))}
      </div>
    </>
  );
}

function Premios({ premios, sedes }) {
  const etiquetaSede = (nombre) => {
    const sede = sedes.find((s) => s.nombre === nombre);
    return `Solo sede ${sede?.prefijo || nombre}`;
  };
  return (
    <>
      <div className="barra"><h1>PREMIOS</h1></div>
      <div className="cuerpo">
        {premios.length === 0 && <p className="nota">Muy pronto publicaremos los premios.</p>}
        <div>
          {premios.map((p) => (
            <div className="fila" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }} key={p.id}>
              <div>{p.nombre}<small>{p.categoria}{p.sede ? ` · ${etiquetaSede(p.sede)}` : ''}</small></div>
              <strong>{p.ilimitado ? '' : p.stock}</strong>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function ComoFunciona({ config, sedes }) {
  return (
    <>
      <div className="barra"><h1>CÓMO FUNCIONA</h1></div>
      <div className="cuerpo legal">
        <ul>
          <li>Compra mínima para participar: {money(config.compraMinima)}.</li>
          <li>Cada {money(config.valorPorOportunidad)} te da un giro, hasta {config.maxOportunidades} por factura.</li>
          <li>El ranking general suma todas tus compras registradas: {puntos(config.puntosPorOportunidad)} puntos por cada {money(config.valorPorOportunidad)} acumulado, sin tope.</li>
          <li>Si compras láminas de una marca aliada, marca el proveedor y su valor al registrar: sumas para el ranking de esa marca.</li>
          {config.unPremioPorCliente && <li>Cada cliente gana máximo un premio de la ruleta en la campaña. Después, sus giros siguen sumando al ranking.</li>}
          <li>El ranking público muestra puesto, sede y puntos, sin nombres.</li>
          <li>Prefijos de factura: {sedes.map((s) => s.prefijo).join(', ')}, sin guion.</li>
          <li>Cada factura se registra una sola vez y gira de inmediato.</li>
          <li>Para reclamar un premio debes presentar la factura original y tu documento; sus datos deben coincidir con lo registrado.</li>
          <li>Tienes {config.diasReclamo || 8} días calendario desde que ganas para reclamar el premio en la sede. Si no lo reclamas a tiempo, lo pierdes y el premio vuelve a la ruleta.</li>
        </ul>
      </div>
    </>
  );
}

function Reglamento() {
  return (
    <>
      <div className="barra"><h1>REGLAMENTO</h1></div>
      <div className="cuerpo">
        {CAMPANA.reglamentoPdf
          ? <a className="boton" href={CAMPANA.reglamentoPdf} target="_blank" rel="noopener noreferrer">VER REGLAMENTO</a>
          : <p className="nota">El reglamento se publicará antes de abrir la campaña.</p>}
        <p className="nota">Tus datos se tratan conforme a la Ley 1581 de 2012.</p>
      </div>
    </>
  );
}

function Sedes({ sedes }) {
  return (
    <>
      <div className="barra"><h1>SEDES</h1></div>
      <div className="cuerpo">
        <div>
          {sedes.map((s) => (
            <div className="fila" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }} key={s.prefijo}>
              <div>{s.nombre}</div><strong>{s.prefijo}</strong>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
