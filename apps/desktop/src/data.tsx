import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { Skeleton, EmptyState, Button } from '@udi/ui';
import { Resource } from './resource.js';
export const ConnectionReporter = createContext<(reachable: boolean) => void>(() => {});
export function useResource<T>(loader: () => Promise<T>, dependencies: readonly unknown[]) {
  const report = useContext(ConnectionReporter);
  // The caller supplies the identity of the SDK/project; new identities get isolated resource instances.
  const resource = useMemo(() => new Resource<T>(), dependencies);
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  useEffect(() => {
    void resource.load(loader);
    return () => resource.cancel();
  }, [resource]);
  useEffect(() => {
    if (state.status === 'ready') report(true);
    else if (
      state.status === 'error' &&
      (state.code === 'CONNECTION_ERROR' || state.code === 'TIMEOUT')
    )
      report(false);
  }, [state, report]);
  return {
    state,
    retry: () => {
      void resource.load(loader);
    },
  };
}
export function Result<T>({
  value,
  children,
}: {
  value: ReturnType<typeof useResource<T>>;
  children: (data: T) => ReactNode;
}) {
  if (value.state.status === 'loading') return <Skeleton />;
  if (value.state.status === 'error')
    return (
      <EmptyState title={value.state.title}>
        <p>{value.state.message}</p>
        <Button onClick={value.retry}>Retry</Button>
      </EmptyState>
    );
  return <>{children(value.state.data)}</>;
}
