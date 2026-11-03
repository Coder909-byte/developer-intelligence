import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createDefaultMissionControl } from './mission-control.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <App missionControl={createDefaultMissionControl} />,
);
