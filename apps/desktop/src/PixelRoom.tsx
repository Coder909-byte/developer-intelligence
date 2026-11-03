type Room = 'engineering' | 'agents' | 'mcp' | 'settings' | 'devices' | 'bridge';

/** Ambient monitor artwork, never a live terminal or telemetry source. */
function MonitorAnimation({
  x,
  y,
  width,
  height,
  variant = 'terminal',
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  variant?: 'terminal' | 'radar' | 'signal';
}) {
  return (
    <svg
      x={x}
      y={y}
      width={width}
      height={height}
      viewBox="0 0 24 16"
      preserveAspectRatio="none"
      overflow="hidden"
      className="pixel-monitor"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="24" height="16" fill="#11272b" />
      <path d="M0 4h24M0 8h24M0 12h24" stroke="#294346" strokeWidth=".5" />
      {variant === 'terminal' && (
        <>
          <g className="monitor-tape" fill="#acd1b1">
            {[0, 16].map((offset) => (
              <g key={offset} transform={`translate(0 ${offset})`}>
                <path d="M2 2h3v1H2zM7 2h10v1H7zM2 6h15v1H2zM2 10h7v1H2zM11 10h9v1h-9zM2 14h12v1H2z" />
                <path d="M2 4h6v1H2zM4 8h9v1H4zM4 12h6v1H4z" fill="#5d9290" />
              </g>
            ))}
          </g>
          <rect className="monitor-caret" x="19" y="13" width="3" height="1" fill="#f1d49a" />
        </>
      )}
      {variant === 'radar' && (
        <>
          <path
            d="M6 2h12v2h3v8h-3v2H6v-2H3V4h3zM12 0v16M0 8h24"
            fill="none"
            stroke="#48786f"
            strokeWidth="1"
          />
          <g className="monitor-sweep">
            <path d="M12 8h10" stroke="#d0e3ae" strokeWidth="1" />
            <path d="m12 8 8-4v4z" fill="#abd1a3" opacity=".25" />
          </g>
          <path className="monitor-blip" d="M7 4h2v2H7zM17 10h2v2h-2z" fill="#d4dbab" />
        </>
      )}
      {variant === 'signal' && (
        <g className="monitor-wave">
          {[0, 24].map((offset) => (
            <path
              key={offset}
              transform={`translate(${offset} 0)`}
              d="M0 10h4l2-5 3 8 3-11 3 8h9"
              fill="none"
              stroke="#e1c99b"
              strokeWidth="1"
            />
          ))}
        </g>
      )}
      <path d="M0 0h24v1H0z" fill="#c2e6ce" opacity=".2" />
    </svg>
  );
}

