import { CloseCode } from "@openfront/shared/CloseCodes";
import { z } from "zod";
import {
  findMatches,
  type Match,
  type QueueMode,
  type Ticket,
} from "./matcher";

// The ranked queues. A client connects to /matchmaking/join?mode=1v1,
// sends {type:"join", jwt}, and waits. The server sends {type:"queue-size"}
// every few seconds and, once matched, {type:"match-assignment", gameId}.
// Close codes follow the client's contract: a rejection is terminal, a newer
// connection for the account closes the old one with Normal, and a server
// fault closes with InternalError so the client retries.

export interface QueueSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", cb: (data: { toString(): string }) => void): unknown;
  on(event: "close", cb: () => void): unknown;
  on(event: "error", cb: () => void): unknown;
}

export interface Identity {
  userId: string;
  publicId: string;
}

export interface MatchmakerDeps {
  // The account behind a join token, or null for a guest or a bad token.
  identify(jwt: string): Promise<Identity | null>;
  rating(userId: string, mode: QueueMode): Promise<number>;
  // Makes the game for a match and returns its id, or null on failure.
  createGame(mode: QueueMode, match: Match): Promise<string | null>;
  now(): number;
}

const JoinSchema = z.object({
  type: z.literal("join"),
  jwt: z.string().min(1),
});

interface Entry {
  ticket: Ticket;
  mode: QueueMode;
  socket: QueueSocket;
}

export const QUEUE_SIZE_INTERVAL_MS = 3000;

export class Matchmaker {
  private readonly entries = new Map<string, Entry>();
  // A match being made holds its players, so they are not matched twice while
  // the game is created.
  private readonly pending = new Set<string>();
  private lastBroadcast = 0;

  constructor(private readonly deps: MatchmakerDeps) {}

  size(mode?: QueueMode): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (mode === undefined || e.mode === mode) n++;
    }
    return n;
  }

  // A new socket. It joins the queue when it sends a valid join message.
  connect(socket: QueueSocket, mode: QueueMode): void {
    let joined: Entry | null = null;
    let joining = false;

    socket.on("message", (raw) => {
      if (joined !== null || joining) return;
      let parsed: z.ZodSafeParseResult<z.infer<typeof JoinSchema>>;
      try {
        parsed = JoinSchema.safeParse(JSON.parse(raw.toString()));
      } catch {
        socket.close(CloseCode.BadRequest, "Invalid message");
        return;
      }
      if (!parsed.success) {
        socket.close(CloseCode.BadRequest, "Invalid message");
        return;
      }
      joining = true;
      void this.enqueue(socket, mode, parsed.data.jwt).then((entry) => {
        joined = entry;
        joining = false;
      });
    });
    const leave = () => {
      if (joined !== null) this.drop(joined);
    };
    socket.on("close", leave);
    socket.on("error", leave);
  }

  private async enqueue(
    socket: QueueSocket,
    mode: QueueMode,
    jwt: string,
  ): Promise<Entry | null> {
    let identity: Identity | null;
    let elo: number;
    try {
      identity = await this.deps.identify(jwt);
      if (identity === null) {
        socket.close(CloseCode.Unauthorized, "Invalid session");
        return null;
      }
      elo = await this.deps.rating(identity.userId, mode);
    } catch {
      socket.close(CloseCode.InternalError, "Matchmaking unavailable");
      return null;
    }
    // One account holds one queue slot, in any mode.
    const old = this.entries.get(identity.userId);
    if (old !== undefined) {
      this.entries.delete(identity.userId);
      old.socket.close(CloseCode.Normal, "Replaced by newer connection");
    }
    const entry: Entry = {
      mode,
      socket,
      ticket: {
        userId: identity.userId,
        publicId: identity.publicId,
        elo,
        joinedAt: this.deps.now(),
      },
    };
    this.entries.set(identity.userId, entry);
    this.sendSize(entry);
    return entry;
  }

  private drop(entry: Entry): void {
    // A replaced entry no longer owns the slot.
    if (this.entries.get(entry.ticket.userId) === entry) {
      this.entries.delete(entry.ticket.userId);
    }
  }

  private sizeMessage(mode: QueueMode): string {
    return JSON.stringify({ type: "queue-size", count: this.size(mode) });
  }

  private sendSize(entry: Entry): void {
    try {
      entry.socket.send(this.sizeMessage(entry.mode));
    } catch {
      this.drop(entry);
    }
  }

  // One pass: make every match the queues allow, then (every few seconds) tell
  // everyone how many are waiting. Call it about once a second.
  async tick(): Promise<void> {
    const now = this.deps.now();
    for (const mode of ["1v1"] as const) {
      const waiting = [...this.entries.values()]
        .filter((e) => e.mode === mode && !this.pending.has(e.ticket.userId))
        .map((e) => e.ticket);
      for (const match of findMatches(waiting, mode, now)) {
        await this.assign(mode, match);
      }
    }
    if (now - this.lastBroadcast >= QUEUE_SIZE_INTERVAL_MS) {
      this.lastBroadcast = now;
      for (const entry of this.entries.values()) this.sendSize(entry);
    }
  }

  private async assign(mode: QueueMode, match: Match): Promise<void> {
    const ids = match.players.map((p) => p.userId);
    for (const id of ids) this.pending.add(id);
    try {
      const gameId = await this.deps.createGame(mode, match);
      if (gameId === null) return;
      const message = JSON.stringify({ type: "match-assignment", gameId });
      for (const id of ids) {
        const entry = this.entries.get(id);
        if (entry === undefined) continue;
        // Matched players leave the queue. A player who closed while the game
        // was being made simply never receives the assignment.
        this.entries.delete(id);
        try {
          entry.socket.send(message);
        } catch {
          // The client's own close handling covers a dead socket.
        }
      }
    } finally {
      for (const id of ids) this.pending.delete(id);
    }
  }
}
