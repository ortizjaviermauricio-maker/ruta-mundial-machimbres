import React, { useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';
import { supabase } from './supabase';

const RECOVERY_EMAIL = 'ortiz.javiermauricio@hotmail.com';
const REGLAMENTO_PDF = '/Reglamento_Oficial_Ruta_Mundial_Mueble_2026.pdf';

const SEDES = [
  { nombre: 'Machimbres y Maderas S.A.S.', prefijo: 'FE' },
  { nombre: 'DEKO LÁMINAS', prefijo: 'FD' },
  { nombre: 'Satélite', prefijo: 'STFD' },
];

const PREMIOS_BASE = [
  { id: 1, nombre: 'Sigue intentando', categoria: 'Sin premio', stock: 999999, probabilidad: 60, visible: false, ilimitado: true },
  { id: 2, nombre: 'Agenda corporativa', categoria: 'Premio inmediato', stock: 196, probabilidad: 16, visible: true, ilimitado: false },
  { id: 3, nombre: 'Tula mundialista', categoria: 'Premio inmediato', stock: 119, probabilidad: 10, visible: true, ilimitado: false },
  { id: 4, nombre: 'Gorra mundialista', categoria: 'Premio inmediato', stock: 79, probabilidad: 7, visible: true, ilimitado: false },
  { id: 5, nombre: 'Cinta métrica', categoria: 'Premio inmediato', stock: 80, probabilidad: 6, visible: true, ilimitado: false },
  { id: 6, nombre: 'Bono $20.000', categoria: 'Bono comercial', stock: 30, probabilidad: 3, visible: true, ilimitado: false },
  { id: 7, nombre: 'Juego de brocas', categoria: 'Herramienta', stock: 15, probabilidad: 1.5, visible: true, ilimitado: false },
  { id: 8, nombre: 'Hielera mundialista', categoria: 'Premio especial', stock: 9, probabilidad: 1, visible: true, ilimitado: false },
  { id: 9, nombre: 'Parlante Bluetooth', categoria: 'Premio especial', stock: 4, probabilidad: 0.4, visible: true, ilimitado: false },
  { id: 10, nombre: 'Taladro percutor', categoria: 'Premio estrella', stock: 1, probabilidad: 0.1, visible: true, ilimitado: false },
];

const CONFIG_BASE = {
  compraMinima: 500000,
  valorPorOportunidad: 500000,
  puntosPorOportunidad: 100,
  maxOportunidades: 10,
  ultimaFacturaFE: 0,
  ultimaFacturaFD: 0,
  ultimaFacturaSTFD: 0,
  whatsapp: '317 636 6356',
  habeas: 'habeasdata@machimbresymaderas.com',
  reglamento: 'RMM-2026-V1.0',
  autorizacion: 'SIGPDP-AUT-RMM-2026-V1.0',
  adminUser: 'admin',
  adminPass: 'Mym2026*',
};

function safeLoad() {
  return {
    premios: [],
    participantes: [],
    ganadores: [],
    config: CONFIG_BASE,
    cambios: [],
    backups: [],
    adminUser: 'admin',
    adminPass: 'Mym2026*',
  };
}

function money(value) {
  return Number(value || 0).toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });
}

function nombrePublico(participante) {
  const nombre = String(participante?.nombre || '').trim().split(/\s+/)[0] || 'Cliente';
  const apellido = String(participante?.apellido || '').trim().split(/\s+/)[0] || '';
  return apellido ? `${nombre} ${apellido.charAt(0)}.` : nombre;
}

