export function formatKm(km: number | undefined): string {
  if (km === undefined || Number.isNaN(km)) {
    return "—";
  }
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function formatMinutes(minutes: number | undefined): string {
  if (minutes === undefined || Number.isNaN(minutes)) {
    return "—";
  }
  if (minutes < 1) {
    return `${Math.round(minutes * 60)} s`;
  }
  if (minutes < 60) {
    return `${minutes.toFixed(1)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return `${hours} h ${remainder} min`;
}

export function formatPercent(value: number | undefined, digits = 1): string {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
}

export function formatScore(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(1);
}

export function formatSignedMinutes(minutes: number | undefined): string {
  if (minutes === undefined || Number.isNaN(minutes)) {
    return "—";
  }
  const sign = minutes > 0 ? "+" : "";
  return `${sign}${minutes.toFixed(1)} min`;
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) {
    return "—";
  }
  return ms < 1 ? "<1 ms" : `${ms.toFixed(1)} ms`;
}

export function formatCoordinate(value: number): string {
  return value.toFixed(5);
}

/** Shortens an H3 index for display without losing its recognisable head/tail. */
export function shortCell(cell: string | undefined): string {
  if (!cell) {
    return "—";
  }
  return cell.length <= 12 ? cell : `${cell.slice(0, 7)}…${cell.slice(-4)}`;
}
