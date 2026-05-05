export const POSITION_STEP = 1000;

type PositionedItem = {
  id: string;
  position: unknown;
};

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }

  return Number(value);
}

export function calculateMovePosition(params: {
  items: PositionedItem[];
  movingId?: string;
  beforeTaskId?: string | null;
  afterTaskId?: string | null;
}) {
  const ordered = params.items
    .filter((item) => item.id !== params.movingId)
    .map((item) => ({
      id: item.id,
      position: toNumber(item.position)
    }))
    .sort((a, b) => a.position - b.position);

  if (params.beforeTaskId) {
    const nextIndex = ordered.findIndex((item) => item.id === params.beforeTaskId);
    if (nextIndex >= 0) {
      const next = ordered[nextIndex];
      const previous = ordered[nextIndex - 1];
      return previous ? (previous.position + next.position) / 2 : next.position / 2;
    }
  }

  if (params.afterTaskId) {
    const previousIndex = ordered.findIndex((item) => item.id === params.afterTaskId);
    if (previousIndex >= 0) {
      const previous = ordered[previousIndex];
      const next = ordered[previousIndex + 1];
      return next ? (previous.position + next.position) / 2 : previous.position + POSITION_STEP;
    }
  }

  const last = ordered.at(-1);
  return last ? last.position + POSITION_STEP : POSITION_STEP;
}
