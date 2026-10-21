import type { Db } from "@landwar/db/client";
import { friendships, users } from "@landwar/db/schema";
import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { isUniqueViolation } from "../dbErrors";

export interface FriendEntry {
  publicId: string;
  username: string;
  createdAt: string;
}

export type SendResult =
  | { status: "requested" | "accepted" }
  | { error: "not_found" | "conflict" | "bad_request" };

async function userByPublicId(db: Db, publicId: string) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.publicId, publicId))
    .limit(1);
  return rows[0] ?? null;
}

function pair(a: string, b: string) {
  return or(
    and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
    and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)),
  );
}

// A request to someone who already asked you is an acceptance.
export async function sendRequest(
  db: Db,
  me: string,
  publicId: string,
): Promise<SendResult> {
  const other = await userByPublicId(db, publicId);
  if (other === null) return { error: "not_found" };
  if (other.id === me) return { error: "bad_request" };
  try {
    return await sendInTransaction(db, me, other.id);
  } catch (error) {
    // Two requests crossed: the pair index kept only the first.
    if (isUniqueViolation(error)) return { error: "conflict" };
    throw error;
  }
}

async function sendInTransaction(
  db: Db,
  me: string,
  otherId: string,
): Promise<SendResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(friendships)
      .where(pair(me, otherId))
      .for("update");
    const existing = rows[0];
    if (existing === undefined) {
      await tx
        .insert(friendships)
        .values({ requesterId: me, addresseeId: otherId, status: "pending" });
      return { status: "requested" } as const;
    }
    if (existing.status === "accepted" || existing.requesterId === me) {
      return { error: "conflict" } as const;
    }
    await tx
      .update(friendships)
      .set({ status: "accepted" })
      .where(pair(me, otherId));
    return { status: "accepted" } as const;
  });
}

// Accepts a request the other player sent to me. False when there is none.
export async function acceptRequest(
  db: Db,
  me: string,
  publicId: string,
): Promise<boolean> {
  const other = await userByPublicId(db, publicId);
  if (other === null) return false;
  const rows = await db
    .update(friendships)
    .set({ status: "accepted" })
    .where(
      and(
        eq(friendships.requesterId, other.id),
        eq(friendships.addresseeId, me),
        eq(friendships.status, "pending"),
      ),
    )
    .returning({ id: friendships.requesterId });
  return rows.length > 0;
}

// Cancels my outgoing request or declines an incoming one.
export async function deleteRequest(
  db: Db,
  me: string,
  publicId: string,
): Promise<boolean> {
  return deleteLink(db, me, publicId, "pending");
}

export async function removeFriend(
  db: Db,
  me: string,
  publicId: string,
): Promise<boolean> {
  return deleteLink(db, me, publicId, "accepted");
}

async function deleteLink(
  db: Db,
  me: string,
  publicId: string,
  status: "pending" | "accepted",
): Promise<boolean> {
  const other = await userByPublicId(db, publicId);
  if (other === null) return false;
  const rows = await db
    .delete(friendships)
    .where(and(pair(me, other.id), eq(friendships.status, status)))
    .returning({ id: friendships.requesterId });
  return rows.length > 0;
}

export async function listRequests(
  db: Db,
  me: string,
): Promise<{ incoming: FriendEntry[]; outgoing: FriendEntry[] }> {
  const incoming = await db
    .select({
      publicId: users.publicId,
      username: users.displayName,
      createdAt: friendships.createdAt,
    })
    .from(friendships)
    .innerJoin(users, eq(users.id, friendships.requesterId))
    .where(
      and(eq(friendships.addresseeId, me), eq(friendships.status, "pending")),
    )
    .orderBy(desc(friendships.createdAt));
  const outgoing = await db
    .select({
      publicId: users.publicId,
      username: users.displayName,
      createdAt: friendships.createdAt,
    })
    .from(friendships)
    .innerJoin(users, eq(users.id, friendships.addresseeId))
    .where(
      and(eq(friendships.requesterId, me), eq(friendships.status, "pending")),
    )
    .orderBy(desc(friendships.createdAt));
  const iso = (r: { publicId: string; username: string; createdAt: Date }) => ({
    publicId: r.publicId,
    username: r.username,
    createdAt: r.createdAt.toISOString(),
  });
  return { incoming: incoming.map(iso), outgoing: outgoing.map(iso) };
}

// Accepted friends, newest first. Pages start at 1.
export async function listFriends(
  db: Db,
  me: string,
  page: number,
  limit: number,
): Promise<{
  results: FriendEntry[];
  total: number;
  page: number;
  limit: number;
}> {
  const mine = and(
    eq(friendships.status, "accepted"),
    or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me)),
  );
  const [{ value: total } = { value: 0 }] = await db
    .select({ value: count() })
    .from(friendships)
    .where(mine);
  const rows = await db
    .select({
      publicId: users.publicId,
      username: users.displayName,
      createdAt: friendships.createdAt,
    })
    .from(friendships)
    .innerJoin(
      users,
      sql`${users.id} = case when ${friendships.requesterId} = ${me} then ${friendships.addresseeId} else ${friendships.requesterId} end`,
    )
    .where(mine)
    .orderBy(desc(friendships.createdAt), users.publicId)
    .limit(limit)
    .offset((page - 1) * limit);
  return {
    results: rows.map((r) => ({
      publicId: r.publicId,
      username: r.username,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    limit,
  };
}
