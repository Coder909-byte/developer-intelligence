type Room = 'engineering' | 'agents' | 'mcp' | 'settings' | 'devices' | 'bridge';

/** Original vector pixel art. Decorative furnishings are not live device/agent counts. */
export function PixelRoom({ room }: { room: Room }) {
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
          <rect width="12" height="12" fill="#233448" />
          <path d="M0 11h12M11 0v12" stroke="#2b4055" strokeWidth="1" />
          <rect x="2" y="2" width="2" height="2" fill="#2a3b50" />
        </pattern>
      </defs>
      <path d="M8 4h80v4h4v48h-4v4H8v-4H4V8h4Z" fill="#101c2d" />
      <path d="M10 8h76v4h4v40h-4v4H10v-4H6V12h4Z" fill={`url(#floor-${room})`} />
      <path d="M10 8h76v5H10z" fill="#465b72" />
      <path d="M6 13h4v39H6zM86 13h4v39h-4z" fill="#344b62" />
      <path d="M14 54h25v4H14zM57 54h25v4H57z" fill="#52667b" />
      <path d="M41 54h14v4H41z" fill="#bca573" />
      {room === 'engineering' && (
        <>
          <path d="M36 15h24v4h5v24h-5v5H36v-5h-5V19h5z" fill="#111d2a" />
          <path d="M38 18h20v4h4v18h-4v4H38v-4h-4V22h4z" fill="#927653" />
          <path d="M41 22h14v4h4v10h-4v4H41v-4h-4V26h4z" fill="#d9b777" />
          <path d="M44 26h8v10h-8z" fill="#fff0ba" />
          <path d="M17 19h8v26h-8zM71 19h8v26h-8z" fill="#172536" />
          <path d="M18 22h5v3h-5zM18 29h5v3h-5zM72 22h5v3h-5zM72 29h5v3h-5z" fill="#6e8b97" />
          <path d="M25 31h6M65 31h6" stroke="#a78f64" strokeWidth="2" />
        </>
      )}
      {room === 'agents' && (
        <>
          <path d="M14 17h20v30H14zM62 17h20v30H62z" fill="#111e31" />
          <path d="M16 19h16v8H16zM64 19h16v8H64z" fill="#b1b9bc" />
          <path d="M16 28h16v16H16z" fill="#547ba4" />
          <path d="M64 28h16v16H64z" fill="#657c9e" />
          <path d="M18 30h12v2H18zM66 30h12v2H66z" fill="#7ba8c2" />
          <path d="M41 16h14v10H41z" fill="#152330" />
          <path d="M43 18h10v5H43z" fill="#83c8bd" />
          <path d="M42 29h12v4H42z" fill="#765f55" />
        </>
      )}
      {room === 'mcp' && (
        <>
          <path d="M15 17h16v31H15zM65 17h16v31H65z" fill="#111d30" />
          <path
            d="M17 19h12v5H17zM17 27h12v5H17zM17 35h12v5H17zM67 19h12v5H67zM67 27h12v5H67zM67 35h12v5H67z"
            fill="#49637e"
          />
          <path d="M19 20h2v2h-2zM19 28h2v2h-2zM69 20h2v2h-2zM69 36h2v2h-2z" fill="#9dc9c1" />
          <path d="M38 19h20v3h4v16h-4v3H38v-3h-4V22h4z" fill="#0e1b2b" />
          <path d="M39 22h18v14H39z" fill="#41616e" />
          <path d="M41 24h4v3h-4zM45 27h5v3h-5zM50 30h5v3h-5z" fill="#a1d6be" />
          <path d="M45 41h6v4h7v3H38v-3h7z" fill="#8797a2" />
        </>
      )}
      {room === 'settings' && (
        <>
          <path d="M17 18h62v25H17z" fill="#111d30" />
          <path d="M19 20h58v17H19z" fill="#44536e" />
          <path d="M23 24h14v9H23zM41 24h14v9H41zM59 24h14v9H59z" fill="#142938" />
          <path d="M25 29h3v2h-3zM29 26h5v2h-5zM44 26h8v2h-8zM62 26h8v2h-8z" fill="#ab9bc5" />
          <path d="M19 39h58v6H19z" fill="#65718a" />
          <path d="M23 40h17v2H23zM55 40h18v2H55z" fill="#c2af8e" />
          <path d="M44 46h9v6h-9z" fill="#83687e" />
        </>
      )}
      {room === 'devices' && (
        <>
          <path d="M15 19h28v26H15z" fill="#111e2c" />
          <path d="M17 21h24v18H17z" fill="#395e62" />
          <path d="M23 25h12v10H23z" fill="#7a9d8a" />
          <path d="M26 27h6v6h-6z" fill="#263c47" />
          <path d="M20 41h18v3H20z" fill="#97aaa6" />
          <path d="M55 19h22v16H55zM59 38h22v12H59z" fill="#785f4b" />
          <path d="M57 21h18v11H57zM61 40h18v7H61z" fill="#aa8c68" />
          <path d="M64 21h4v11h-4zM68 40h4v7h-4z" fill="#c6ae85" />
          <path d="M45 22h5v23h6" stroke="#798799" strokeWidth="2" fill="none" />
        </>
      )}
      {room === 'bridge' && (
        <>
          <path d="M16 16h64v18H16z" fill="#0c182b" />
          <path d="M19 18h16v12H19zM39 18h18v12H39zM61 18h16v12H61z" fill="#42687b" />
          <path d="M21 20h12v2H21zM41 20h14v2H41zM63 20h12v2H63z" fill="#7ba5b1" />
          <path d="M18 35h60v10H18z" fill="#77898b" />
          <path d="M22 37h13v5H22zM40 37h16v5H40zM61 37h13v5H61z" fill="#16313e" />
          <path d="M24 38h8v2h-8zM42 38h11v2H42zM63 38h8v2h-8z" fill="#a1d6be" />
          <path d="M42 46h12v7H42z" fill="#5d8287" />
        </>
      )}
      <g
        className="pixel-caretaker"
        transform={room === 'engineering' ? 'translate(67 44)' : 'translate(43 43)'}
      >
        <path d="M1 8h11v3H1z" fill="#102033" opacity=".6" />
        <path d="M3 0h6v2h2v6H9v3H7V8H5v3H3V8H1V2h2z" fill="#142331" />
        <path d="M3 1h6v2h1v4H2V3h1z" fill="#b7cbd1" />
        <path d="M4 2h5v3H4z" fill="#4c839b" />
        <path d="M5 2h3v1H5z" fill="#b3e1e3" />
        <path d="M3 7h2v3H3zM7 7h2v3H7z" fill="#819aa7" />
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
