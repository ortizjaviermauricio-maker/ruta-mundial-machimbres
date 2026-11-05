import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import './styles.css';
import { supabase } from './supabase';
import { CAMPANA, SEDES_RESPALDO, money } from './campana';

const Admin = lazy(() => import('./Admin.jsx'));

const CLAVE_TOKEN = 'campana_factura_token';
const VISTAS = ['Inicio', 'Participa', 'Ruleta', 'Ranking', 'Premios', 'Metodología', 'Reglamento', 'Sucursales', 'Personal'];
const FORM_VACIO = { nombre: '', apellido: '', celular: '', correo: '', sede: '', factura: '', valorCompra: '', vendedor: '', autorizacion: false, patrocinadorIds: [] };
const CONFIG_VACIA = { activa: false, compraMinima: 0, valorPorOportunidad: 1, puntosPorOportunidad: 0, maxOportunidades: 0, sedes: SEDES_RESPALDO };

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
  const [form, setForm] = useState(FORM_VACIO);
  const [recuperacion, setRecuperacion] = useState({ factura: '', celular: '' });
  const [enviando, setEnviando] = useState(false);
  const [girando, setGirando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const contenidoRef = useRef(null);

  const { config, premios, patrocinadores, ranking } = publico;
  const sedes = config.sedes?.length ? config.sedes : SEDES_RESPALDO;
  const sedeActual = form.sede || sedes[0].nombre;
  const prefijos = sedes.map((s) => s.prefijo).join(', ');
  const oportunidades = Math.min(
    Math.floor(Number(form.valorCompra || 0) / Math.max(Number(config.valorPorOportunidad || 1), 1)),
    Number(config.maxOportunidades || 0),
  );

  const cargarPublico = useCallback(async () => {
    const { data, error } = await supabase.rpc('campana_publica');
    if (error) {
      setErrorCarga('No pudimos cargar la campaña. Intente de nuevo en unos minutos.');
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
    window.setTimeout(() => contenidoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, [vista]);

  function alternarMarca(id) {
    setForm((prev) => ({
      ...prev,
      patrocinadorIds: prev.patrocinadorIds.includes(id)
        ? prev.patrocinadorIds.filter((x) => x !== id)
        : [...prev.patrocinadorIds, id],
    }));
  }

  async function registrar(e) {
    e.preventDefault();
    setEnviando(true);
    const { data, error } = await supabase.rpc('registrar_factura', {
      p_datos: {
        ...form,
        sede: sedeActual,
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
    guardarToken(data.token);
    setToken(data.token);
    setResultado(null);
    setForm(FORM_VACIO);
    setVista('Ruleta');
  }

  async function recuperar(e) {
    e.preventDefault();
    const { data, error } = await supabase.rpc('recuperar_factura', {
      p_factura: recuperacion.factura,
      p_celular: recuperacion.celular,
    });
    if (error) {
      alert(error.message);
      return;
    }
    guardarToken(data.token);
    setToken(data.token);
    setRecuperacion({ factura: '', celular: '' });
  }

  function cambiarFactura() {
    guardarToken('');
    setToken('');
    setFactura(null);
    setResultado(null);
    setVista('Participa');
  }

  async function girar() {
    setGirando(true);
    setResultado(null);
    const [{ data, error }] = await Promise.all([
      supabase.rpc('girar', { p_token: token }),
      new Promise((resolve) => { window.setTimeout(resolve, 1500); }),
    ]);
    setGirando(false);
    if (error) alert(error.message);
    else setResultado(data);
    await Promise.all([cargarFactura(), cargarPublico()]);
  }

  const reglamento = CAMPANA.reglamentoPdf
    ? <a href={CAMPANA.reglamentoPdf} target="_blank" rel="noopener noreferrer">Ver PDF</a>
    : <em>(reglamento en preparación)</em>;

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo-machimbres.png" alt="Machimbres y Maderas" />
          <h3>Machimbres y Maderas S.A.S.</h3>
          <small>Construimos tus ideas</small>
        </div>
        <nav>
          {VISTAS.map((item) => (
            <button key={item} className={vista === item ? 'active' : ''} onClick={() => setVista(item)}>{item}</button>
          ))}
        </nav>
        <div className="secureBox">
          <b>🛡️ Tu información está segura</b>
          <span>Ley 1581 de 2012</span>
        </div>
      </aside>

      <main className="content" ref={contenidoRef}>
        <section className="hero">
          <div className="heroText">
            <div className="heroLogos">
              <img src="/logo-machimbres.png" alt="Machimbres y Maderas" />
              <span>DEKO<br /><small>LÁMINAS</small></span>
              <span>DEKO<br /><small>DESIGN CENTER</small></span>
            </div>
            <div className="heroBall">39</div>
            <h1>{CAMPANA.tituloLinea1}<br />{CAMPANA.tituloLinea2} <em>{CAMPANA.tituloDestacado}</em></h1>
            <p>{CAMPANA.lema}</p>
          </div>
        </section>

        {errorCarga && <div className="avisoError">{errorCarga}</div>}
        {!errorCarga && !config.activa && <div className="avisoCampana">La campaña todavía no está abierta. Muy pronto podrás participar.</div>}

        {patrocinadores.length > 0 && (
          <section className="sponsorStrip">
            <div className="sponsorStripTitle">
              <span>Aliados estratégicos de la campaña</span>
              <small>Marcas patrocinadoras y beneficios especiales</small>
            </div>
            <div className="sponsorLogos">
              {patrocinadores.map((p) => {
                const enlace = p.pagina_web || p.instagram || (p.whatsapp ? `https://wa.me/${String(p.whatsapp).replace(/\D/g, '')}` : '');
                const contenido = p.logo_url ? <img src={p.logo_url} alt={p.nombre} /> : <strong>{p.nombre}</strong>;
                return enlace
                  ? <a key={p.id} className="sponsorLogo" href={enlace} target="_blank" rel="noopener noreferrer" title={p.nombre}>{contenido}</a>
                  : <span key={p.id} className="sponsorLogo" title={p.nombre}>{contenido}</span>;
              })}
            </div>
          </section>
        )}

        {vista === 'Inicio' && (
          <section className="dashboard">
            <div className="card">
              <h2>¿Cómo participar?</h2>
              <Step n="1" text="Compra en cualquiera de nuestras sucursales." />
              <Step n="2" text={`Registra tu factura ${prefijos}, sin guion.`} />
              <Step n="3" text="Acepta el tratamiento de datos y el reglamento." />
              <Step n="4" text="Muestra tu factura en caja para validarla." />
              <Step n="5" text="Gira la ruleta y acumula puntos." />
            </div>
            <div className="card wheelPanel">
              <h2>Gira la ruleta y gana</h2>
              <div className="wheel"><div>GIRAR</div></div>
              <button className="primary" onClick={() => setVista('Participa')}>Participar ahora</button>
            </div>
            <div className="card">
              <h2>Top ranking</h2>
              {ranking.length === 0 && <p>Aún no hay participantes.</p>}
              {ranking.slice(0, 5).map((p, i) => (
                <div className="miniRow" key={`${p.nombre}-${i}`}>
                  <b>#{i + 1}</b><span>{p.nombre}</span><strong>{p.puntos} pts</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {vista === 'Participa' && (
          <section className="card readable">
            <h2>Registro de participante</h2>
            <form className="form" onSubmit={registrar}>
              <div className="grid">
                <label>Nombre*<input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></label>
                <label>Apellido<input value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} /></label>
                <label>Celular*<input required inputMode="tel" value={form.celular} onChange={(e) => setForm({ ...form, celular: e.target.value })} /></label>
                <label>Correo<input type="email" value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} /></label>
                <label>Sede*
                  <select value={sedeActual} onChange={(e) => setForm({ ...form, sede: e.target.value })}>
                    {sedes.map((s) => <option key={s.prefijo} value={s.nombre}>{s.nombre} ({s.prefijo})</option>)}
                  </select>
                </label>
                <label>Factura*<input required value={form.factura} onChange={(e) => setForm({ ...form, factura: e.target.value.toUpperCase() })} placeholder={`${sedes.find((s) => s.nombre === sedeActual)?.prefijo || 'FE'}28501`} /></label>
                <label>Valor compra*<input required type="number" min="0" value={form.valorCompra} onChange={(e) => setForm({ ...form, valorCompra: e.target.value })} /></label>
                <label>Vendedor<input value={form.vendedor} onChange={(e) => setForm({ ...form, vendedor: e.target.value })} /></label>
                {patrocinadores.length > 0 && (
                  <div className="brandPicker">
                    <strong>Marcas patrocinadoras compradas</strong>
                    <small>Seleccione las que aparezcan en su factura. Se verificarán en caja.</small>
                    <div className="sponsorChecks">
                      {patrocinadores.map((p) => {
                        const marcada = form.patrocinadorIds.includes(p.id);
                        return (
                          <label key={p.id} className={`sponsorCheck ${marcada ? 'selected' : ''}`}>
                            <input type="checkbox" checked={marcada} onChange={() => alternarMarca(p.id)} />
                            {p.logo_url && <img src={p.logo_url} alt="" />}
                            <span>{p.nombre}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="calc">
                <div><b>{money(form.valorCompra)}</b><span>Compra</span></div>
                <div><b>{oportunidades}</b><span>Oportunidades</span></div>
                <div><b>{oportunidades * Number(config.puntosPorOportunidad || 0)}</b><span>Puntos</span></div>
              </div>
              <div className="methodBox">Cada {money(config.valorPorOportunidad)} suma {config.puntosPorOportunidad} puntos y 1 oportunidad. Máximo {config.maxOportunidades} oportunidades por factura. El valor se confirma en caja.</div>
              <label className="privacy">
                <input type="checkbox" required checked={form.autorizacion} onChange={(e) => setForm({ ...form, autorizacion: e.target.checked })} />
                <span>Autorizo el tratamiento de mis datos personales y acepto el reglamento oficial de la campaña. {reglamento}</span>
              </label>
              <button className="primary big" type="submit" disabled={enviando || !config.activa}>{enviando ? 'Registrando…' : 'Registrar factura'}</button>
            </form>
          </section>
        )}

        {vista === 'Ruleta' && (
          <section className="card center">
            <h2>{CAMPANA.ruleta}</h2>
            {factura ? (
              <div className="factura-activa">
                <strong>Factura {factura.factura}</strong>
                {factura.estado === 'pendiente' && <span>Muestra tu factura en caja para validarla. Esta pantalla se actualizará sola.</span>}
                {factura.estado === 'rechazada' && <span>Esta factura no fue aprobada.{factura.nota ? ` ${factura.nota}` : ''}</span>}
                {factura.estado === 'aprobada' && <span>{factura.restantes} giro(s) disponible(s)</span>}
                {factura.marcas && <small className="sponsorPlayNotice">Participa también por beneficios de {factura.marcas}</small>}
              </div>
            ) : (
              <p className="muted">No hay una factura registrada en este dispositivo.</p>
            )}
            <div className={`wheel smallWheel ${girando ? 'spin' : ''}`}><div>GIRAR</div></div>
            {factura?.estado === 'aprobada' && (
              <button className="primary big" disabled={girando || factura.restantes <= 0} onClick={girar}>{girando ? 'Girando…' : 'Girar ruleta'}</button>
            )}
            {resultado && (
              <div className={resultado.es_premio ? 'winner prizeWin' : 'winner noPrize'}>
                <h3>{resultado.es_premio ? '¡Felicitaciones!' : 'Sigue intentando'}</h3>
                <p>Resultado: <strong>{resultado.premio}</strong></p>
                <small>{resultado.es_premio ? 'Reclama tu premio en caja con tu factura y documento.' : 'Esta vez no obtuviste premio. Puedes seguir participando con tus próximas compras.'}</small>
              </div>
            )}
            {factura && factura.restantes <= 0 && factura.estado !== 'pendiente' && (
              <button className="linkButton" onClick={cambiarFactura}>Registrar otra factura</button>
            )}
            {!factura && (
              <form className="recuperar" onSubmit={recuperar}>
                <h3>¿Ya registraste tu factura?</h3>
                <input required placeholder="Factura" value={recuperacion.factura} onChange={(e) => setRecuperacion({ ...recuperacion, factura: e.target.value.toUpperCase() })} />
                <input required placeholder="Celular" inputMode="tel" value={recuperacion.celular} onChange={(e) => setRecuperacion({ ...recuperacion, celular: e.target.value })} />
                <button className="primary" type="submit">Retomar mis giros</button>
              </form>
            )}
          </section>
        )}

        {vista === 'Ranking' && (
          <section className="card readable">
            <h2>Ranking acumulado</h2>
            {ranking.length === 0 && <p>Aún no hay participantes.</p>}
            {ranking.map((p, i) => (
              <div className="rankRow" key={`${p.nombre}-${i}`}>
                <b>#{i + 1}</b>
                <div><strong>{p.nombre}</strong><small>{p.facturas} factura(s)</small></div>
                <strong>{p.puntos} pts</strong>
              </div>
            ))}
          </section>
        )}

        {vista === 'Premios' && (
          <section className="card readable">
            <h2>Premios disponibles</h2>
            {premios.length === 0 && <p>Muy pronto publicaremos los premios.</p>}
            <div className="prizeGrid">
              {premios.map((p) => (
                <div className="prize" key={p.id}>
                  <span className="giftIcon">🎁</span>
                  <h3>{p.nombre}</h3>
                  <p>{p.categoria}</p>
                  <strong>{p.ilimitado ? 'Disponible durante la campaña' : `Disponibles: ${p.stock}`}</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {vista === 'Metodología' && (
          <section className="card readable legal">
            <h2>Metodología</h2>
            <ul>
              <li>Compra mínima para participar: {money(config.compraMinima)}.</li>
              <li>Por cada {money(config.valorPorOportunidad)} recibes 1 oportunidad, hasta {config.maxOportunidades} por factura.</li>
              <li>Cada oportunidad suma {config.puntosPorOportunidad} puntos para el ranking acumulado.</li>
              <li>Prefijos válidos: {prefijos}. Digita la factura sin guion.</li>
              <li>La caja valida la factura y su valor antes de habilitar los giros.</li>
              <li>Si la factura incluye marcas aliadas, selecciónalas para participar también por sus premios.</li>
            </ul>
          </section>
        )}

        {vista === 'Reglamento' && (
          <section className="card readable legal reglamentoBox">
            <h2>Reglamento oficial de la campaña</h2>
            {CAMPANA.reglamentoPdf ? (
              <div className="regActions">
                <a className="docButton" href={CAMPANA.reglamentoPdf} target="_blank" rel="noopener noreferrer">📄 Ver reglamento oficial</a>
                <a className="docButton secondary" href={CAMPANA.reglamentoPdf} download>⬇ Descargar reglamento</a>
              </div>
            ) : <p>El reglamento de la campaña se publicará antes de su apertura.</p>}
          </section>
        )}

        {vista === 'Sucursales' && (
          <section className="card readable">
            <h2>Sucursales</h2>
            {sedes.map((s) => (
              <div className="branch" key={s.prefijo}><span>📍</span><div><strong>{s.nombre}</strong><p>Prefijo válido: {s.prefijo}</p></div></div>
            ))}
          </section>
        )}

        {vista === 'Personal' && (
          <section className="card readable">
            <Suspense fallback={<p>Cargando…</p>}><Admin /></Suspense>
          </section>
        )}

        <footer>
          <span>🔒 Datos protegidos · Ley 1581 de 2012</span>
          {CAMPANA.reglamentoPdf && <a href={CAMPANA.reglamentoPdf} target="_blank" rel="noopener noreferrer">📄 Reglamento oficial</a>}
        </footer>
      </main>
    </div>
  );
}

function Step({ n, text }) {
  return <div className="step"><b>{n}</b><span>{text}</span></div>;
}