/** Original vector pixel art. Decorative furnishings are not live device/agent counts. */
export function PixelRoom({ room, door = 'bottom' }: { room: Room; door?: 'top' | 'bottom' }) {
  return (
    <svg
      className="pixel-room-scene"
      viewBox="0 0 96 64"
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      <defs>
        <pattern id={`floor-${room}`} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="var(--pixel-floor, #343044)" />
          <path d="M0 11h12M11 0v12" stroke="var(--pixel-grid, #454054)" strokeWidth="1" />
          <rect x="2" y="2" width="2" height="2" fill="var(--pixel-tile, #3e394d)" />
        </pattern>
      </defs>
      <path d="M8 4h80v4h4v48h-4v4H8v-4H4V8h4Z" fill="#101c2d" />
      <path d="M10 8h76v4h4v40h-4v4H10v-4H6V12h4Z" fill={`url(#floor-${room})`} />
      <path
        d={door === 'top' ? 'M10 8h29v5H10zM57 8h29v5H57z' : 'M10 8h76v5H10z'}
        fill="var(--pixel-wall, #8a7e89)"
      />
      <path d="M6 13h4v39H6zM86 13h4v39h-4z" fill="var(--pixel-wall-side, #5d536a)" />
      <path
        d={door === 'bottom' ? 'M14 54h25v4H14zM57 54h25v4H57z' : 'M14 54h68v4H14z'}
        fill="var(--pixel-wall, #8a7e89)"
      />
      {door === 'bottom' ? (
        <>
          <path d="M41 58h14v6H41z" fill="var(--pixel-floor, #343044)" />
          <path d="M41 54h14v4H41z" fill="#d5bd8c" />
        </>
      ) : (
        <>
          <path d="M41 0h14v13H41z" fill="var(--pixel-floor, #343044)" />
          <path d="M41 6h14v3H41z" fill="#d5bd8c" />
          <path d="M38 4h3v9h-3zM55 4h3v9h-3z" fill="var(--pixel-wall-side, #5d536a)" />
        </>
      )}
      {room === 'engineering' && (
        <>
          <path d="M36 15h24v4h5v24h-5v5H36v-5h-5V19h5z" fill="#111d2a" />
          <path d="M38 18h20v4h4v18h-4v4H38v-4h-4V22h4z" fill="#927653" />
          <path d="M41 22h14v4h4v10h-4v4H41v-4h-4V26h4z" fill="#d9b777" />
          <path d="M44 26h8v10h-8z" className="pixel-light-reactor" fill="#fff0ba" />
          <path d="M17 19h8v26h-8zM71 19h8v26h-8z" fill="#172536" />
          <MonitorAnimation x={18} y={21} width={6} height={18} variant="signal" />
          <MonitorAnimation x={72} y={21} width={6} height={18} />
          <path d="M25 31h6M65 31h6" stroke="#a78f64" strokeWidth="2" />
        </>
      )}
      {room === 'agents' && (
        <>
          <path d="M14 17h20v30H14zM62 17h20v30H62z" fill="#111e31" />
          <path d="M16 19h16v8H16zM64 19h16v8H64z" fill="#b1b9bc" />
          <path d="M16 28h16v16H16z" fill="#987ba7" />
          <path d="M64 28h16v16H64z" fill="#779d98" />
          <path d="M18 30h12v2H18zM66 30h12v2H66z" fill="#c1acc4" />
          <path d="M36 15h24v16H36z" fill="#152330" />
          <path d="M37 16h22v14H37z" fill="#8c7e9a" />
          <MonitorAnimation x={39} y={18} width={18} height={10} />
          <path d="M42 29h12v4H42z" fill="#765f55" />
        </>
      )}
      {room === 'mcp' && (
        <>
          <path d="M15 17h16v31H15zM65 17h16v31H65z" fill="#111d30" />
          <path
            d="M17 19h12v5H17zM17 27h12v5H17zM17 35h12v5H17zM67 19h12v5H67zM67 27h12v5H67zM67 35h12v5H67z"
            fill="#6b807c"
          />
          <path d="M19 20h2v2h-2zM19 28h2v2h-2zM69 20h2v2h-2zM69 36h2v2h-2z" fill="#9dc9c1" />
          <path d="M38 19h20v3h4v16h-4v3H38v-3h-4V22h4z" fill="#0e1b2b" />
          <path d="M39 22h18v14H39z" fill="#46766c" />
          <MonitorAnimation x={39} y={22} width={18} height={14} variant="radar" />
          <path d="M45 41h6v4h7v3H38v-3h7z" fill="#8797a2" />
        </>
      )}
      {room === 'settings' && (
        <>
          <path d="M17 18h62v25H17z" fill="#111d30" />
          <path d="M19 20h58v17H19z" fill="#756185" />
          <path d="M23 24h14v9H23zM41 24h14v9H41zM59 24h14v9H59z" fill="#142938" />
          <MonitorAnimation x={24} y={25} width={12} height={7} />
          <MonitorAnimation x={42} y={25} width={12} height={7} variant="signal" />
          <MonitorAnimation x={60} y={25} width={12} height={7} variant="radar" />
          <path d="M19 39h58v6H19z" fill="#93819e" />
          <path d="M23 40h17v2H23zM55 40h18v2H55z" fill="#c2af8e" />
          <path d="M44 46h9v6h-9z" fill="#83687e" />
        </>
      )}
      {room === 'devices' && (
        <>
          <path d="M15 19h28v26H15z" fill="#111e2c" />
          <path d="M17 21h24v18H17z" fill="#395e62" />
          <path d="M23 25h12v10H23z" fill="#7a9d8a" />
          <MonitorAnimation x={24} y={26} width={10} height={8} variant="signal" />
          <path d="M20 41h18v3H20z" fill="#ced1a8" />
          <path d="M55 19h22v16H55zM59 38h22v12H59z" fill="#785f4b" />
          <path d="M57 21h18v11H57zM61 40h18v7H61z" fill="#c0936b" />
          <path d="M64 21h4v11h-4zM68 40h4v7h-4z" fill="#c6ae85" />
          <path d="M45 22h5v23h6" stroke="#798799" strokeWidth="2" fill="none" />
        </>
      )}
      {room === 'bridge' && (
        <>
          <path d="M16 16h64v18H16z" fill="#0c182b" />
          <path d="M19 18h16v12H19zM39 18h18v12H39zM61 18h16v12H61z" fill="#4b7977" />
          <MonitorAnimation x={20} y={19} width={14} height={10} />
          <MonitorAnimation x={40} y={19} width={16} height={10} variant="radar" />
          <MonitorAnimation x={62} y={19} width={14} height={10} variant="signal" />
          <path d="M18 35h60v10H18z" fill="#b4bba0" />
          <path d="M22 37h13v5H22zM40 37h16v5H40zM61 37h13v5H61z" fill="#16313e" />
          <path
            d="M24 38h8v2h-8zM42 38h11v2H42zM63 38h8v2h-8z"
            className="pixel-light-console"
            fill="#a1d6be"
          />
          <path d="M42 46h12v7H42z" fill="#5d8287" />
        </>
      )}
      <g
        className="pixel-caretaker"
        transform={room === 'engineering' ? 'translate(67 44)' : 'translate(43 43)'}
      >
        <g className="pixel-roam">
          <g className="pixel-sprite-size" transform="translate(-4.2 -7) scale(1.7)">
            <ellipse
              className="pixel-crew-shadow"
              cx="6"
              cy="10"
              rx="7"
              ry="2"
              fill="#050b14"
              opacity=".6"
            />
            <g className="pixel-stride">
              <path d="M3 0h6v2h2v6H9v3H7V8H5v3H3V8H1V2h2z" fill="#142331" />
              <path d="M3 1h6v2h1v4H2V3h1z" fill="var(--crew-suit, #efd6a4)" />
              <path d="M4 2h5v3H4z" fill="#3e626b" />
              <path d="M5 2h3v1H5z" fill="#d8eee0" />
              <path className="pixel-foot-left" d="M3 7h2v3H3z" fill="var(--crew-boots, #b18e71)" />
              <path
                className="pixel-foot-right"
                d="M7 7h2v3H7z"
                fill="var(--crew-boots, #b18e71)"
              />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

const glyphs: Record<string, string[]> = {
  M: ['10001', '11011', '10101', '10101', '10001'],
  I: ['111', '010', '010', '010', '111'],
  S: ['1111', '1000', '1110', '0001', '1110'],
  O: ['0110', '1001', '1001', '1001', '0110'],
  N: ['1001', '1101', '1011', '1001', '1001'],
  C: ['0111', '1000', '1000', '1000', '0111'],
  T: ['11111', '00100', '00100', '00100', '00100'],
  R: ['1110', '1001', '1110', '1010', '1001'],
  L: ['1000', '1000', '1000', '1000', '1111'],
};
export function PixelHeading() {
  let x = 0;
  const pixels: { x: number; y: number }[] = [];
  for (const letter of 'MISSION CONTROL') {
    const glyph = glyphs[letter];
    if (!glyph) {
      x += 4;
      continue;
    }
    glyph.forEach((row, y) =>
      [...row].forEach((bit, i) => {
        if (bit === '1') pixels.push({ x: x + i, y });
      }),
    );
    x += glyph[0]!.length + 2;
  }
  return (
    <svg
      className="pixel-heading"
      viewBox={`0 0 ${x} 5`}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {pixels.map((p) => (
        <rect key={`${p.x}:${p.y}`} x={p.x} y={p.y} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}
