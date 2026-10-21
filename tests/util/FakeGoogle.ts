import { createHash, randomUUID } from "crypto";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";

export interface FakeProfile {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

// A stand-in for Google's OAuth endpoints. /auth approves at once and sends the
// browser back with a code. /token checks the PKCE verifier and the client
// secret, as Google does. /userinfo answers for the access token it issued.
export class FakeGoogle {
  private server: Server | null = null;
  private codes = new Map<
    string,
    { challenge: string; redirectUri: string; profile: FakeProfile }
  >();
  private tokens = new Map<string, FakeProfile>();
  readonly requests: string[] = [];
  profile: FakeProfile = {
    sub: `fake-${randomUUID()}`,
    email: "fake.player@example.com",
    name: "Fake Player",
  };

  constructor(private readonly clientSecret: string) {}

  get baseUrl(): string {
    const port = (this.server!.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  async start(port = 0): Promise<void> {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());
    // Lets a script choose who signs in next, as a person picking an account.
    app.post("/control/profile", (req, res) => {
      this.profile = req.body as FakeProfile;
      res.json({ ok: true });
    });
    app.get("/auth", (req, res) => {
      this.requests.push("auth");
      const q = req.query as Record<string, string>;
      if (q.code_challenge_method !== "S256" || !q.code_challenge) {
        res.status(400).send("PKCE required");
        return;
      }
      const code = randomUUID();
      this.codes.set(code, {
        challenge: q.code_challenge,
        redirectUri: q.redirect_uri!,
        profile: this.profile,
      });
      const back = new URL(q.redirect_uri!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", q.state!);
      res.redirect(302, back.toString());
    });
    app.post("/token", (req, res) => {
      this.requests.push("token");
      const body = req.body as Record<string, string>;
      const entry = this.codes.get(body.code ?? "");
      const challenge = createHash("sha256")
        .update(body.code_verifier ?? "")
        .digest("base64url");
      const basic = req.headers.authorization;
      const secretOk =
        body.client_secret === this.clientSecret ||
        (basic !== undefined &&
          Buffer.from(basic.replace(/^Basic /, ""), "base64")
            .toString()
            .endsWith(`:${this.clientSecret}`));
      if (
        !entry ||
        entry.challenge !== challenge ||
        entry.redirectUri !== body.redirect_uri ||
        !secretOk
      ) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      this.codes.delete(body.code!);
      const accessToken = randomUUID();
      this.tokens.set(accessToken, entry.profile);
      res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    app.get("/userinfo", (req, res) => {
      this.requests.push("userinfo");
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const profile = this.tokens.get(token);
      if (!profile) {
        res.status(401).json({ error: "invalid_token" });
        return;
      }
      res.json({ ...profile, email_verified: true });
    });
    await new Promise<void>((resolve) => {
      this.server = app.listen(port, "127.0.0.1", () => resolve());
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}
