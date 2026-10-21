import { describe, expect, it } from "vitest";
import {
  canCreateLobby,
  canJoinLobby,
  canListLobby,
} from "../../src/server/LobbyRules";

const PUBLIC = { isPublic: true };
const PRIVATE = { isPublic: false };

describe("lobby rules", () => {
  it("lets only an account create a lobby", () => {
    expect(canCreateLobby("user")).toBe(true);
    expect(canCreateLobby("guest")).toBe(false);
  });

  it("lets a guest join a public lobby only", () => {
    expect(canJoinLobby("guest", PUBLIC)).toBe(true);
    expect(canJoinLobby("guest", PRIVATE)).toBe(false);
  });

  it("lets an account join a public or a private lobby", () => {
    expect(canJoinLobby("user", PUBLIC)).toBe(true);
    expect(canJoinLobby("user", PRIVATE)).toBe(true);
  });

  it("lets only an account list a lobby", () => {
    expect(canListLobby("user")).toBe(true);
    expect(canListLobby("guest")).toBe(false);
  });
});
