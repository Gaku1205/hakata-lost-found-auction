import { useEffect, useState } from 'react';

export const useNow = (intervalMs = 30_000): number => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return nowMs;
};

export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: T };

export const useLoadable = <T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): [Loadable<T>, () => void] => {
  const [value, setValue] = useState<Loadable<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setValue({ state: 'loading' });
    load()
      .then((data) => {
        if (!cancelled) setValue({ state: 'ready', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : '読み込みに失敗しました';
          setValue({ state: 'error', message });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const reload = (): void => setAttempt((n) => n + 1);
  return [value, reload];
};
