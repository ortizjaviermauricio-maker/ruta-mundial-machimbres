import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import './styles.css';
import { supabase } from './supabase';
import Rueda from './Rueda.jsx';
import { CAMPANA, SEDES_RESPALDO, girosPorCompra, money, puntos, separarNombre, siguienteRotacion } from './campana';

const Admin = lazy(() => import('./Admin.jsx'));

const CLAVE_TOKEN = 'campana_factura_token';
const NAVEGACION = ['Inicio', 'Participar', 'Ruleta', 'Ranking', 'Más'];
const FORM_VACIO = { nombreCompleto: '', celular: '', sede: '', factura: '', valorCompra: '', autorizacion: false, patrocinadorIds: [] };
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
  const [publico, setPublico] = useState({ config: CONFIG_VACIA, premios: [], patrocinadores: [], ranking: [] });
  const [errorCarga, setErrorCarga] = useState('');
  const [token, setToken] = useState(leerToken);
  const [factura, setFactura] = useState(null);

  const { config, premios, patrocinadores, ranking } = publico;
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
        {vista === 'Ranking' && <Ranking ranking={ranking} />}
        {vista === 'Más' && <Mas alElegir={setVista} />}
        {vista === 'Premios' && <Premios premios={premios} />}
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
        <ul>{CAMPANA.marcas.map((marca) => <li key={marca}>{marca}</li>)}</ul>
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
  const sede = form.sede || sedes[0].nombre;
  const prefijo = sedes.find((s) => s.nombre === sede)?.prefijo || 'FE';
  const valor = Number(form.valorCompra || 0);
  const giros = girosPorCompra(valor, config);

  function alternarMarca(id) {
    setForm((prev) => ({
      ...prev,
      patrocinadorIds: prev.patrocinadorIds.includes(id) ? prev.patrocinadorIds.filter((x) => x !== id) : [...prev.patrocinadorIds, id],
    }));
  }

  async function enviar(e) {
    e.preventDefault();
    setEnviando(true);
    const { nombreCompleto, ...resto } = form;
    const { data, error } = await supabase.rpc('registrar_factura', {
      p_datos: {
        ...resto,
        ...separarNombre(nombreCompleto),
        sede,
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
          <label>Sede
            <select id="sede" value={sede} onChange={(e) => setForm({ ...form, sede: e.target.value })}>
              {sedes.map((s) => <option key={s.prefijo} value={s.nombre}>{s.nombre}</option>)}
            </select>
          </label>
          <div className="dos">
            <label>Factura<input id="factura" required placeholder={`${prefijo}32150`} autoCapitalize="characters" value={form.factura} onChange={(e) => setForm({ ...form, factura: e.target.value.toUpperCase() })} /></label>
            <label>Valor exacto<input id="valor" required type="number" inputMode="numeric" min="0" value={form.valorCompra} onChange={(e) => setForm({ ...form, valorCompra: e.target.value })} /></label>
          </div>
          {patrocinadores.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, fontSize: 15, marginBottom: 5 }}>Marcas aliadas de tu compra</legend>
              <div className="marcas">
                {patrocinadores.map((p) => (
                  <label key={p.id}>
                    <input type="checkbox" checked={form.patrocinadorIds.includes(p.id)} onChange={() => alternarMarca(p.id)} />
                    {p.logo_url ? <img src={p.logo_url} alt={p.nombre} /> : p.nombre}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {valor > 0 && (
            <div className="calculo">
              <span>{valor < Number(config.compraMinima) ? `Compra mínima: ${money(config.compraMinima)}` : giros > 0 ? 'Con esta compra tienes' : `Suma al ranking. Cada ${money(config.valorPorOportunidad)} da un giro`}</span>
              <strong>{giros} {giros === 1 ? 'GIRO' : 'GIROS'}</strong>
            </div>
          )}
          <p className="nota" style={{ fontSize: 14 }}>Registra los datos tal como aparecen en tu factura. La presentarás para reclamar tu premio.</p>
          <label className="casilla">
            <input id="autorizacion" type="checkbox" required checked={form.autorizacion} onChange={(e) => setForm({ ...form, autorizacion: e.target.checked })} />
            <span>Acepto el tratamiento de datos personales y el reglamento de la campaña.{' '}
              {CAMPANA.reglamentoPdf && <a href={CAMPANA.reglamentoPdf} target="_blank" rel="noopener noreferrer">Ver reglamento</a>}
            </span>
          </label>
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

function Resultado({ resultado, factura, alSeguir, alNuevaFactura }) {
  return (
    <div className={`resultado ${resultado.es_premio ? '' : 'sin'}`}>
      <p className="titular" style={{ fontSize: 34 }}>{resultado.es_premio ? '¡GANASTE!' : 'ESTA VEZ NO FUE'}</p>
      <div className="tarjeta">
        <strong>{resultado.premio}</strong>
        {factura && <span className="nota">Factura {factura.factura}</span>}
      </div>
      <p style={{ fontWeight: 600 }}>{resultado.es_premio ? 'Reclámalo en caja con tu factura original y tu documento.' : 'Gracias por ser parte de estos 39 años.'}</p>
      {resultado.es_premio && resultado.restantes > 0 && <p>Cada factura gana un solo premio, así que {resultado.restantes === 1 ? 'tu giro restante no dará' : `tus ${resultado.restantes} giros restantes no darán`} otro premio.</p>}
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

function Ranking({ ranking }) {
  return (
    <>
      <div className="barra"><h1>RANKING</h1></div>
      <div className="cuerpo">
        {ranking.length === 0 && <p className="nota">Aún no hay participantes.</p>}
        <div>
          {ranking.map((p, i) => (
            <div className="fila" key={`${p.nombre}-${i}`}>
              <b>{i + 1}</b>
              <div>{p.nombre}<small>{p.facturas} {p.facturas === 1 ? 'factura' : 'facturas'}</small></div>
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

function Premios({ premios }) {
  return (
    <>
      <div className="barra"><h1>PREMIOS</h1></div>
      <div className="cuerpo">
        {premios.length === 0 && <p className="nota">Muy pronto publicaremos los premios.</p>}
        <div>
          {premios.map((p) => (
            <div className="fila" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }} key={p.id}>
              <div>{p.nombre}<small>{p.categoria}</small></div>
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
          <li>El ranking suma tus compras registradas: {puntos(config.puntosPorOportunidad)} puntos por cada {money(config.valorPorOportunidad)} acumulado, sin tope.</li>
          <li>Prefijos de factura: {sedes.map((s) => s.prefijo).join(', ')}, sin guion.</li>
          <li>Cada factura se registra una sola vez y gira de inmediato.</li>
          <li>Para reclamar un premio debes presentar la factura original y tu documento; sus datos deben coincidir con lo registrado.</li>
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
