import { useEffect, useRef, useState } from "react";

/** Counts elapsed seconds, resetting whenever `resetKey` changes. */
export function useElapsedSeconds(resetKey: unknown): number {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setSeconds(0);
    const interval = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return seconds;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TimerBadge({ seconds, urgentAt }: { seconds: number; urgentAt?: number }) {
  const urgent = urgentAt !== undefined && seconds >= urgentAt;
  return <span className={`timer-badge${urgent ? " urgent" : ""}`}>{formatTime(seconds)}</span>;
}
