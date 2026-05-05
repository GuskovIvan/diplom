import { describe, expect, it } from "vitest";
import { calculateMovePosition, POSITION_STEP } from "./positioning.js";

describe("calculateMovePosition", () => {
  it("places a task at the end of an empty column", () => {
    expect(calculateMovePosition({ items: [] })).toBe(POSITION_STEP);
  });

  it("places a task after the last task by default", () => {
    expect(
      calculateMovePosition({
        items: [
          { id: "a", position: 1000 },
          { id: "b", position: 2000 }
        ]
      })
    ).toBe(3000);
  });

  it("places a task before another task without reindexing the whole column", () => {
    expect(
      calculateMovePosition({
        items: [
          { id: "a", position: 1000 },
          { id: "b", position: 2000 }
        ],
        beforeTaskId: "b"
      })
    ).toBe(1500);
  });

  it("ignores the moving task when calculating the new position", () => {
    expect(
      calculateMovePosition({
        items: [
          { id: "a", position: 1000 },
          { id: "b", position: 2000 },
          { id: "c", position: 3000 }
        ],
        movingId: "b",
        beforeTaskId: "c"
      })
    ).toBe(2000);
  });
});
