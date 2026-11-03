import { useState } from 'react';
import { PixelRoom, PixelHeading } from './PixelRoom.js';
import type { screens } from './App.js';

type Destination = (typeof screens)[number];
const rooms = [
  {
    id: 'engineering',
    name: 'Engineering bay',
    destination: 'Engineering',
    icon: 'engineering',
    number: '01',
    description: 'Validation, findings & job logs',
  },
  {
    id: 'agents',
    name: 'Crew quarters',
    destination: 'Agent Workspace',
    icon: 'agents',
    number: '02',
    description: 'Project memory & agent handoffs',
  },
  {
    id: 'mcp',
    name: 'Communications',
    destination: 'MCP Hub',
    icon: 'mcp',
    number: '03',
    description: 'MCP inventory & transport probes',
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
    id: 'devices',
    name: 'Device bay',
    destination: 'Devices',
    icon: 'devices',
    number: '05',
    description: 'Telemetry service unavailable',
  },
  {
    id: 'bridge',
    name: 'Bridge',
    destination: 'Overview',
    icon: 'overview',
    number: '06',
    description: 'Project overview & recorded activity',
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
  return (
    <section className="ship-workspace" aria-labelledby="ship-title">
      <div className="ship-heading">
        <div>
          <p className="eyebrow">UDI EXPLORER / DECK 01</p>
          <h2 id="ship-title">
            <span className="pixel-sr-only">Mission control</span>
            <PixelHeading />
          </h2>
          <p className="ship-subtitle">Your project. Your crew. One ship.</p>
        </div>
        <span className={`ship-engine ship-engine-${engine}`}>
          <span aria-hidden="true" />
          Engine {engine}
        </span>
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
              onFocus={() => setActive(room.name)}
              onBlur={() => setActive(undefined)}
              onClick={() => onNavigate(room.destination)}
            >
              <span className="ship-room-meta">
                <span>
                  {room.number} / {room.destination.toUpperCase()}
                </span>
                <span className="room-enter" aria-hidden="true">
                  ENTER ↗
                </span>
              </span>
              <PixelRoom room={room.id} />
              <strong>{room.name}</strong>
              <span className="ship-room-description">{room.description}</span>
              {room.id === 'engineering' && (
                <span className="ship-room-note">
                  {jobId ? 'Selected job available' : 'No validation job selected'}
                </span>
              )}
            </button>
          ))}
          <div className="ship-corridor" aria-hidden="true">
            <span />
            <span className="corridor-node" />
            <span>CONTEXT BUS</span>
            <span className="corridor-node" />
            <span />
          </div>
        </div>
      </nav>
      <div className="ship-legend">
        <span className="ship-prompt">
          <span aria-hidden="true">▸</span>{' '}
          {active ? `Enter ${active}` : 'Choose a compartment to begin'}
        </span>
        <span>CLICK / TAB + ENTER TO BOARD</span>
      </div>
    </section>
  );
}
