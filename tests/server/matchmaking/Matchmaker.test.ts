import { describe, expect, it, vi } from "vitest";
import type { Match, QueueMode } from "../../../src/server/matchmaking/matcher";
import {
  type Identity,
  Matchmaker,
  type QueueSocket,
} from "../../../src/server/matchmaking/Matchmaker";

class FakeSocket implements QueueSocket {
  sent: unknown[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private handlers: Record<string, ((arg?: any) => void)[]> = {};
  send(data: string) {
    if (this.closed) throw new Error("closed");
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.emit("close");
  }
  on(event: string, cb: (arg?: any) => void) {
    (this.handlers[event] ??= []).push(cb);
    return this;
  }
  emit(event: string, arg?: unknown) {
    for (const cb of this.handlers[event] ?? []) cb(arg);
  }
  say(obj: unknown) {
    this.emit("message", { toString: () => JSON.stringify(obj) });
  }
  ofType(type: string) {
    return this.sent.filter((m: any) => m.type === type) as any[];
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(
  elos: Record<string, number> = {},
  createGame: (
    mode: QueueMode,
    match: Match,
  ) => Promise<string | null> = async () => "game0001",
) {
  let clock = 0;
  const accounts: Record<string, Identity> = {
    "jwt-a": { userId: "a", publicId: "pa" },
    "jwt-b": { userId: "b", publicId: "pb" },
    "jwt-c": { userId: "c", publicId: "pc" },
    "jwt-d": { userId: "d", publicId: "pd" },
  };
  const created: { mode: QueueMode; match: Match }[] = [];
  const mm = new Matchmaker({
    identify: async (jwt) => accounts[jwt] ?? null,
    rating: async (id) => elos[id] ?? 1000,
    createGame: async (mode, match) => {
      created.push({ mode, match });
      return createGame(mode, match);
    },
    now: () => clock,
  });
  const join = async (jwt: string, mode: QueueMode = "1v1") => {
    const s = new FakeSocket();
    mm.connect(s, mode);
    s.say({ type: "join", jwt });
    await flush();
    return s;
  };
  return {
    mm,
    join,
    created,
    advance: (ms: number) => (clock += ms),
  };
}

describe("Matchmaker", () => {
  it("queues a player who sends a valid join and tells them the queue size", async () => {
    const { mm, join } = setup();
    const a = await join("jwt-a");
    expect(mm.size("1v1")).toBe(1);
    expect(a.ofType("queue-size")).toEqual([{ type: "queue-size", count: 1 }]);
  });

  it("refuses a bad token with Unauthorized", async () => {
    const { mm, join } = setup();
    const s = await join("nope");
    expect(s.closed).toEqual({ code: 4001, reason: "Invalid session" });
    expect(mm.size()).toBe(0);
  });

  it("refuses a message that is not a join", async () => {
    const { mm } = setup();
    const s = new FakeSocket();
    mm.connect(s, "1v1");
    s.say({ type: "hello" });
    await flush();
    expect(s.closed?.code).toBe(4000);
    const t = new FakeSocket();
    mm.connect(t, "1v1");
    t.emit("message", { toString: () => "not json" });
    expect(t.closed?.code).toBe(4000);
  });

  it("matches two players and sends both the assignment", async () => {
    const { mm, join, created } = setup();
    const a = await join("jwt-a");
    const b = await join("jwt-b");
    await mm.tick();
    expect(created).toHaveLength(1);
    expect(created[0]!.mode).toBe("1v1");
    for (const s of [a, b]) {
      expect(s.ofType("match-assignment")).toEqual([
        { type: "match-assignment", gameId: "game0001" },
      ]);
    }
    expect(mm.size()).toBe(0);
  });

  it("keeps far-apart players waiting until their window grows", async () => {
    const { mm, join, created, advance } = setup({ a: 1000, b: 1500 });
    await join("jwt-a");
    await join("jwt-b");
    await mm.tick();
    expect(created).toHaveLength(0);
    advance(40_000);
    await mm.tick();
    expect(created).toHaveLength(1);
  });

  it("gives an account one slot: a newer connection replaces the older", async () => {
    const { mm, join } = setup();
    const first = await join("jwt-a");
    const second = await join("jwt-a");
    expect(first.closed).toEqual({
      code: 1000,
      reason: "Replaced by newer connection",
    });
    expect(second.closed).toBeNull();
    expect(mm.size()).toBe(1);
    // The replaced socket's close does not remove the new slot.
    expect(mm.size("1v1")).toBe(1);
  });

  it("removes a player who disconnects", async () => {
    const { mm, join } = setup();
    const a = await join("jwt-a");
    a.close();
    expect(mm.size()).toBe(0);
  });

  it("does not match a player who left before the tick", async () => {
    const { mm, join, created } = setup();
    const a = await join("jwt-a");
    await join("jwt-b");
    a.close();
    await mm.tick();
    expect(created).toHaveLength(0);
    expect(mm.size()).toBe(1);
  });

  it("keeps the players queued when the game could not be made", async () => {
    const { mm, join } = setup({}, async () => null);
    const a = await join("jwt-a");
    await join("jwt-b");
    await mm.tick();
    expect(a.ofType("match-assignment")).toEqual([]);
    expect(mm.size()).toBe(2);
  });

  it("does not match the same players twice while a game is being made", async () => {
    let release: (id: string) => void = () => {};
    const slow = new Promise<string>((r) => (release = r));
    const { mm, join, created } = setup({}, () => slow);
    await join("jwt-a");
    await join("jwt-b");
    const first = mm.tick();
    await flush();
    await mm.tick();
    expect(created).toHaveLength(1);
    release("game0002");
    await first;
  });

  it("broadcasts the queue size every few seconds", async () => {
    const { mm, join, advance } = setup({ a: 1000, b: 2500 });
    const a = await join("jwt-a");
    await join("jwt-b");
    await mm.tick();
    const before = a.ofType("queue-size").length;
    advance(1000);
    await mm.tick();
    expect(a.ofType("queue-size").length).toBe(before);
    advance(3000);
    await mm.tick();
    expect(a.ofType("queue-size").length).toBe(before + 1);
    expect(a.ofType("queue-size")[a.ofType("queue-size").length - 1]).toEqual({
      type: "queue-size",
      count: 2,
    });
  });

  it("survives a socket that throws on send", async () => {
    const { mm, join } = setup();
    const a = await join("jwt-a");
    a.send = () => {
      throw new Error("dead");
    };
    await join("jwt-b");
    const spy = vi.fn();
    await expect(mm.tick().then(spy)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });

  it("closes with InternalError when the rating lookup fails", async () => {
    const mm = new Matchmaker({
      identify: async () => ({ userId: "a", publicId: "pa" }),
      rating: async () => {
        throw new Error("db down");
      },
      createGame: async () => null,
      now: () => 0,
    });
    const s = new FakeSocket();
    mm.connect(s, "1v1");
    s.say({ type: "join", jwt: "x" });
    await flush();
    expect(s.closed?.code).toBe(1011);
  });
});
