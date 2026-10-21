// Who may create and join lobbies. Pure functions, so the worker and the
// tests use the same rules.

// Only an account may create a lobby. A guest may not.
export function canCreateLobby(kind: "user" | "guest"): boolean {
  return kind === "user";
}

// A guest may join a public lobby. A private lobby needs an account.
export function canJoinLobby(
  kind: "user" | "guest",
  lobby: { isPublic: boolean },
): boolean {
  return kind === "user" || lobby.isPublic;
}

// Only an account may list a lobby for other players to find.
export function canListLobby(kind: "user" | "guest"): boolean {
  return kind === "user";
}
