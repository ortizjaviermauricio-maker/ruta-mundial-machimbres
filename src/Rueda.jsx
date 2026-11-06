import React from 'react';

const CENTRO = 200;
const RADIO = 170;
const SECTORES = 12;
const LUCES = 24;
const COLORES = ['#fa7b14', '#ffffff', '#0e6b1f'];

function punto(radio, grados) {
  const radianes = ((grados - 90) * Math.PI) / 180;
  return [CENTRO + radio * Math.cos(radianes), CENTRO + radio * Math.sin(radianes)];
}

function sector(indice) {
  const paso = 360 / SECTORES;
  const [x1, y1] = punto(RADIO, indice * paso);
  const [x2, y2] = punto(RADIO, (indice + 1) * paso);
  return `M${CENTRO} ${CENTRO}L${x1} ${y1}A${RADIO} ${RADIO} 0 0 1 ${x2} ${y2}Z`;
}

function Estrella({ color }) {
  return <polygon fill={color} points="0,-20 5.9,-6.2 20,-6.2 8.8,3.1 12.9,17.5 0,9 -12.9,17.5 -8.8,3.1 -20,-6.2 -5.9,-6.2" />;
}

function Figura({ indice, color }) {
  if (indice % 3 === 0) return <text textAnchor="middle" y="14" fontFamily="var(--titulos)" fontSize="42" fontWeight="800" fill={color}>39</text>;
  return <Estrella color={color} />;
}

// El disco gira solo como animación; el premio lo decide el servidor. Por eso sus sectores no nombran premios.
export default function Rueda({ rotacion = 0 }) {
  const paso = 360 / SECTORES;
  return (
    <div className="rueda" aria-hidden="true">
      <svg className="rueda-disco" viewBox="0 0 400 400" style={{ transform: `rotate(${rotacion}deg)` }}>
        {Array.from({ length: SECTORES }, (_, i) => {
          const fondo = COLORES[i % COLORES.length];
          const figura = fondo === '#ffffff' ? '#fa7b14' : '#ffffff';
          return (
            <g key={i}>
              <path d={sector(i)} fill={fondo} stroke="#ffc23d" strokeWidth="2" />
              <g transform={`rotate(${(i + 0.5) * paso} ${CENTRO} ${CENTRO}) translate(${CENTRO} ${CENTRO - 118})`}>
                <Figura indice={i} color={figura} />
              </g>
            </g>
          );
        })}
      </svg>
      <svg className="rueda-marco" viewBox="0 0 400 400">
        <circle cx={CENTRO} cy={CENTRO} r="181" fill="none" stroke="#123f22" strokeWidth="24" />
        <circle cx={CENTRO} cy={CENTRO} r="193" fill="none" stroke="#ffc23d" strokeWidth="5" />
        <circle cx={CENTRO} cy={CENTRO} r="170" fill="none" stroke="#ffc23d" strokeWidth="4" />
        {Array.from({ length: LUCES }, (_, i) => {
          const [x, y] = punto(181, (i * 360) / LUCES);
          return <circle key={i} className={i % 2 ? 'luz alterna' : 'luz'} cx={x} cy={y} r="6" />;
        })}
        <circle cx={CENTRO} cy={CENTRO} r="62" fill="#ffc23d" />
        <circle cx={CENTRO} cy={CENTRO} r="53" fill="#123f22" />
        <text x={CENTRO} y="210" textAnchor="middle" fontFamily="var(--titulos)" fontSize="62" fontWeight="800" fill="#ffffff">39</text>
        <text x={CENTRO} y="232" textAnchor="middle" fontFamily="var(--titulos)" fontSize="19" fontWeight="800" letterSpacing="3" fill="#ffc23d">AÑOS</text>
        <polygon points="178,0 222,0 200,50" fill="#ffc23d" stroke="#123f22" strokeWidth="4" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
