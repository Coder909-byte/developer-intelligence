import { DaemonClientError } from '@udi/client-sdk';
import type { ApiError } from '@udi/contracts';
export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; title: string; message: string; code?: ApiError['code'] };
export function describeError(error: unknown): { title: string; message: string } {
  if (error instanceof DaemonClientError) {
    switch (error.code) {
      case 'NOT_IMPLEMENTED':
        return {
          title: 'Not available from this daemon',
          message: 'The shared API is reserved but its service is not implemented yet.',
        };
      case 'UNAUTHORIZED':
        return {
          title: 'Authentication required',
          message: 'Enter the local daemon token in Settings, then retry.',
        };
      case 'FORBIDDEN':
        return {
          title: 'Access denied',
          message: 'Check daemon origin and workspace permissions.',
        };
      case 'VALIDATION_ERROR':
        return {
          title: 'Invalid request',
          message:
            'Check the required fields and referenced project records. No write was retried automatically.',
        };
      case 'NOT_FOUND':
        return {
          title: 'Record no longer available',
          message: 'Refresh the project and check the selected record.',
        };
      case 'CONFLICT':
        return {
          title: 'Conflicting record',
          message: 'Reload stored state before retrying. Writes are not retried automatically.',
        };
      case 'CONNECTION_ERROR':
      case 'TIMEOUT':
        return {
          title: 'Daemon disconnected',
          message: 'Start the local daemon and check the connection settings.',
        };
      default:
        return {
          title: 'Request failed',
          message: `Daemon returned ${error.code}. Retry or check the daemon logs.`,
        };
    }
  }
  return {
    title: 'Unable to complete request',
    message: 'Check your input and connection, then retry.',
  };
}
// SDK currently owns request timeouts; generation guards prevent obsolete responses from publishing.
export class Resource<T> {
  private state: ResourceState<T> = { status: 'loading' };
  private listeners = new Set<() => void>();
  private generation = 0;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: ResourceState<T>) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async load(loader: () => Promise<T>) {
    const generation = ++this.generation;
    this.publish({ status: 'loading' });
    try {
      const data = await loader();
      if (generation === this.generation) this.publish({ status: 'ready', data });
    } catch (error) {
      if (generation === this.generation)
        this.publish({
          status: 'error',
          ...describeError(error),
          ...(error instanceof DaemonClientError ? { code: error.code } : {}),
        });
    }
  }
  cancel() {
    this.generation++;
  }
}
