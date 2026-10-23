import { describe, expect, it } from "vitest";
import {
  MAX_MOVE_WARSHIP_UNITS,
  MAX_UNIT_ID,
} from "@openfront/engine-api/Schemas";
import {
  ClientMessageSchema,
  type ClientMessage,
} from "@openfront/shared/WireSchemas";
import {
  ClientMsgRateLimiter,
  MAX_INTENT_SIZE,
} from "../../src/server/ClientMsgRateLimiter";
import { clientFrame } from "../util/Wire";

const CLIENT_A = "clientA" as any;
const CLIENT_B = "clientB" as any;

const SMALL = 100;

describe("ClientMsgRateLimiter", () => {
  describe("intent messages", () => {
    it("allows intents within limits", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("ok");
    });

    it("limits when per-second count exceeded", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 10; i++) {
        expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("ok");
      }
      expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("limit");
    });

    it("rate limits are per client", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 10; i++) {
        limiter.check(CLIENT_A, "intent", SMALL);
      }
      expect(limiter.check(CLIENT_B, "intent", SMALL)).toBe("ok");
    });

    it("allows intents up to MAX_INTENT_SIZE", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", MAX_INTENT_SIZE)).toBe("ok");
    });

    it("kicks intents exceeding MAX_INTENT_SIZE", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", MAX_INTENT_SIZE + 1)).toBe(
        "kick",
      );
    });

    it("still kicks an oversized junk intent", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", 100_000)).toBe("kick");
    });
  });

  describe("large fleet moves (upstream issue 4718)", () => {
    const moveFrame = (ids: number[]) =>
      clientFrame({
        type: "intent",
        intent: { type: "move_warship", unitIds: ids, tile: 123456 },
      } as ClientMessage);

    it("accepts an 800 ship move, over the old 2000 byte limit", () => {
      const ids = Array.from({ length: 800 }, (_, i) => 100_000 + i);
      const frame = moveFrame(ids);
      expect(frame.length).toBeGreaterThan(2000);
      expect(
        ClientMessageSchema.safeParse({
          type: "intent",
          intent: { type: "move_warship", unitIds: ids, tile: 1 },
        }).success,
      ).toBe(true);
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", frame.length)).toBe("ok");
    });

    it("accepts the largest legal move, with worst-case unit ids", () => {
      const ids = Array.from(
        { length: MAX_MOVE_WARSHIP_UNITS },
        (_, i) => MAX_UNIT_ID - i,
      );
      const frame = moveFrame(ids);
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", frame.length)).toBe("ok");
    });

    it("rejects a move with more unit ids than the schema allows", () => {
      const ids = Array.from(
        { length: MAX_MOVE_WARSHIP_UNITS + 1 },
        (_, i) => i,
      );
      const result = ClientMessageSchema.safeParse({
        type: "intent",
        intent: { type: "move_warship", unitIds: ids, tile: 1 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("non-intent messages", () => {
    it("does not rate-limit non-intent messages", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 20; i++) {
        expect(limiter.check(CLIENT_A, "winner", 50)).toBe("ok");
      }
    });

    it("does not rate-limit ping messages", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 20; i++) {
        expect(limiter.check(CLIENT_A, "ping", 50)).toBe("ok");
      }
    });
  });

  describe("rejoin messages", () => {
    it("allows a few rejoins then limits", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 5; i++) {
        expect(limiter.check(CLIENT_A, "rejoin", SMALL)).toBe("ok");
      }
      expect(limiter.check(CLIENT_A, "rejoin", SMALL)).toBe("limit");
    });

    it("rejoin limit is per client and independent of intents", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 5; i++) {
        limiter.check(CLIENT_A, "rejoin", SMALL);
      }
      expect(limiter.check(CLIENT_A, "rejoin", SMALL)).toBe("limit");
      expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("ok");
      expect(limiter.check(CLIENT_B, "rejoin", SMALL)).toBe("ok");
    });
  });

  describe("total bytes limit", () => {
    it("kicks when cumulative bytes reach 5MB", () => {
      const limiter = new ClientMsgRateLimiter();
      const chunkSize = 1024 * 1024; // 1MB
      // Send 4 chunks = 4MB, should be ok
      for (let i = 0; i < 4; i++) {
        expect(limiter.check(CLIENT_A, "other", chunkSize)).toBe("ok");
      }
      // 5th chunk pushes to 5MB, should kick
      expect(limiter.check(CLIENT_A, "other", chunkSize)).toBe("kick");
    });

    it("byte tracking is per client", () => {
      const limiter = new ClientMsgRateLimiter();
      const almostFull = 5 * 1024 * 1024 - 1;
      expect(limiter.check(CLIENT_A, "other", almostFull)).toBe("ok");
      // CLIENT_B should still be fine
      expect(limiter.check(CLIENT_B, "other", 100)).toBe("ok");
    });

    it("kicks on bytes regardless of message type", () => {
      const limiter = new ClientMsgRateLimiter();
      const twoMB = 2 * 1024 * 1024;
      expect(limiter.check(CLIENT_A, "intent", twoMB)).toBe("kick");
    });
  });
});
