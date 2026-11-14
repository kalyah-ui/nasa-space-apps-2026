"use client";

import { useEffect, useRef, useState } from "react";

export type SourceState<T> = { status: "loading" | "ready" | "error"; data?: T; error?: string };

/**
 * Loads one weather dataset with per-source status and retry.
 * The provider's cache makes repeat loads instant.
 */
export function useWeatherData<T>(
  cacheKey: string,
  load: () => Promise<T>,
): [SourceState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SourceState<T>>({ status: "loading" });
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    loadRef.current().then(
      (data) => {
        if (active) {
          setState({ status: "ready", data });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({
            status: "error",
            error: error instanceof Error ? error.message : "Unexpected error.",
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [cacheKey, attempt]);

  return [state, () => setAttempt((count) => count + 1)];
}

export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function SourceErrorRow({
  sourceLabel,
  message,
  onRetry,
}: {
  sourceLabel: string;
  message?: string;
  onRetry: () => void;
}) {
  return (
    <p className="source-error" role="alert">
      <span>
        {sourceLabel} data unavailable{message ? ` (${message})` : ""}.
      </span>
      <button className="source-error-retry" onClick={onRetry} type="button">
        Retry
      </button>
    </p>
  );
}
