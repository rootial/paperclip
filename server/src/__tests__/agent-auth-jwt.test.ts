import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalAgentJwt, verifyLocalAgentJwt } from "../agent-auth-jwt.js";

describe("agent local JWT", () => {
  const secretEnv = "PAPERCLIP_AGENT_JWT_SECRET";
  const betterAuthSecretEnv = "BETTER_AUTH_SECRET";
  const ttlEnv = "PAPERCLIP_AGENT_JWT_TTL_SECONDS";
  const issuerEnv = "PAPERCLIP_AGENT_JWT_ISSUER";
  const audienceEnv = "PAPERCLIP_AGENT_JWT_AUDIENCE";

  const originalEnv = {
    secret: process.env[secretEnv],
    betterAuthSecret: process.env[betterAuthSecretEnv],
    ttl: process.env[ttlEnv],
    issuer: process.env[issuerEnv],
    audience: process.env[audienceEnv],
  };

  beforeEach(() => {
    process.env[secretEnv] = "test-secret";
    delete process.env[betterAuthSecretEnv];
    process.env[ttlEnv] = "3600";
    delete process.env[issuerEnv];
    delete process.env[audienceEnv];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv.secret === undefined) delete process.env[secretEnv];
    else process.env[secretEnv] = originalEnv.secret;
    if (originalEnv.betterAuthSecret === undefined) delete process.env[betterAuthSecretEnv];
    else process.env[betterAuthSecretEnv] = originalEnv.betterAuthSecret;
    if (originalEnv.ttl === undefined) delete process.env[ttlEnv];
    else process.env[ttlEnv] = originalEnv.ttl;
    if (originalEnv.issuer === undefined) delete process.env[issuerEnv];
    else process.env[issuerEnv] = originalEnv.issuer;
    if (originalEnv.audience === undefined) delete process.env[audienceEnv];
    else process.env[audienceEnv] = originalEnv.audience;
  });

  it("creates and verifies a token", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(typeof token).toBe("string");

    const claims = verifyLocalAgentJwt(token!);
    expect(claims).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "claude_local",
      run_id: "run-1",
      iss: "paperclip",
      aud: "paperclip-api",
    });
  });

  it("falls back to the local default secret when no auth secret env is set", () => {
    process.env[secretEnv] = "";
    process.env[betterAuthSecretEnv] = "";
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(token).toBeTruthy();
    expect(verifyLocalAgentJwt(token!)).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
    });
  });

  it("falls back to BETTER_AUTH_SECRET when PAPERCLIP_AGENT_JWT_SECRET is missing", () => {
    process.env[secretEnv] = "";
    process.env[betterAuthSecretEnv] = "better-auth-secret";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const token = createLocalAgentJwt("agent-1", "company-1", "codex_local", "run-1");

    expect(token).toBeTruthy();
    expect(verifyLocalAgentJwt(token!)).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "codex_local",
      run_id: "run-1",
    });
  });

  it("falls back to BETTER_AUTH_SECRET when PAPERCLIP_AGENT_JWT_SECRET is absent", () => {
    delete process.env[secretEnv];
    process.env[betterAuthSecretEnv] = "fallback-secret";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(typeof token).toBe("string");

    const claims = verifyLocalAgentJwt(token!);
    expect(claims).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "claude_local",
      run_id: "run-1",
    });
  });

  it("rejects expired tokens", () => {
    process.env[ttlEnv] = "1";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");

    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    expect(verifyLocalAgentJwt(token!)).toBeNull();
  });

  it("rejects issuer/audience mismatch", () => {
    process.env[issuerEnv] = "custom-issuer";
    process.env[audienceEnv] = "custom-audience";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "codex_local", "run-1");

    process.env[issuerEnv] = "paperclip";
    process.env[audienceEnv] = "paperclip-api";
    expect(verifyLocalAgentJwt(token!)).toBeNull();
  });

  it("rejects tokens that omit iss or aud claims entirely", () => {
    // A token crafted without iss/aud must not pass verification even if the
    // signature is valid — the previous "only validate when present" logic
    // allowed bypass by omission (Issue 1 fix).
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { createHmac } = require("node:crypto");
    const secret = process.env[secretEnv]!;
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payloadWithoutIssuers = Buffer.from(
      JSON.stringify({
        sub: "agent-1",
        company_id: "company-1",
        adapter_type: "claude_local",
        run_id: "run-1",
        iat: now,
        exp: now + 3600,
        // iss and aud intentionally omitted
      }),
    ).toString("base64url");
    const signingInput = `${header}.${payloadWithoutIssuers}`;
    const sig = createHmac("sha256", secret).update(signingInput).digest("base64url");
    const crafted = `${signingInput}.${sig}`;

    expect(verifyLocalAgentJwt(crafted)).toBeNull();
  });
});
