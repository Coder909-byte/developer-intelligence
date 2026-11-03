import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { PixelRoom, PixelHeading } from './PixelRoom.js';
import type { screens } from './App.js';

type Destination = (typeof screens)[number];
const rooms = [
  {
    id: 'agents',
    name: 'Crew quarters',
    destination: 'Agent Workspace',
    icon: 'agents',
    number: '01',
    description: 'Project memory & agent handoffs',
  },
  {
    id: 'mcp',
    name: 'Communications',
    destination: 'MCP Hub',
    icon: 'mcp',
    number: '02',
    description: 'MCP inventory, tools & host setup',
  },
  {
    id: 'settings',
    name: 'Control room',
    destination: 'Settings',
    icon: 'settings',
    number: '04',
    description: 'Daemon connection & preferences',
  },
  {
    id: 'bridge',
    name: 'Bridge',
    destination: 'Overview',
    icon: 'overview',
    number: '05',
    description: 'Project overview & recorded activity',
  },
  {
    id: 'library',
    name: 'Library',
    destination: 'Library',
    icon: 'agents',
    number: '03',
    description: 'Librarian & saved session information',
  },
  {
    id: 'inspector',
    name: 'Context Inspector',
    destination: 'Context Inspector',
    icon: 'engineering',
    number: '06',
    description:
      'Context analyst with a magnifying glass · Raw activity, classifications & compressed context',
  },
] as const;

export function ShipWorkspace({
  projectName,
  engine,
  jobId,
  onNavigate,
}: {
  projectName: string | undefined;
  engine: 'checking' | 'connected' | 'disconnected';
  jobId: string | undefined;
  onNavigate: (screen: Destination) => void;
}) {
  const [active, setActive] = useState<string>();
  const [motion, setMotion] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const frame = useRef<number | undefined>(undefined);
  const litRoom = useRef<HTMLButtonElement | undefined>(undefined);
  function resetLight() {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    litRoom.current?.removeAttribute('data-pointer-lit');
    litRoom.current = undefined;
  }
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => {
      resetLight();
      setMotion(!preference.matches);
    };
    preference.addEventListener('change', changed);
    return () => {
      preference.removeEventListener('change', changed);
      resetLight();
    };
  }, []);
  function illuminate(event: PointerEvent<HTMLButtonElement>) {
    if (
      !motion ||
      event.pointerType === 'touch' ||
      !window.matchMedia('(hover: hover) and (pointer: fine)').matches
    )
      return;
    const room = event.currentTarget;
    const bounds = room.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    if (litRoom.current && litRoom.current !== room) resetLight();
    litRoom.current = room;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      room.style.setProperty('--spot-x', `${x}px`);
      room.style.setProperty('--spot-y', `${y}px`);
      room.style.setProperty('--tilt-x', `${(0.5 - y / bounds.height) * 5}deg`);
      room.style.setProperty('--tilt-y', `${(x / bounds.width - 0.5) * 5}deg`);
      room.setAttribute('data-pointer-lit', 'true');
      frame.current = undefined;
    });
  }
  return (
    <section
      className={`ship-workspace ship-floorplan ${motion ? 'ship-motion-on' : 'ship-motion-paused'}`}
      aria-labelledby="ship-title"
    >
      <div className="ship-heading">
        <div>
          <p className="eyebrow">UDI EXPLORER / DECK 01</p>
          <h2 id="ship-title">
            <span className="pixel-sr-only">Mission control</span>
            <PixelHeading />
          </h2>
          <p className="ship-subtitle">Integration deck / Shared intelligence / Specialist tools</p>
        </div>
        <div className="ship-controls">
          <button
            type="button"
            className="button quiet ship-motion-toggle"
            aria-pressed={!motion}
            onClick={() => {
              resetLight();
              setMotion((value) => !value);
            }}
          >
            {motion ? 'Pause motion' : 'Resume motion'}
          </button>
          <span className={`ship-engine ship-engine-${engine}`}>
            <span aria-hidden="true" />
            Engine {engine}
          </span>
        </div>
      </div>
      <div className="ship-manifest">
        <span>MISSION</span>
        <strong>{projectName ?? 'Select a project to load shared context'}</strong>
        <span>LOCAL SYSTEM / NO CLOUD REQUIRED</span>
      </div>
      <nav className="ship-chart" aria-label="Ship compartments">
        <div className="ship-hull" aria-hidden="true" />
        <div className="ship-thrusters" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span className="ship-orientation" aria-hidden="true">
          AFT <span>PIXEL DECK / TOP VIEW</span> FORWARD →
        </span>
        <div className="ship-deck">
          {rooms.map((room) => (
            <button
              key={room.id}
              className={`ship-room ship-room-${room.id}`}
              aria-label={`Open ${room.name}`}
              onMouseEnter={() => setActive(room.name)}
              onMouseLeave={() => setActive(undefined)}
              onPointerMove={illuminate}
              onPointerLeave={resetLight}
              onPointerCancel={resetLight}
              onFocus={() => setActive(room.name)}
              onBlur={() => {
                setActive(undefined);
                resetLight();
              }}
              onClick={() => onNavigate(room.destination)}
            >
              <span className="ship-room-meta">
                <span>{room.number}</span>
                <span className="room-enter" aria-hidden="true">
                  ENTER ↗
                </span>
              </span>
              <span className="room-cursor-light" aria-hidden="true" />
              <span className="room-art-depth">
                <PixelRoom
                  room={room.id}
                  door={['settings', 'bridge', 'inspector'].includes(room.id) ? 'top' : 'bottom'}
                />
              </span>
              <strong className="room-floor-sign">
                {room.id === 'mcp'
                  ? 'MCP Hub'
                  : room.id === 'agents'
                    ? 'Shared intelligence'
                    : room.name}
              </strong>
              <span className="pixel-sr-only">{room.description}</span>
            </button>
          ))}
          <div className="ship-corridor" aria-hidden="true">
            <span />
            <span className="corridor-node" />
            <span>MAIN PASSAGE / CONTEXT BUS</span>
            <span className="corridor-node" />
            <span />
          </div>
        </div>
      </nav>
      <div className="floorplan-readout">
        <span>INTEGRATION DECK</span>
        <span>MCP aggregation / Cross-agent memory / Engineering tools</span>
        <details>
          <summary>Engineering scope</summary>
          {jobId ? 'Selected job available' : 'No validation job selected'}
        </details>
        <span className="floorplan-pan-hint">Scroll deck to explore all rooms</span>
      </div>
      <div className="ship-legend">
        <span className="ship-prompt">
          <span aria-hidden="true">▸</span> {active ? `Enter ${active}` : 'Choose a room to enter'}
        </span>
        <span>DECORATIVE CREW / LIVE PROJECT DATA</span>
      </div>
    </section>
  );
}
