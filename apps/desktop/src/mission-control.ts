import type { ComponentProps } from 'react';
import type { DaemonClient } from '@udi/client-sdk';
import type { ContextCompressionInspector } from './ContextCompressionInspector.js';
import type { CategoricalToolHub } from './CategoricalToolHub.js';

// Presentation inputs, not HTTP contracts. Map the approved SDK responses here
// when the backend owner publishes them. Never fetch guessed endpoints from UI.
export interface MissionControlSource {
  inspect(
    projectId: string,
  ): Promise<ComponentProps<typeof ContextCompressionInspector>['inspection']>;
  tools(projectId: string): Promise<ComponentProps<typeof CategoricalToolHub>['snapshot']>;
  toggle(projectId: string, category: string, enabled: boolean): Promise<void>;
}

export type MissionControlFactory = (client: DaemonClient) => MissionControlSource;