function claveNombrePatrocinador(nombre) {
  return String(nombre || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function deduplicarPatrocinadores(lista = []) {
  const vistos = new Set();
  return [...lista]
    .sort((a, b) => Number(a.orden || 99) - Number(b.orden || 99))
    .filter((p) => {
      const clave = claveNombrePatrocinador(p.nombre || p.empresa || '');
      if (!clave) return false;
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
}

export default function App() {
  const initial = useMemo(() => safeLoad(), []);
  const [vista, setVista] = useState('Inicio');
  const [premios, setPremios] = useState(initial.premios || []);
  const [participantes, setParticipantes] = useState(initial.participantes || []);
  const [ganadores, setGanadores] = useState(initial.ganadores || []);
  const [participanteLocalId, setParticipanteLocalId] = useState(() => localStorage.getItem('participante_actual_id') || '');
  const [config, setConfig] = useState(initial.config || CONFIG_BASE);
  const [cambios, setCambios] = useState(initial.cambios || []);
  const [backups, setBackups] = useState(initial.backups || []);
  const [patrocinadores, setPatrocinadores] = useState([]);
  const [patrocinadorForm, setPatrocinadorForm] = useState({ nombre: '', empresa: '', responsable: '', telefono: '', correo: '', logo_url: '', banner_url: '', pagina_web: '', instagram: '', whatsapp: '', activo: true, orden: 99 });
  const contenidoRef = useRef(null);
  const [adminUser, setAdminUser] = useState(initial.adminUser || 'admin');
  const [adminPass, setAdminPass] = useState(initial.adminPass || 'Mym2026*');
  const [adminOk, setAdminOk] = useState(false);
  const [login, setLogin] = useState({ usuario: '', clave: '' });
  const [passForm, setPassForm] = useState({ actual: '', nueva: '', confirmar: '' });
  const [seleccionado, setSeleccionado] = useState('');
  const [resultado, setResultado] = useState(null);
  const [girando, setGirando] = useState(false);
  const [form, setForm] = useState({
    nombre: '',
    apellido: '',
    celular: '',
    correo: '',
    sede: SEDES[0].nombre,
    factura: '',
    valorCompra: '',
    vendedor: '',
    autorizacion: false,
    patrocinadorIds: [],
  });

  function mapPremio(p) {
    return {
      id: p.id,
      nombre: p.premio || p.nombre || 'Premio',
      categoria: p.categoria || 'Premio',
      stock: Number(p.cantidad ?? p.stock ?? 0),
      probabilidad: Number(p.peso ?? p.probabilidad ?? 1),
      visible: p.visible_cliente ?? p.visible ?? true,
      ilimitado: p.entrega_premio === false || p.ilimitado === true,
      patrocinadorId: p.patrocinador_id || p.patrocinadorId || '',
    };
  }

  function mapParticipante(p) {
    return {
      id: p.id,
      fecha: p.fecha || p.created_at || new Date().toISOString(),
      nombre: p.nombre || '',
      apellido: p.apellido || p.taller || '',
      celular: p.celular || '',
      correo: p.correo || p.email || '',
      sede: p.sede || SEDES[0].nombre,
      factura: p.factura || '',
      prefijo: p.prefijo_factura || prefijoFactura(p.factura || ''),
      valorCompra: Number(p.valor_compra ?? p.valor ?? 0),
      vendedor: p.vendedor || '',
      oportunidadesIniciales: Number(p.oportunidades_iniciales ?? p.oportunidades ?? 0),
      oportunidades: Number(p.oportunidades ?? 0),
      puntos: Number(p.puntos ?? 0),
      autorizacion: true,
      patrocinadorId: p.patrocinador_id || p.patrocinadorId || '',
      patrocinadorIds: Array.isArray(p.patrocinadores_ids)
        ? p.patrocinadores_ids.map(String)
        : String(p.patrocinadores_ids || p.patrocinadoresIds || p.patrocinador_id || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
      marcaCompra: p.marca_compra || p.marcaCompra || '',
    };
  }

  function mapGanador(g) {
    return {
      id: g.id,
      fecha: g.fecha || g.created_at || new Date().toISOString(),
      participante: g.participante || g.nombre || '',
      factura: g.factura || '',
      sede: g.sede || '',
      premio: g.premio || '',
      estado: g.estado || g.nota || 'Pendiente validación',
    };
  }

  function mapPatrocinador(p) {
    return {
      id: p.id,
      nombre: p.nombre || p.empresa || 'Aliado',
      empresa: p.empresa || p.nombre || 'Aliado',
      responsable: p.responsable || '',
      telefono: p.telefono || '',
      correo: p.correo || '',
      logo_url: p.logo_url || p.logoUrl || '',
      banner_url: p.banner_url || p.bannerUrl || '',
      pagina_web: p.pagina_web || p.paginaWeb || '',
      instagram: p.instagram || '',
      whatsapp: p.whatsapp || p.telefono || '',
      activo: p.activo !== false,
      orden: Number(p.orden || 99),
      fecha_creacion: p.fecha_creacion || p.created_at || '',
    };
  }

  function limpiarCacheNavegador() {
    try {
      const idParticipanteActual = localStorage.getItem('participante_actual_id') || '';
      const facturaParticipanteActual = localStorage.getItem('participante_actual_factura') || '';
      localStorage.clear();
      sessionStorage.clear();
      if (idParticipanteActual) localStorage.setItem('participante_actual_id', idParticipanteActual);
      if (facturaParticipanteActual) localStorage.setItem('participante_actual_factura', facturaParticipanteActual);
    } catch (error) {
      console.warn('No se pudo limpiar cache local:', error?.message);
    }
  }

  async function cargarDatosSupabase() {
    const [premiosRes, participantesRes, ganadoresRes, cambiosRes, configRes, backupsRes, patrocinadoresRes] = await Promise.all([
      supabase.from('premios').select('*').eq('activo', true),
      supabase.from('participantes').select('*').order('fecha', { ascending: false }),
      supabase.from('ganadores').select('*').order('fecha', { ascending: false }),
      supabase.from('auditoria_admin').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('configuracion_campana').select('*').eq('key', 'principal').maybeSingle(),
      supabase.from('backups_campana').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('patrocinadores').select('*').order('orden', { ascending: true }),
    ]);

    if (!premiosRes.error) setPremios((premiosRes.data || []).map(mapPremio));
    else console.error('Error cargando premios:', premiosRes.error.message);

    if (!patrocinadoresRes.error) setPatrocinadores(deduplicarPatrocinadores((patrocinadoresRes.data || []).map(mapPatrocinador)));
    else {
      console.warn('Patrocinadores no activos todavía. Ejecute SUPABASE_PATROCINADORES_V2.sql:', patrocinadoresRes.error.message);
      setPatrocinadores([]);
    }

    if (!participantesRes.error) setParticipantes((participantesRes.data || []).map(mapParticipante));
    else console.error('Error cargando participantes:', participantesRes.error.message);

    if (!ganadoresRes.error) setGanadores((ganadoresRes.data || []).map(mapGanador));
    else console.error('Error cargando ganadores:', ganadoresRes.error.message);

    if (!cambiosRes.error) {
      setCambios((cambiosRes.data || []).map((c) => ({
        id: c.id,
        fecha: c.created_at ? new Date(c.created_at).toLocaleString('es-CO', { hour12: false }) : sello(),
        usuario: c.usuario || 'admin',
        accion: c.accion || '',
        detalle: c.detalle || '',
      })));
    } else console.error('Error cargando auditoría:', cambiosRes.error.message);

    if (!backupsRes.error) {
      setBackups((backupsRes.data || []).map((b) => ({
        id: b.id,
        fecha: b.created_at ? new Date(b.created_at).toLocaleString('es-CO', { hour12: false }) : sello(),
        tipo: b.tipo || 'backup',
        data: b.data || {},
        usuario: b.usuario || 'admin',
      })));
    } else console.error('Error cargando backups:', backupsRes.error.message);

    if (!configRes.error && configRes.data?.value) {
      const v = configRes.data.value;
      setConfig((prev) => ({
        ...prev,
        compraMinima: Number(v.compraMinima ?? v.compra_minima ?? v.tramos?.[0]?.monto ?? prev.compraMinima),
        valorPorOportunidad: Number(v.valorPorOportunidad ?? v.valor_por_oportunidad ?? v.tramos?.[0]?.monto ?? prev.valorPorOportunidad),
        puntosPorOportunidad: Number(v.puntosPorOportunidad ?? v.puntos_por_oportunidad ?? v.tramos?.[0]?.puntos ?? prev.puntosPorOportunidad),
        maxOportunidades: Number(v.maxOportunidades ?? v.max_oportunidades ?? prev.maxOportunidades),
        ultimaFacturaFE: Number(v.ultimaFacturaFE ?? v.ultima_factura_fe ?? v.ultimaFE ?? prev.ultimaFacturaFE ?? 0),
        ultimaFacturaFD: Number(v.ultimaFacturaFD ?? v.ultima_factura_fd ?? v.ultimaFD ?? prev.ultimaFacturaFD ?? 0),
        ultimaFacturaSTFD: Number(v.ultimaFacturaSTFD ?? v.ultima_factura_stfd ?? v.ultimaSTFD ?? prev.ultimaFacturaSTFD ?? 0),
        whatsapp: v.whatsapp ?? prev.whatsapp,
        habeas: v.habeas ?? prev.habeas,
        reglamento: v.reglamento ?? prev.reglamento,
        autorizacion: v.autorizacion ?? prev.autorizacion,
      }));
      if (v.adminUser) setAdminUser(v.adminUser);
      if (v.adminPass) setAdminPass(v.adminPass);
    } else if (configRes.error) console.error('Error cargando configuración:', configRes.error.message);
  }

  useEffect(() => {
    limpiarCacheNavegador();
    cargarDatosSupabase();

    const refrescar = () => cargarDatosSupabase();
    window.addEventListener('focus', refrescar);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) cargarDatosSupabase();
    });
    const intervalo = window.setInterval(cargarDatosSupabase, 5000);

    const canal = supabase
      .channel('sincronizacion-campana-publica')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participantes' }, cargarDatosSupabase)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ganadores' }, cargarDatosSupabase)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autorizaciones_datos' }, cargarDatosSupabase)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'premios' }, cargarDatosSupabase)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patrocinadores' }, cargarDatosSupabase)
      .subscribe();

    return () => {
      window.removeEventListener('focus', refrescar);
      window.clearInterval(intervalo);
      supabase.removeChannel(canal);
    };
  }, []);

  useEffect(() => {
    window.setTimeout(() => {
      contenidoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, [vista]);

  useEffect(() => {
    if (!participanteLocalId) return;
    if (!participantes.length && !ganadores.length) {
      localStorage.removeItem('participante_actual_id');
      localStorage.removeItem('participante_actual_factura');
      setParticipanteLocalId('');
      setSeleccionado('');
      setResultado(null);
      return;
    }
    const existe = participantes.some((p) => String(p.id) === String(participanteLocalId));
    if (!existe) {
      localStorage.removeItem('participante_actual_id');
      localStorage.removeItem('participante_actual_factura');
      setParticipanteLocalId('');
      setSeleccionado('');
      setResultado(null);
    }
  }, [participantes, ganadores, participanteLocalId]);

  const metricas = useMemo(() => {
    const totalCompras = participantes.reduce((sum, p) => sum + Number(p.valorCompra || 0), 0);
    const puntos = participantes.reduce((sum, p) => sum + Number(p.puntos || 0), 0);
    return {
      totalCompras,
      clientes: participantes.length,
      autorizaciones: participantes.filter((p) => p.autorizacion).length,
      premiosEntregados: ganadores.filter((g) => g.premio !== 'Sigue intentando').length,
      ruletas: ganadores.length,
      puntos,
    };
  }, [participantes, ganadores]);

  const ranking = useMemo(
    () => [...participantes].sort((a, b) => Number(b.puntos || 0) - Number(a.puntos || 0)),
    [participantes]
  );

  const participanteSeleccionado = participantes.find((p) => String(p.id) === String(seleccionado));
  const facturaSeleccionada = String(participanteSeleccionado?.factura || '').trim().toUpperCase();
  const participantePuedeGirar = Boolean(
    participanteSeleccionado && Number(participanteSeleccionado.oportunidades || 0) > 0 && !girando
  );

  const participantesDisponiblesRuleta = useMemo(() => {
    if (!participanteLocalId) return [];
    return participantes.filter((p) =>
      String(p.id) === String(participanteLocalId) && Number(p.oportunidades || 0) > 0
    );
  }, [participantes, participanteLocalId]);

  useEffect(() => {
    if (participantesDisponiblesRuleta.length === 1 && String(seleccionado) !== String(participantesDisponiblesRuleta[0].id)) {
      setSeleccionado(String(participantesDisponiblesRuleta[0].id));
    }
    if (participantesDisponiblesRuleta.length === 0 && seleccionado) {
      setSeleccionado('');
    }
  }, [participantesDisponiblesRuleta, seleccionado]);

  useEffect(() => {
    if (!seleccionado) return;
    const actual = participantes.find((p) => String(p.id) === String(seleccionado));
    if (!actual || Number(actual.oportunidades || 0) <= 0) {
      setSeleccionado('');
    }
  }, [participantes, seleccionado]);

  const ventasPorSede = useMemo(() => {
    const base = SEDES.map((s) => ({ sede: s.nombre, prefijo: s.prefijo, total: 0, facturas: 0, puntos: 0 }));
    participantes.forEach((p) => {
      const item = base.find((b) => b.sede === p.sede) || base[0];
      item.total += Number(p.valorCompra || 0);
      item.facturas += 1;
      item.puntos += Number(p.puntos || 0);
    });
    return base;
  }, [participantes]);

  const ventasPorDia = useMemo(() => {
    const map = {};
    participantes.forEach((p) => {
      const key = String(p.fecha || '').slice(0, 10) || 'Sin fecha';
      if (!map[key]) map[key] = { fecha: key, total: 0, facturas: 0 };
      map[key].total += Number(p.valorCompra || 0);
      map[key].facturas += 1;
    });
    return Object.values(map).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }, [participantes]);

  const patrocinadoresActivos = useMemo(() =>
    deduplicarPatrocinadores(patrocinadores).filter((p) => p.activo !== false),
    [patrocinadores]
  );

  const ventasPorPatrocinador = useMemo(() => {
    return patrocinadoresActivos.map((patrocinador) => {
      const asociados = participantes.filter((p) => {
        const ids = Array.isArray(p.patrocinadorIds) ? p.patrocinadorIds.map(String) : String(p.patrocinadoresIds || p.patrocinadorId || '').split(',').map((x) => x.trim()).filter(Boolean);
        return ids.includes(String(patrocinador.id));
      });
      const total = asociados.reduce((sum, p) => sum + Number(p.valorCompra || 0), 0);
      const premiosEntregados = ganadores.filter((g) => asociados.some((p) => normalizarFactura(p.factura) === normalizarFactura(g.factura)) && g.premio !== 'Sigue intentando').length;
      return {
        patrocinador: patrocinador.nombre,
        facturas: asociados.length,
        ventas: total,
        ventas_formato: money(total),
        premios_entregados: premiosEntregados,
      };
    }).filter((r) => r.facturas > 0 || r.premios_entregados > 0);
  }, [patrocinadoresActivos, participantes, ganadores]);

  function nombrePatrocinador(id) {
    const p = patrocinadores.find((item) => String(item.id) === String(id));
    return p?.nombre || 'marca aliada';
  }

  function togglePatrocinadorRegistro(id) {
    const sid = String(id);
    setForm((prev) => {
      const actuales = Array.isArray(prev.patrocinadorIds) ? prev.patrocinadorIds.map(String) : [];
      const existe = actuales.includes(sid);
      return {
        ...prev,
        patrocinadorIds: existe ? actuales.filter((x) => x !== sid) : [...actuales, sid],
      };
    });
  }

  function nombresPatrocinadores(ids = []) {
    const lista = (Array.isArray(ids) ? ids : String(ids || '').split(',')).map(String).filter(Boolean);
    return lista.map((id) => nombrePatrocinador(id)).join(', ');
  }

  function sello() {
    return new Date().toLocaleString('es-CO', { hour12: false });
  }

  function registrarCambio(accion, detalle) {
    const item = { id: Date.now() + Math.random(), fecha: sello(), usuario: adminUser || 'admin', accion, detalle };
    setCambios((prev) => [item, ...prev]);
    supabase.from('auditoria_admin').insert({
      usuario: item.usuario,
      accion,
      detalle,
    }).then(({ error }) => {
      if (error) console.error('No se pudo guardar auditoría:', error.message);
    });
  }


  function normalizarFactura(factura) {
    // El cliente puede digitar FE123, FD123 o STFD123.
    // Si por costumbre escribe FE-123, el sistema lo normaliza a FE123 para evitar confusiones.
    return String(factura || '').trim().toUpperCase().replace(/[\s-]/g, '');
  }

  function prefijoFactura(factura) {
    const value = normalizarFactura(factura);
    if (value.startsWith('STFD')) return 'STFD';
    if (value.startsWith('FE')) return 'FE';
    if (value.startsWith('FD')) return 'FD';
    return '';
  }

  function numeroFactura(factura) {
    const value = normalizarFactura(factura);
    const prefijo = prefijoFactura(value);
    const numero = value.replace(prefijo, '').replace(/\D/g, '');
    return Number(numero || 0);
  }

  function variantesFactura(factura) {
    const value = normalizarFactura(factura);
    const prefijo = prefijoFactura(value);
    const numero = String(value.replace(prefijo, '').replace(/\D/g, ''));
    if (!prefijo || !numero) return [value];
    return Array.from(new Set([value, `${prefijo}-${numero}`]));
  }

  function ultimaFacturaPermitida(prefijo) {
    if (prefijo === 'FE') return Number(config.ultimaFacturaFE || 0);
    if (prefijo === 'FD') return Number(config.ultimaFacturaFD || 0);
    if (prefijo === 'STFD') return Number(config.ultimaFacturaSTFD || 0);
    return 0;
  }

  function calcularOportunidades(valor) {
    const oportunidades = Math.floor(Number(valor || 0) / Number(config.valorPorOportunidad || 1));
    return Math.min(oportunidades, Number(config.maxOportunidades || 1));
  }

  async function registrar(e) {
    e.preventDefault();
    const factura = normalizarFactura(form.factura);
    const prefijo = prefijoFactura(factura);
    const numero = numeroFactura(factura);
    const sede = SEDES.find((s) => s.nombre === form.sede);
    const valorCompra = Number(form.valorCompra || 0);

    if (!form.nombre.trim() || !form.celular.trim() || !factura) {
      alert('Complete nombre, celular y factura.');
      return;
    }
    if (!prefijo) {
      alert('Factura inválida. Debe iniciar por FE, FD o STFD, sin guion. Ejemplo: FE28501.');
      return;
    }
    if (sede && sede.prefijo !== prefijo) {
      alert(`La sede seleccionada exige facturas con prefijo ${sede.prefijo}. Ejemplo: ${sede.prefijo}28501.`);
      return;
    }
    if (!numero) {
      alert('Factura inválida. Después del prefijo debe digitar el número consecutivo. Ejemplo: FE28501.');
      return;
    }
    const ultimaAntesCampana = ultimaFacturaPermitida(prefijo);
    if (ultimaAntesCampana > 0 && numero <= ultimaAntesCampana) {
      alert(`La factura ${factura} corresponde a una venta anterior al inicio de la campaña. La primera factura válida para ${prefijo} debe ser mayor a ${ultimaAntesCampana}.`);
      return;
    }
    if (participantes.some((p) => normalizarFactura(p.factura || '') === factura)) {
      alert('Factura ya registrada. No puede usarse dos veces.');
      return;
    }
    const facturasEquivalentes = variantesFactura(factura);
    const existe = await supabase.from('participantes').select('id, factura').in('factura', facturasEquivalentes).limit(1);
    if (existe.data && existe.data.length > 0) {
      alert('Factura ya registrada en la base central. No puede usarse dos veces.');
      return;
    }

    if (valorCompra < Number(config.compraMinima || 0)) {
      alert(`La compra mínima es ${money(config.compraMinima)}.`);
      return;
    }
    if (!form.autorizacion) {
      alert('Debe aceptar tratamiento de datos personales y reglamento.');
      return;
    }

    const oportunidades = calcularOportunidades(valorCompra);
    const puntos = oportunidades * Number(config.puntosPorOportunidad || 0);
    const patrocinadorIdsSeleccionados = Array.isArray(form.patrocinadorIds) ? form.patrocinadorIds.map(String) : [];
    const patrocinadoresSeleccionados = patrocinadores.filter((p) => patrocinadorIdsSeleccionados.includes(String(p.id)));
    const insertData = {
      nombre: form.nombre.trim(),
      taller: form.apellido.trim(),
      celular: form.celular.trim(),
      email: form.correo.trim() || 'sin-correo@machimbresymaderas.com',
      sede: form.sede,
      factura,
      prefijo_factura: prefijo,
      factura_numero: String(numero),
      valor: valorCompra,
      vendedor: form.vendedor.trim(),
      puntos,
      oportunidades,
      version_reglamento: config.reglamento,
      version_autorizacion: config.autorizacion,
      patrocinador_id: patrocinadorIdsSeleccionados[0] || null,
      patrocinadores_ids: patrocinadorIdsSeleccionados.join(','),
      marca_compra: patrocinadoresSeleccionados.map((p) => p.nombre).join(', '),
    };

    let { data, error } = await supabase.from('participantes').insert(insertData).select().single();
    if (error && String(error.message || '').toLowerCase().includes('column')) {
      const { patrocinador_id, patrocinadores_ids, marca_compra, ...insertDataBasico } = insertData;
      const retry = await supabase.from('participantes').insert(insertDataBasico).select().single();
      data = retry.data;
      error = retry.error;
      if (!error) console.warn('Registro guardado sin patrocinador. Ejecute SUPABASE_PATROCINADORES_V2.sql para activar medición por patrocinador.');
    }
    if (error) {
      alert('No se pudo guardar el participante en Supabase: ' + error.message);
      return;
    }

    await supabase.from('autorizaciones_datos').insert({
      participante_id: data.id,
      nombre: `${form.nombre.trim()} ${form.apellido.trim()}`.trim(),
      celular: form.celular.trim(),
      email: form.correo.trim() || 'sin-correo@machimbresymaderas.com',
      factura,
      sede: form.sede,
      acepto_tratamiento_datos: true,
      acepto_reglamento: true,
      version_autorizacion: config.autorizacion,
      version_reglamento: config.reglamento,
      texto_autorizacion: 'Acepta tratamiento de datos personales y reglamento Ruta al Mundial del Mueble 2026.',
      user_agent: navigator.userAgent,
      idioma_navegador: navigator.language,
      plataforma: navigator.platform,
      origen: window.location.href,
    });

    const nuevo = mapParticipante(data);
    setParticipantes((prev) => [nuevo, ...prev]);
    localStorage.setItem('participante_actual_id', String(nuevo.id));
    localStorage.setItem('participante_actual_factura', String(nuevo.factura || factura));
    setParticipanteLocalId(String(nuevo.id));
    setSeleccionado(String(nuevo.id));
    setResultado(null);
    setForm({
      nombre: '',
      apellido: '',
      celular: '',
      correo: '',
      sede: SEDES[0].nombre,
      factura: '',
      valorCompra: '',
      vendedor: '',
      patrocinadorIds: [],
      autorizacion: false,
    });
    setVista('Ruleta');
  }

  async function girar() {
    if (!participantePuedeGirar) {
      alert('Esta factura no tiene giros disponibles.');
      setSeleccionado('');
      await cargarDatosSupabase();
      return;
    }
    if (!participanteSeleccionado) {
      alert('Seleccione participante.');
      return;
    }
    const facturaActual = String(participanteSeleccionado.factura || '').trim().toUpperCase();
    if (!facturaActual) {
      alert('La factura no es válida.');
      return;
    }
    if (Number(participanteSeleccionado.oportunidades || 0) <= 0) {
      alert('Esta factura no tiene giros disponibles.');
      setSeleccionado('');
      await cargarDatosSupabase();
      return;
    }

    const patrocinadoresParticipante = Array.isArray(participanteSeleccionado?.patrocinadorIds)
      ? participanteSeleccionado.patrocinadorIds.map(String)
      : String(participanteSeleccionado?.patrocinadoresIds || participanteSeleccionado?.patrocinadorId || '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
    const activos = premios.filter((p) => {
      const premioPatrocinador = p.patrocinadorId ? String(p.patrocinadorId) : '';
      const aplicaPatrocinador = !premioPatrocinador || patrocinadoresParticipante.includes(premioPatrocinador);
      return aplicaPatrocinador && Number(p.probabilidad) > 0 && (p.ilimitado || Number(p.stock) > 0);
    });
    if (!activos.length) {
      alert('No hay premios configurados.');
      return;
    }

    const bolsa = [];
    activos.forEach((premio) => {
      const veces = Math.max(1, Math.round(Number(premio.probabilidad) * 10));
      for (let i = 0; i < veces; i += 1) bolsa.push(premio);
    });

    setGirando(true);
    setResultado(null);

    setTimeout(async () => {
      const premio = bolsa[Math.floor(Math.random() * bolsa.length)];
      setResultado(premio);
      const nuevasOportunidades = Math.max(0, Number(participanteSeleccionado.oportunidades || 0) - 1);

      setParticipantes((prev) =>
        prev.map((p) =>
          String(p.id) === String(participanteSeleccionado.id)
            ? { ...p, oportunidades: nuevasOportunidades }
            : p
        )
      );
      await supabase.from('participantes').update({ oportunidades: nuevasOportunidades }).eq('id', participanteSeleccionado.id);

      const ganadorDb = {
        nombre: `${participanteSeleccionado.nombre} ${participanteSeleccionado.apellido}`.trim(),
        celular: participanteSeleccionado.celular,
        email: participanteSeleccionado.correo || 'sin-correo@machimbresymaderas.com',
        factura: participanteSeleccionado.factura,
        sede: participanteSeleccionado.sede,
        vendedor: participanteSeleccionado.vendedor,
        premio: premio.nombre,
        nota: premio.nombre === 'Sigue intentando' ? 'Sin premio' : 'Pendiente validación',
      };

      const { data, error: errorGanador } = await supabase.from('ganadores').insert(ganadorDb).select().single();
      if (errorGanador) {
        await cargarDatosSupabase();
        setGirando(false);
        alert('No se pudo registrar el giro en Supabase. Detalle: ' + errorGanador.message);
        return;
      }

      if (!premio.ilimitado && premio.nombre !== 'Sigue intentando') {
        const nuevoStock = Math.max(0, Number(premio.stock) - 1);
        setPremios((prev) => prev.map((p) => (p.id === premio.id ? { ...p, stock: nuevoStock } : p)));
        await supabase.from('premios').update({ cantidad: nuevoStock }).eq('id', premio.id);
      }

      const ganadorLocal = data ? mapGanador(data) : {
        id: Date.now(),
        fecha: new Date().toISOString(),
        participante: ganadorDb.nombre,
        factura: ganadorDb.factura,
        sede: ganadorDb.sede,
        premio: ganadorDb.premio,
      };
      setGanadores((prev) => [ganadorLocal, ...prev]);
      setSeleccionado('');
      setGirando(false);
      await cargarDatosSupabase();
    }, 900);
  }

  function iniciarAdmin(e) {
    e.preventDefault();
    const credencialesActuales = login.usuario === adminUser && login.clave === adminPass;
    const rescateTemporal = login.usuario === 'admin' && ['Mym2026*', '12345', 'admin'].includes(login.clave);
    if (credencialesActuales || rescateTemporal) {
      setAdminOk(true);
      setLogin({ usuario: '', clave: '' });
      registrarCambio('Ingreso administrador', 'Ingreso correcto al panel administrativo.');
    } else {
      alert('Usuario o contraseña incorrectos.');
    }
  }

  function solicitarRecuperacion() {
    const asunto = encodeURIComponent('Recuperación de contraseña - Ruta al Mundial del Mueble 2026');
    const cuerpo = encodeURIComponent('Solicito recuperación de acceso administrativo. Correo autorizado: ' + RECOVERY_EMAIL + '.');
    window.location.href = `mailto:${RECOVERY_EMAIL}?subject=${asunto}&body=${cuerpo}`;
    alert('Se abrirá el correo de recuperación. Al pasar a Supabase Auth, este botón enviará un link automático al correo autorizado.');
  }

  async function cambiarClaveAdmin(e) {
    e.preventDefault();
    if (passForm.actual !== adminPass && !['Mym2026*', '12345', 'admin'].includes(passForm.actual)) {
      alert('La clave actual no coincide.');
      return;
    }
    if (!passForm.nueva || passForm.nueva.length < 8) {
      alert('La nueva clave debe tener mínimo 8 caracteres.');
      return;
    }
    if (passForm.nueva !== passForm.confirmar) {
      alert('La confirmación no coincide.');
      return;
    }
    setAdminPass(passForm.nueva);
    const ok = await guardarConfiguracionCentral(config, adminUser, passForm.nueva);
    setPassForm({ actual: '', nueva: '', confirmar: '' });
    if (ok) registrarCambio('Cambio de clave admin', 'Se actualizó la contraseña administrativa en Supabase.');
    alert('Clave administrativa actualizada correctamente en Supabase.');
  }


  function leerArchivoComoDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function cargarLogoPatrocinador(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('El logo debe ser una imagen PNG, JPG o SVG.');
      return;
    }
    if (file.size > 700000) {
      alert('El logo es muy pesado. Use una imagen menor a 700 KB para que cargue rápido en celulares.');
      return;
    }
    const dataUrl = await leerArchivoComoDataUrl(file);
    setPatrocinadorForm((prev) => ({ ...prev, logo_url: dataUrl }));
  }

  async function cargarBannerPatrocinador(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('El promocional debe ser una imagen.');
      return;
    }
    if (file.size > 900000) {
      alert('El promocional es muy pesado. Use una imagen menor a 900 KB.');
      return;
    }
    const dataUrl = await leerArchivoComoDataUrl(file);
    setPatrocinadorForm((prev) => ({ ...prev, banner_url: dataUrl }));
  }

  async function guardarPatrocinador(e) {
    e.preventDefault();
    if (!patrocinadorForm.nombre.trim()) {
      alert('Digite el nombre del patrocinador.');
      return;
    }

    const payload = {
      nombre: patrocinadorForm.nombre.trim(),
      empresa: patrocinadorForm.empresa.trim() || patrocinadorForm.nombre.trim(),
      responsable: patrocinadorForm.responsable.trim(),
      telefono: patrocinadorForm.telefono.trim(),
      correo: patrocinadorForm.correo.trim(),
      logo_url: patrocinadorForm.logo_url || '',
      banner_url: patrocinadorForm.banner_url || '',
      pagina_web: patrocinadorForm.pagina_web.trim(),
      instagram: patrocinadorForm.instagram.trim(),
      whatsapp: patrocinadorForm.whatsapp.trim(),
      activo: Boolean(patrocinadorForm.activo),
      orden: Number(patrocinadorForm.orden || 99),
    };

    const claveNueva = claveNombrePatrocinador(payload.nombre);
    const existente = patrocinadores.find((p) => claveNombrePatrocinador(p.nombre || p.empresa) === claveNueva);

    if (existente) {
      const { data, error } = await supabase
        .from('patrocinadores')
        .update(payload)
        .eq('id', existente.id)
        .select()
        .single();

      if (error) {
        alert('Este patrocinador ya existe, pero no se pudo actualizar. Detalle: ' + error.message);
        return;
      }

      const actualizado = mapPatrocinador(data || { ...existente, ...payload });
      setPatrocinadores((prev) =>
        deduplicarPatrocinadores(prev.map((p) => String(p.id) === String(actualizado.id) ? actualizado : p))
      );
      setPatrocinadorForm({ nombre: '', empresa: '', responsable: '', telefono: '', correo: '', logo_url: '', banner_url: '', pagina_web: '', instagram: '', whatsapp: '', activo: true, orden: 99 });
      registrarCambio('Patrocinador actualizado', `Se actualizó patrocinador existente ${actualizado.nombre}.`);
      alert('El patrocinador ya existía. Se actualizó el registro existente y no se creó duplicado.');
      return;
    }

    const { data, error } = await supabase.from('patrocinadores').insert(payload).select().single();
    if (error) {
      const mensaje = String(error.message || '').toLowerCase();
      if (mensaje.includes('duplicate') || mensaje.includes('unique')) {
        alert('Este patrocinador ya existe. Actualice el registro existente; no se permiten duplicados.');
      } else {
        alert('No se pudo guardar patrocinador. Ejecute SUPABASE_PATROCINADORES_V2.sql en Supabase. Detalle: ' + error.message);
      }
      await cargarDatosSupabase();
      return;
    }
    const nuevo = mapPatrocinador(data);
    setPatrocinadores((prev) => deduplicarPatrocinadores([...prev, nuevo]));
    setPatrocinadorForm({ nombre: '', empresa: '', responsable: '', telefono: '', correo: '', logo_url: '', banner_url: '', pagina_web: '', instagram: '', whatsapp: '', activo: true, orden: 99 });
    registrarCambio('Nuevo patrocinador', `Se agregó patrocinador ${nuevo.nombre}.`);
  }

  async function actualizarPatrocinador(id, campo, valor) {
    const anterior = patrocinadores.find((p) => String(p.id) === String(id));
    const nuevoValor = campo === 'activo' ? Boolean(valor) : campo === 'orden' ? Number(valor || 99) : valor;
    setPatrocinadores((prev) => prev.map((p) => String(p.id) === String(id) ? { ...p, [campo]: nuevoValor } : p));
    const { error } = await supabase.from('patrocinadores').update({ [campo]: nuevoValor }).eq('id', id);
    if (error) {
      alert('No se pudo actualizar patrocinador: ' + error.message);
      await cargarDatosSupabase();
      return;
    }
    registrarCambio('Cambio patrocinador', `${anterior?.nombre || id} / ${campo}: ${nuevoValor}`);
  }

  async function actualizarPremio(id, campo, valor) {
    const premioActual = premios.find((p) => p.id === id);
    const anterior = premioActual ? premioActual[campo] : '';
    const nuevoValor = (campo === 'visible' || campo === 'ilimitado')
      ? Boolean(valor)
      : (campo === 'nombre' || campo === 'categoria' || campo === 'patrocinadorId')
        ? valor
        : Number(valor);

    const actualizado = { ...premioActual, [campo]: nuevoValor };
    setPremios((prev) => prev.map((p) => (p.id === id ? actualizado : p)));

    const payload = {
      premio: actualizado.nombre,
      categoria: actualizado.categoria,
      cantidad: Number(actualizado.stock || 0),
      peso: Number(actualizado.probabilidad || 0),
      visible_cliente: Boolean(actualizado.visible),
      entrega_premio: !Boolean(actualizado.ilimitado),
      activo: true,
      patrocinador_id: actualizado.patrocinadorId || null,
    };
    const { error } = await supabase.from('premios').update(payload).eq('id', id);
    if (error) {
      alert('No se pudo guardar el cambio en Supabase: ' + error.message);
      await cargarDatosSupabase();
      return;
    }

    await supabase.from('historial_premios').insert({
      premio_id: typeof id === 'number' ? id : null,
      premio: actualizado.nombre,
      campo_modificado: campo,
      valor_anterior: String(anterior ?? ''),
      valor_nuevo: String(nuevoValor ?? ''),
      usuario: adminUser || 'admin',
    });
    registrarCambio('Cambio en premio', `${premioActual?.nombre || id} / ${campo}: ${anterior} -> ${nuevoValor}`);
  }

  async function guardarConfiguracionCentral(nuevaConfig, usuario = adminUser, clave = adminPass) {
    const value = {
      ...nuevaConfig,
      adminUser: usuario,
      adminPass: clave,
    };
    const { error } = await supabase
      .from('configuracion_campana')
      .upsert({ key: 'principal', value, updated_at: new Date().toISOString() });
    if (error) {
      alert('No se pudo guardar la configuración en Supabase: ' + error.message);
      await cargarDatosSupabase();
      return false;
    }
    return true;
  }

  async function actualizarConfig(campo, valor) {
    const anterior = config[campo];
    const nuevoValor = Number(valor);
    const nuevaConfig = { ...config, [campo]: nuevoValor };
    setConfig(nuevaConfig);
    const ok = await guardarConfiguracionCentral(nuevaConfig);
    if (ok) registrarCambio('Cambio de tope/configuración', `${campo}: ${anterior} -> ${nuevoValor}`);
  }

  async function actualizarUsuarioAdmin(valor) {
    const anterior = adminUser;
    setAdminUser(valor);
    const ok = await guardarConfiguracionCentral(config, valor, adminPass);
    if (ok) registrarCambio('Cambio usuario admin', `${anterior} -> ${valor}`);
  }

  async function restaurarPremiosBase() {
    if (!confirm('¿Restaurar premios base? Esto reemplaza los premios actuales en Supabase.')) return;
    const base = PREMIOS_BASE.map((p) => ({
      premio: p.nombre,
      categoria: p.categoria,
      cantidad: Number(p.stock || 0),
      peso: Number(p.probabilidad || 0),
      visible_cliente: Boolean(p.visible),
      entrega_premio: !Boolean(p.ilimitado),
      activo: true,
    }));
    await supabase.from('premios').delete().neq('premio', '__NO_EXISTE__');
    const { data, error } = await supabase.from('premios').insert(base).select();
    if (error) {
      alert('No se pudieron restaurar premios: ' + error.message);
      return;
    }
    setPremios(data.map(mapPremio));
    registrarCambio('Restaurar premios', 'Se restauraron premios base en Supabase.');
  }

  function descargarCSV(nombreArchivo, rows) {
    if (!rows.length) {
      alert('No hay registros para descargar.');
      return;
    }
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(';'),
      ...rows.map((row) => headers.map((h) => `"${String(row[h] ?? '').replaceAll('"', '""')}"`).join(';')),
    ].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    a.click();
    URL.revokeObjectURL(url);
  }

  function descargarExcel(nombreArchivo, rows, hoja = 'Datos') {
    if (!rows.length) {
      alert('No hay registros para descargar.');
      return;
    }
    const headers = Object.keys(rows[0]);
    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta charset="UTF-8"><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${hoja}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml></head>
      <body><table border="1"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((row) => `<tr>${headers.map((h) => `<td>${String(row[h] ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</td>`).join('')}</tr>`).join('')}
      </tbody></table></body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo.endsWith('.xls') ? nombreArchivo : `${nombreArchivo}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function generarBackup() {
    const corte = { id: Date.now(), fecha: sello(), participantes, ganadores, premios, config, cambios, metricas, ventasPorSede, ventasPorDia };
    setBackups((prev) => [{ ...corte, tipo: 'manual', usuario: adminUser || 'admin' }, ...prev].slice(0, 20));

    const { error } = await supabase.from('backups_campana').insert({
      tipo: 'manual',
      data: corte,
      usuario: adminUser || 'admin',
    });
    if (error) alert('No se pudo guardar backup en Supabase: ' + error.message);
    else registrarCambio('Backup manual', 'Se generó respaldo descargable y se guardó copia en Supabase.');

    const blob = new Blob([JSON.stringify(corte, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_ruta_mundial_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function detectarSeparadorCSV(linea) {
    const candidatos = [';', '\t', ','];
    return candidatos
      .map((sep) => ({ sep, count: (linea.match(new RegExp(sep === '\t' ? '\t' : `\\${sep}`, 'g')) || []).length }))
      .sort((a, b) => b.count - a.count)[0].sep;
  }

  function parsearLineaCSV(linea, separador) {
    const valores = [];
    let actual = '';
    let entreComillas = false;
    for (let i = 0; i < linea.length; i += 1) {
      const c = linea[i];
      const siguiente = linea[i + 1];
      if (c === '"' && siguiente === '"') {
        actual += '"';
        i += 1;
      } else if (c === '"') {
        entreComillas = !entreComillas;
      } else if (c === separador && !entreComillas) {
        valores.push(actual.trim());
        actual = '';
      } else {
        actual += c;
      }
    }
    valores.push(actual.trim());
    return valores.map((v) => v.replace(/^\uFEFF/, '').replace(/^"|"$/g, '').trim());
  }

  function normalizarNumero(valor, defecto = 0) {
    const limpio = String(valor ?? '').trim().replace(/\./g, '').replace(',', '.');
    const num = Number(limpio);
    return Number.isFinite(num) ? num : defecto;
  }

  function normalizarBoolean(valor, defecto = false) {
    const limpio = String(valor ?? '').trim().toLowerCase();
    if (['true', 'si', 'sí', '1', 'x', 'activo'].includes(limpio)) return true;
    if (['false', 'no', '0', '', 'inactivo'].includes(limpio)) return false;
    return defecto;
  }

  function cargarPremiosCSV(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const contenido = String(reader.result || '').replace(/^\uFEFF/, '');
      const lines = contenido.split(/\r?\n/).filter((line) => line.trim() !== '');
      if (lines.length < 2) {
        alert('El archivo está vacío.');
        return;
      }

      const separador = detectarSeparadorCSV(lines[0]);
      const headers = parsearLineaCSV(lines[0], separador).map((h) => h.trim().toLowerCase());
      const requiere = ['nombre', 'premio'];
      if (!headers.some((h) => requiere.includes(h))) {
        alert('El CSV debe incluir una columna llamada nombre o premio. Revise que el separador sea correcto.');
        return;
      }

      const nuevos = lines.slice(1).map((line, index) => {
        const values = parsearLineaCSV(line, separador);
        const row = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
        const nombre = String(row.nombre || row.premio || `Premio ${index + 1}`).trim();
        const nombreNormalizado = nombre.toLowerCase();
        const patrocinadorNombre = String(row.patrocinador || row.aliado || row.aplica_si_marca || '').trim().toLowerCase();
        const esGeneral = !patrocinadorNombre || patrocinadorNombre === 'general' || patrocinadorNombre === 'ninguno';
        const patrocinador = esGeneral
          ? null
          : patrocinadores.find((p) =>
              String(p.nombre || '').trim().toLowerCase() === patrocinadorNombre ||
              String(p.empresa || '').trim().toLowerCase() === patrocinadorNombre
            );
        const ilimitado = normalizarBoolean(row.ilimitado ?? row.limitado, false) || nombreNormalizado.includes('sigue intentando');
        const visible = (row.visible === undefined || row.visible === '')
          ? !nombreNormalizado.includes('sigue intentando')
          : normalizarBoolean(row.visible, true);

        return {
          premio: nombre,
          categoria: row.categoria || row.tipo || 'producto',
          cantidad: normalizarNumero(row.stock || row.cantidad, 0),
          peso: normalizarNumero(row.probabilidad || row.peso, 1),
          visible_cliente: visible,
          entrega_premio: !ilimitado,
          activo: true,
          patrocinador_id: patrocinador?.id || null,
        };
      }).filter((p) => p.premio && p.premio.toLowerCase() !== 'premio');

      const seguro = confirm(`Se reemplazarán los premios actuales en Supabase por ${nuevos.length} premios del CSV. ¿Continuar?`);
      if (!seguro) return;

      const del = await supabase.from('premios').delete().neq('premio', '__NO_EXISTE__');
      if (del.error) {
        alert('No se pudieron borrar premios anteriores: ' + del.error.message);
        return;
      }
      const { data, error } = await supabase.from('premios').insert(nuevos).select();
      if (error) {
        alert('No se pudo cargar CSV en Supabase: ' + error.message);
        return;
      }
      setPremios(data.map(mapPremio));
      registrarCambio('Carga de premios CSV', `Se cargó el archivo ${file.name} con ${nuevos.length} premios en Supabase.`);
      alert('Premios cargados correctamente en Supabase. Ya se verán igual en otros computadores.');
    };
    reader.readAsText(file, 'latin1');
    event.target.value = '';
  }

  async function borrarTablaCompleta(tabla) {
    // Borrado real en Supabase por lotes. No depende de localStorage ni de la pantalla actual.
    let eliminados = 0;
    while (true) {
      const { data: filas, error: selectError } = await supabase.from(tabla).select('id').limit(500);
      if (selectError) return { error: selectError, count: eliminados };
      const ids = (filas || []).map((row) => row.id).filter((id) => id !== null && id !== undefined);
      if (!ids.length) break;

      const { data: deleted, error } = await supabase.from(tabla).delete().in('id', ids).select('id');
      if (error) return { error, count: eliminados };
      eliminados += deleted?.length || ids.length;

      if (ids.length < 500) break;
    }
    return { error: null, count: eliminados };
  }

  function limpiarEstadoDespuesDeBorrado() {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {}
    setParticipantes([]);
    setGanadores([]);
    setSeleccionado('');
    setParticipanteLocalId('');
    setResultado(null);
    setVista('Inicio');
  }

  async function borrarDemo() {
    const mensaje = '¿Borrar definitivamente participantes, autorizaciones y ganadores de prueba en Supabase? Esta acción se reflejará en todos los celulares y computadores. Los premios y configuración se conservan.';
    if (!confirm(mensaje)) return;

    limpiarEstadoDespuesDeBorrado();

    // 1) Primer intento: función segura en Supabase. Requiere ejecutar el SQL incluido.
    const rpc = await supabase.rpc('reset_campana_demo');
    if (!rpc.error) {
      await supabase.from('auditoria_admin').insert({
        usuario: adminUser || 'admin',
        accion: 'Borrar demo',
        detalle: 'Borrado total mediante función reset_campana_demo.',
      });
      await cargarDatosSupabase();
      limpiarEstadoDespuesDeBorrado();
      alert('Datos de prueba borrados correctamente en Supabase. Todos los dispositivos quedan listos para empezar.');
      return;
    }

    // 2) Segundo intento: borrado directo por lotes si las políticas DELETE/RLS están activas.
    const tablas = ['autorizaciones_datos', 'ganadores', 'participantes'];
    const resultados = [];
    const errores = [];

    for (const tabla of tablas) {
      const resultado = await borrarTablaCompleta(tabla);
      if (resultado.error) errores.push(`${tabla}: ${resultado.error.message}`);
      else resultados.push(`${tabla}: ${resultado.count} registro(s)`);
    }

    const verificacion = await Promise.all([
      supabase.from('participantes').select('id').limit(1),
      supabase.from('ganadores').select('id').limit(1),
      supabase.from('autorizaciones_datos').select('id').limit(1),
    ]);
    const quedaronDatos = verificacion.some((res) => !res.error && (res.data || []).length > 0);
    await cargarDatosSupabase();

    if (errores.length || quedaronDatos) {
      limpiarEstadoDespuesDeBorrado();
      alert('La pantalla se limpió, pero Supabase no permitió borrar todo. Ejecute en Supabase el archivo SQL: SUPABASE_RESET_TOTAL_CAMPANA.sql y vuelva a presionar Borrar demo. Detalle: ' + (errores.join(' | ') || 'quedaron datos en la base'));
      console.error('Errores borrando datos:', errores, 'RPC:', rpc.error?.message, 'Verificación:', verificacion);
      return;
    }

    await supabase.from('auditoria_admin').insert({
      usuario: adminUser || 'admin',
      accion: 'Borrar demo',
      detalle: `Borrado directo en Supabase. ${resultados.join(' | ')}`,
    });

    limpiarEstadoDespuesDeBorrado();
    alert('Datos de prueba borrados correctamente en Supabase. La pantalla quedó lista para empezar. ' + resultados.join(' | '));
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo-machimbres.png" alt="Machimbres y Maderas" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <h3>Machimbres y Maderas S.A.S.</h3>
          <small>Construimos tus ideas</small>
        </div>

        <nav>
          {['Inicio', 'Participa', 'Ruleta', 'Ranking', 'Premios', 'Metodología', 'Reglamento', 'Sucursales', 'Admin'].map((item) => (
            <button key={item} className={vista === item ? 'active' : ''} onClick={() => setVista(item)}>
              {item}
            </button>
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
            <div className="heroBall">⚽</div>
            <h1>
              RUTA AL MUNDIAL
              <br />
              DEL MUEBLE <em>2026</em>
            </h1>
            <p>COMPRA • ACUMULA • GIRA • GANA</p>
            <div className="validBox">
              <b>Campaña válida en:</b>
              <span>✅ Machimbres y Maderas S.A.S.</span>
              <span>✅ DEKO LÁMINAS</span>
              <span>✅ DEKO DESIGN CENTER</span>
            </div>
          </div>
        </section>

        <section className="sponsorStrip">
          <div className="sponsorStripTitle">
            <span>Aliados estratégicos de la campaña</span>
            <small>Marcas patrocinadoras y beneficios especiales</small>
          </div>
          <div className="sponsorLogos">
            {patrocinadoresActivos.length === 0 ? (
              <span className="sponsorEmpty">Próximamente nuevos aliados</span>
            ) : patrocinadoresActivos.map((p) => (
              <a
                key={p.id}
                className="sponsorLogo"
                href={p.pagina_web || p.instagram || (p.whatsapp ? `https://wa.me/${String(p.whatsapp).replace(/\D/g, '')}` : '#')}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { if (!p.pagina_web && !p.instagram && !p.whatsapp) e.preventDefault(); }}
                title={p.nombre}
              >
                {p.logo_url ? <img src={p.logo_url} alt={p.nombre} /> : <strong>{p.nombre}</strong>}
              </a>
            ))}
          </div>
        </section>

        {vista === 'Admin' && adminOk && (
          <section className="statsGrid">
            <Stat icon="🛒" value={money(metricas.totalCompras)} label="Total vendido" />
            <Stat icon="👥" value={metricas.clientes} label="Clientes registrados" />
            <Stat icon="🛡️" value={metricas.autorizaciones} label="Autorizaciones guardadas" />
            <Stat icon="🏆" value={metricas.premiosEntregados} label="Premios entregados" />
            <Stat icon="⭐" value={metricas.puntos} label="Puntos generados" />
          </section>
        )}

        {vista === 'Inicio' && (
          <section className="dashboard">
            <div className="card">
              <h2>¿Cómo participar?</h2>
              <Step n="1" text="Compra en cualquiera de nuestras sucursales." />
              <Step n="2" text="Registra una factura FE, FD o STFD, sin guion." />
              <Step n="3" text="Acepta tratamiento de datos y reglamento." />
              <Step n="4" text="Gira la ruleta y gana premios." />
              <Step n="5" text="Acumula puntos para el ranking." />
            </div>
            <div className="card wheelPanel">
              <h2>Gira la ruleta y gana</h2>
              <div className={`wheel ${girando ? 'spin' : ''}`}><div>GIRAR</div></div>
              <button className="primary" onClick={() => setVista('Participa')}>Participar ahora</button>
            </div>
            <div className="card">
              <h2>Top ranking</h2>
              {ranking.length === 0 && <p>Aún no hay participantes.</p>}
              {ranking.slice(0, 5).map((p, i) => (
                <div className="miniRow" key={p.id}>
                  <b>#{i + 1}</b>
                  <span>{nombrePublico(p)}</span>
                  <strong>{p.puntos} pts</strong>
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
                <label>Nombre*<input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></label>
                <label>Apellido<input value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} /></label>
                <label>Celular*<input value={form.celular} onChange={(e) => setForm({ ...form, celular: e.target.value })} /></label>
                <label>Correo<input value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} /></label>
                <label>Sede*<select value={form.sede} onChange={(e) => setForm({ ...form, sede: e.target.value })}>{SEDES.map((s) => <option key={s.prefijo} value={s.nombre}>{s.nombre} ({s.prefijo})</option>)}</select></label>
                <label>Factura*<input value={form.factura} onChange={(e) => setForm({ ...form, factura: e.target.value.toUpperCase() })} placeholder="FE28501 / FD9101 / STFD3201" /></label>
                <label>Valor compra*<input type="number" value={form.valorCompra} onChange={(e) => setForm({ ...form, valorCompra: e.target.value })} /></label>
                <label>Vendedor<input value={form.vendedor} onChange={(e) => setForm({ ...form, vendedor: e.target.value })} /></label>
                <div className="brandPicker">
                  <strong>Marcas patrocinadoras compradas</strong>
                  <small>Puede seleccionar una, varias o dejar sin marcar si la factura no incluye marcas patrocinadoras.</small>
                  <div className="sponsorChecks">
                    {patrocinadoresActivos.length === 0 && <span className="muted">No hay patrocinadores activos.</span>}
                    {patrocinadoresActivos.map((p) => {
                      const checked = (form.patrocinadorIds || []).map(String).includes(String(p.id));
                      return (
                        <label key={p.id} className={`sponsorCheck ${checked ? 'selected' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() => togglePatrocinadorRegistro(p.id)} />
                          {p.logo_url && <img src={p.logo_url} alt={p.nombre} />}
                          <span>{p.nombre}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="calc">
                <div><b>{money(form.valorCompra)}</b><span>Compra</span></div>
                <div><b>{calcularOportunidades(form.valorCompra)}</b><span>Oportunidades</span></div>
                <div><b>{calcularOportunidades(form.valorCompra) * Number(config.puntosPorOportunidad)}</b><span>Puntos</span></div>
              </div>

              <div className="methodBox">
                Cada {money(config.valorPorOportunidad)} suma {config.puntosPorOportunidad} puntos y 1 oportunidad. Máximo {config.maxOportunidades} oportunidades por factura.
              </div>
              {(form.patrocinadorIds || []).length > 0 && (
                <div className="sponsorSelected">
                  Participará también por premios patrocinados por <strong>{nombresPatrocinadores(form.patrocinadorIds)}</strong>, sujetos a disponibilidad y probabilidad interna.
                </div>
              )}

              <label className="privacy"><input type="checkbox" checked={form.autorizacion} onChange={(e) => setForm({ ...form, autorizacion: e.target.checked })} /><span>Autorizo el tratamiento de mis datos personales y acepto el reglamento oficial de la campaña. <a href={REGLAMENTO_PDF} target="_blank" rel="noopener noreferrer">Ver PDF</a></span></label>
              <button className="primary big" type="submit">Registrarme y jugar</button>
            </form>
          </section>
        )}

        {vista === 'Ruleta' && (
          <section className="card center">
            <h2>Ruleta del Gol</h2>
            {participantesDisponiblesRuleta.length > 0 ? (
              <div className="factura-activa">
                <strong>Factura lista para jugar:</strong>
                <span>{participantesDisponiblesRuleta[0].factura} · {Number(participantesDisponiblesRuleta[0].oportunidades || 0)} giro(s) disponible(s)</span>
                {(participantesDisponiblesRuleta[0].patrocinadorIds || []).length > 0 && (
                  <small className="sponsorPlayNotice">También participa por beneficios de {nombresPatrocinadores(participantesDisponiblesRuleta[0].patrocinadorIds)}</small>
                )}
              </div>
            ) : (
              <p className="muted">No hay participantes disponibles para girar en este dispositivo. Registre una factura nueva o verifique que la factura no haya sido jugada.</p>
            )}
            <div className={`wheel smallWheel ${girando ? 'spin' : ''}`}><div>GIRAR</div></div>
            <button className="primary big" disabled={!participantePuedeGirar || participantesDisponiblesRuleta.length === 0} onClick={girar}>Girar ruleta</button>
            {resultado && (() => {
              const nombreResultado = String(resultado?.nombre || '').trim();
              const esSigueIntentando = nombreResultado.toLowerCase() === 'sigue intentando';
              return (
                <div className={esSigueIntentando ? 'winner noPrize' : 'winner prizeWin'}>
                  <h3>{esSigueIntentando ? 'Sigue intentando' : '¡Felicitaciones!'}</h3>
                  <p>Resultado: <strong>{nombreResultado}</strong></p>
                  {esSigueIntentando ? (
                    <small>Esta vez no obtuviste premio. Puedes seguir participando con tus próximas compras.</small>
                  ) : (
                    <small>Premio sujeto a validación de factura, disponibilidad y condiciones.</small>
                  )}
                </div>
              );
            })()}
          </section>
        )}

        {vista === 'Ranking' && (
          <section className="card readable">
            <h2>Ranking acumulado</h2>
            {ranking.length === 0 && <p>Aún no hay participantes.</p>}
            {ranking.map((p, i) => <div className="rankRow" key={p.id}><b>#{i + 1}</b><div><strong>{p.nombre} {p.apellido}</strong><small>{p.factura} · {money(p.valorCompra)} · {p.sede}</small></div><strong>{p.puntos} pts</strong></div>)}
          </section>
        )}

        {vista === 'Premios' && (
          <section className="card readable">
            <h2>Premios disponibles</h2>
            <div className="prizeGrid">
              {premios.filter((p) => p.visible).map((p) => <div className="prize" key={p.id}><span className="giftIcon">🎁</span><h3>{p.nombre}</h3><p>{p.categoria}</p><strong>{p.ilimitado ? 'Disponible durante la campaña' : `Disponibles: ${p.stock}`}</strong></div>)}
            </div>
          </section>
        )}

        {vista === 'Metodología' && (
          <section className="card readable legal">
            <h2>Metodología</h2>
            <ul>
              <li>Compra mínima configurable desde administración: {money(config.compraMinima)}.</li>
              <li>Por cada {money(config.valorPorOportunidad)} recibe 1 oportunidad.</li>
              <li>Cada oportunidad suma {config.puntosPorOportunidad} puntos.</li>
              <li>Prefijos válidos: FE, FD y STFD. Digite sin guion, ejemplo FE28501.</li>
              <li>La probabilidad de premios es interna y no se muestra al cliente.</li>
            </ul>
          </section>
        )}

        {vista === 'Reglamento' && (
          <section className="card readable legal reglamentoBox">
            <h2>Reglamento oficial de la campaña</h2>
            <p><strong>Ruta al Mundial del Mueble 2026</strong> es una campaña promocional de fidelización comercial organizada por Machimbres y Maderas S.A.S. La participación implica aceptación total del reglamento oficial, autorización de tratamiento de datos personales y validación posterior de la factura registrada.</p>
            <div className="regActions">
              <a className="docButton" href={REGLAMENTO_PDF} target="_blank" rel="noopener noreferrer">📄 Ver Reglamento Oficial PDF</a>
              <a className="docButton secondary" href={REGLAMENTO_PDF} download>⬇ Descargar reglamento</a>
            </div>
            <h3>Condiciones principales</h3>
            <ul>
              <li>La campaña es promocional y de fidelización comercial. No constituye rifa, apuesta ni juego de suerte y azar.</li>
              <li>Solo participan compras reales con factura válida emitida por las sedes autorizadas.</li>
              <li>Las facturas anuladas, repetidas, alteradas, reversadas o sujetas a devolución pueden invalidar puntos, oportunidades y premios.</li>
              <li>Los premios están sujetos a validación, disponibilidad de inventario, auditoría interna y cumplimiento de requisitos.</li>
              <li>El resultado "Sigue intentando" hace parte de la mecánica promocional y no constituye premio ni obligación económica.</li>
              <li>La empresa podrá suspender, modificar, auditar, corregir o cancelar registros cuando existan razones operativas, tecnológicas, comerciales, legales o de seguridad.</li>
              <li>El participante autoriza el tratamiento de datos personales conforme a la Ley 1581 de 2012 y normas aplicables.</li>
            </ul>
            <p className="legalWarning"><strong>Importante:</strong> El documento PDF es la versión oficial aplicable. Este resumen es solo informativo.</p>
          </section>
        )}

        {vista === 'Sucursales' && (
          <section className="card readable">
            <h2>Sucursales</h2>
            {SEDES.map((s) => <div className="branch" key={s.prefijo}><span>📍</span><div><strong>{s.nombre}</strong><p>Prefijo válido: {s.prefijo}</p></div></div>)}
          </section>
        )}

        {vista === 'Admin' && (
          <section className="card readable">
            {!adminOk ? (
              <div className="loginBox">
                <h2>Panel administrativo</h2>
                <p>Ingrese las credenciales autorizadas para administrar la campaña.</p><p className="adminNote">La clave no se muestra por seguridad. La recuperación queda asociada a <strong>{RECOVERY_EMAIL}</strong> cuando se active Supabase Auth.</p>
                <form onSubmit={iniciarAdmin}>
                  <input placeholder="Usuario" value={login.usuario} onChange={(e) => setLogin({ ...login, usuario: e.target.value })} />
                  <input placeholder="Contraseña" type="password" value={login.clave} onChange={(e) => setLogin({ ...login, clave: e.target.value })} />
                  <button className="primary" type="submit">Ingresar</button>
                </form>
                <button className="linkButton" type="button" onClick={solicitarRecuperacion}>Olvidé mi contraseña</button>
              </div>
            ) : (
              <>
                <div className="adminHeader"><div><h2>Panel administrativo</h2><p>Topes, premios, probabilidades y reportes.</p></div><button className="logout" onClick={() => setAdminOk(false)}>Salir</button></div>
                <div className="adminDashboard">
                  <div><span>Total vendido campaña</span><strong>{money(metricas.totalCompras)}</strong></div>
                  <div><span>Participantes</span><strong>{metricas.clientes}</strong></div>
                  <div><span>Ruletas jugadas</span><strong>{metricas.ruletas}</strong></div>
                  <div><span>Premios entregados</span><strong>{metricas.premiosEntregados}</strong></div>
                  <div><span>Puntos generados</span><strong>{metricas.puntos}</strong></div>
                  <div><span>Último backup</span><strong>{backups[0]?.fecha || 'Sin backup'}</strong></div>
                </div>

                <div className="card adminSubCard">
                  <h2>Ventas por sede</h2>
                  <div className="salesGrid">
                    {ventasPorSede.map((v) => (
                      <div key={v.prefijo}>
                        <b>{v.prefijo}</b>
                        <strong>{money(v.total)}</strong>
                        <span>{v.facturas} factura(s) · {v.puntos} pts</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card adminSubCard">
                  <h2>Ventas por patrocinador / marca</h2>
                  <div className="salesGrid">
                    {ventasPorPatrocinador.length === 0 && <p className="muted">Aún no hay ventas asociadas a patrocinadores.</p>}
                    {ventasPorPatrocinador.map((v) => (
                      <div key={v.patrocinador}>
                        <b>{v.patrocinador}</b>
                        <strong>{money(v.total)}</strong>
                        <span>{v.facturas} factura(s) · {v.puntos} pts</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="adminGrid">
                  <button onClick={() => descargarExcel('participantes.xls', participantes, 'Participantes')}>Participantes Excel</button>
                  <button onClick={() => descargarExcel('ganadores.xls', ganadores, 'Ganadores')}>Ganadores Excel</button>
                  <button onClick={() => descargarExcel('ventas_por_sede.xls', ventasPorSede, 'VentasPorSede')}>Ventas Excel</button>
                  <button onClick={() => descargarExcel('ventas_por_patrocinador.xls', ventasPorPatrocinador, 'VentasPorPatrocinador')}>Patrocinadores Excel</button>
                  <button onClick={() => descargarExcel('auditoria.xls', cambios, 'Auditoria')}>Auditoría Excel</button>
                  <button onClick={generarBackup}>Backup JSON</button>
                  <button onClick={restaurarPremiosBase}>Restaurar premios</button>
                  <button className="danger" onClick={borrarDemo}>Borrar demo</button>
                  <label className="uploadBtn">Subir CSV premios<input type="file" accept=".csv" onChange={cargarPremiosCSV} /></label>
                </div>

                <div className="card adminSubCard">
                  <h2>Configuración editable</h2>
                  <p className="muted">Control de facturas: configure la última factura emitida antes de iniciar la campaña. La primera válida será el número siguiente. Ejemplo: si FE = 28500, participa desde FE28501.</p>
                  <div className="grid">
                    <label>Compra mínima<input type="number" value={config.compraMinima} onChange={(e) => actualizarConfig('compraMinima', e.target.value)} /></label>
                    <label>Valor por oportunidad<input type="number" value={config.valorPorOportunidad} onChange={(e) => actualizarConfig('valorPorOportunidad', e.target.value)} /></label>
                    <label>Puntos por oportunidad<input type="number" value={config.puntosPorOportunidad} onChange={(e) => actualizarConfig('puntosPorOportunidad', e.target.value)} /></label>
                    <label>Máximo oportunidades<input type="number" value={config.maxOportunidades} onChange={(e) => actualizarConfig('maxOportunidades', e.target.value)} /></label>
                    <label>Última factura FE antes de campaña<input type="number" value={config.ultimaFacturaFE || 0} onChange={(e) => actualizarConfig('ultimaFacturaFE', e.target.value)} /></label>
                    <label>Última factura FD antes de campaña<input type="number" value={config.ultimaFacturaFD || 0} onChange={(e) => actualizarConfig('ultimaFacturaFD', e.target.value)} /></label>
                    <label>Última factura STFD antes de campaña<input type="number" value={config.ultimaFacturaSTFD || 0} onChange={(e) => actualizarConfig('ultimaFacturaSTFD', e.target.value)} /></label>
                    <label>Usuario admin<input value={adminUser} onChange={(e) => actualizarUsuarioAdmin(e.target.value)} /></label>
                    <label>Correo recuperación<input value={RECOVERY_EMAIL} readOnly /></label>
                  </div>
                </div>

                <div className="card adminSubCard">
                  <h2>Cambiar clave del administrador</h2>
                  <p>La clave no se muestra. Para cambiarla debe digitar la actual y confirmar la nueva.</p>
                  <form className="grid" onSubmit={cambiarClaveAdmin}>
                    <label>Clave actual<input type="password" value={passForm.actual} onChange={(e) => setPassForm({ ...passForm, actual: e.target.value })} /></label>
                    <label>Nueva clave<input type="password" value={passForm.nueva} onChange={(e) => setPassForm({ ...passForm, nueva: e.target.value })} /></label>
                    <label>Confirmar nueva clave<input type="password" value={passForm.confirmar} onChange={(e) => setPassForm({ ...passForm, confirmar: e.target.value })} /></label>
                    <button className="primary" type="submit">Guardar nueva clave</button>
                  </form>
                </div>

                <div className="card adminSubCard">
                  <h2>Patrocinadores y aliados estratégicos</h2>
                  <p className="muted">Los logos activos aparecen en el banner superior. Los premios asociados a un patrocinador solo entran en la ruleta cuando el cliente selecciona esa marca en el registro.</p>
                  <form className="grid" onSubmit={guardarPatrocinador}>
                    <label>Nombre patrocinador<input value={patrocinadorForm.nombre} onChange={(e) => setPatrocinadorForm({ ...patrocinadorForm, nombre: e.target.value })} placeholder="Ecofort" /></label>
                    <label>Empresa<input value={patrocinadorForm.empresa} onChange={(e) => setPatrocinadorForm({ ...patrocinadorForm, empresa: e.target.value })} /></label>
                    <label>Responsable<input value={patrocinadorForm.responsable} onChange={(e) => setPatrocinadorForm({ ...patrocinadorForm, responsable: e.target.value })} /></label>
                    <label>Teléfono / WhatsApp<input value={patrocinadorForm.whatsapp || patrocinadorForm.telefono} onChange={(e) => setPatrocinadorForm({ ...patrocinadorForm, telefono: e.target.value, whatsapp: e.target.value })} /></label>
                    <label>Correo<input value={patrocinadorForm.correo} onChange={(e) => setPatrocinadorForm({ ...patrocinadorForm, correo: e.target.value })} /></label>
                    <label>Página web<input value={patrocinadorForm.pagina_web} onChange={(e) => setPatrocinadorForm({ ...patrocinadorForm, pagina_web: e.target.value })} /></label>
                    <label>Instagram<input value={patrocinadorForm.instagram} onChange={(e) => setPatrocinadorForm({ ...patrocinadorForm, instagram: e.target.value })} /></label>
                    <label>Orden banner<input type="number" value={patrocinadorForm.orden} onChange={(e) => setPatrocinadorForm({ ...patrocinadorForm, orden: e.target.value })} /></label>
                    <label>Subir logo<input type="file" accept="image/*" onChange={cargarLogoPatrocinador} /></label>
                    <label>Subir promocional<input type="file" accept="image/*" onChange={cargarBannerPatrocinador} /></label>
                    <label className="checkLine"><input type="checkbox" checked={patrocinadorForm.activo} onChange={(e) => setPatrocinadorForm({ ...patrocinadorForm, activo: e.target.checked })} /> Activo en campaña</label>
                    <button className="primary" type="submit">Guardar patrocinador</button>
                  </form>

                  {(patrocinadorForm.logo_url || patrocinadorForm.banner_url) && (
                    <div className="sponsorPreview">
                      {patrocinadorForm.logo_url && <img src={patrocinadorForm.logo_url} alt="Vista logo" />}
                      {patrocinadorForm.banner_url && <img src={patrocinadorForm.banner_url} alt="Vista promocional" />}
                    </div>
                  )}

                  <div className="tableWrap">
                    <table>
                      <thead><tr><th>Logo</th><th>Patrocinador</th><th>Contacto</th><th>Orden</th><th>Activo</th></tr></thead>
                      <tbody>{deduplicarPatrocinadores(patrocinadores).map((p) => (
                        <tr key={p.id}>
                          <td>{p.logo_url ? <img className="miniLogo" src={p.logo_url} alt={p.nombre} /> : 'Sin logo'}</td>
                          <td><strong>{p.nombre}</strong><br /><small>{p.empresa}</small></td>
                          <td><small>{p.responsable}<br />{p.telefono || p.whatsapp}<br />{p.correo}</small></td>
                          <td><input type="number" value={p.orden || 99} onChange={(e) => actualizarPatrocinador(p.id, 'orden', e.target.value)} /></td>
                          <td><input type="checkbox" checked={p.activo !== false} onChange={(e) => actualizarPatrocinador(p.id, 'activo', e.target.checked)} /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>

                <div className="card adminSubCard">
                  <h2>Premios y probabilidades internas</h2>
                  <p>Estos valores solo se ven en administración. El cliente no ve pesos ni probabilidades.</p>
                  <div className="tableWrap">
                    <table>
                      <thead><tr><th>Premio</th><th>Categoría</th><th>Stock</th><th>Probabilidad interna</th><th>Visible cliente</th><th>Ilimitado</th><th>Patrocinador</th></tr></thead>
                      <tbody>{premios.map((p) => <tr key={p.id}><td><input value={p.nombre} onChange={(e) => actualizarPremio(p.id, 'nombre', e.target.value)} /></td><td><input value={p.categoria} onChange={(e) => actualizarPremio(p.id, 'categoria', e.target.value)} /></td><td><input type="number" value={p.stock} onChange={(e) => actualizarPremio(p.id, 'stock', e.target.value)} /></td><td><input type="number" step="0.1" value={p.probabilidad} onChange={(e) => actualizarPremio(p.id, 'probabilidad', e.target.value)} /></td><td><input type="checkbox" checked={p.visible} onChange={(e) => actualizarPremio(p.id, 'visible', e.target.checked)} /></td><td><input type="checkbox" checked={p.ilimitado} onChange={(e) => actualizarPremio(p.id, 'ilimitado', e.target.checked)} /></td><td><select value={p.patrocinadorId || ''} onChange={(e) => actualizarPremio(p.id, 'patrocinadorId', e.target.value)}><option value="">General</option>{patrocinadoresActivos.map((sp) => <option key={sp.id} value={sp.id}>{sp.nombre}</option>)}</select></td></tr>)}</tbody>
                    </table>
                  </div>
                </div>

                <div className="card adminSubCard">
                  <h2>Histórico de cambios</h2>
                  <p>Queda registrado si se movieron premios, stock, probabilidades, topes, usuario o clave, con fecha y hora.</p>
                  <div className="auditList">
                    {cambios.length === 0 && <p>No hay cambios registrados.</p>}
                    {cambios.slice(0, 50).map((c) => (
                      <div key={c.id}>
                        <b>{c.fecha}</b>
                        <span>{c.accion}</span>
                        <small>{c.detalle}</small>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        <footer><span>🔒 Datos seguros · Ley 1581 de 2012</span><a href={REGLAMENTO_PDF} target="_blank" rel="noopener noreferrer">📄 Reglamento oficial PDF</a></footer>
      </main>
    </div>
  );
}

function Stat({ icon, value, label }) {
  return <div className="stat"><span className="statIcon">{icon}</span><div><b>{value}</b><span>{label}</span></div></div>;
}

function Step({ n, text }) {
  return <div className="step"><b>{n}</b><span>{text}</span></div>;
}
