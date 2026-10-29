import { describe, expect, it } from "vitest";
import { createLimiter } from "./limiter";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createLimiter", () => {
  it("runs tasks in FIFO order", async () => {
    const run = createLimiter(1);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => run(async () => { order.push(n); })));
    expect(order).toEqual([1, 2, 3]);
  });

  it("never exceeds the concurrency limit", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = async () => {
      peak = Math.max(peak, ++active);
      await tick();
      active--;
    };
    await Promise.all(Array.from({ length: 5 }, () => run(task)));
    expect(peak).toBe(2);
  });

  it("keeps draining after an async rejection", async () => {
    const run = createLimiter(1);
    const bad = run(async () => { throw new Error("boom"); });
    await expect(bad).rejects.toThrow("boom");
    await expect(run(async () => "ok")).resolves.toBe("ok");
  });

  it("keeps draining after a synchronous throw", async () => {
    const run = createLimiter(1);
    const bad = run((() => { throw new Error("boom"); }) as () => Promise<void>);
    const next = run(async () => "ok");
    await expect(bad).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
