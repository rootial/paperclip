import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createLocalAgentJwt } from "../agent-auth-jwt.js";
import { actorMiddleware } from "../middleware/auth.js";

function createSelectChain(rows: unknown[]) {
  return {
    from() {
      return {
        where() {
          return Promise.resolve(rows);
        },
      };
    },
  };
}

function createDb() {
  return {
    select: vi
      .fn()
      .mockImplementationOnce(() => createSelectChain([]))
      .mockImplementationOnce(() => createSelectChain([])),
  } as any;
}

function createLocalTrustedDb(agentRows: unknown[] = []) {
  return {
    select: vi
      .fn()
      .mockImplementationOnce(() => createSelectChain([]))
      .mockImplementationOnce(() => createSelectChain([]))
      .mockImplementationOnce(() => createSelectChain(agentRows)),
  } as any;
}

describe("actorMiddleware authenticated session profile", () => {
  it("preserves the signed-in user name and email on the board actor", async () => {
    const app = express();
    app.use(
      actorMiddleware(createDb(), {
        deploymentMode: "authenticated",
        resolveSession: async () => ({
          session: { id: "session-1", userId: "user-1" },
          user: {
            id: "user-1",
            name: "User One",
            email: "user@example.com",
          },
        }),
      }),
    );
    app.get("/actor", (req, res) => {
      res.json(req.actor);
    });

    const res = await request(app).get("/actor");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: "board",
      userId: "user-1",
      userName: "User One",
      userEmail: "user@example.com",
      source: "session",
      companyIds: [],
      memberships: [],
      isInstanceAdmin: false,
    });
  });

  it("prefers a valid bearer agent jwt over local implicit board access", async () => {
    const app = express();
    const token = createLocalAgentJwt("agent-1", "company-1", "codex_local", "run-1");
    app.use(actorMiddleware(createLocalTrustedDb([{ id: "agent-1", companyId: "company-1", status: "active" }]), {
      deploymentMode: "local_trusted",
    }));
    app.get("/actor", (req, res) => {
      res.json(req.actor);
    });

    const res = await request(app)
      .get("/actor")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Paperclip-Run-Id", "run-1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      runId: "run-1",
      source: "agent_jwt",
    });
  });

  it("does not fall back to local-board when a bearer token is invalid", async () => {
    const app = express();
    app.use(actorMiddleware(createLocalTrustedDb(), {
      deploymentMode: "local_trusted",
    }));
    app.get("/actor", (req, res) => {
      res.json(req.actor);
    });

    const res = await request(app)
      .get("/actor")
      .set("Authorization", "Bearer invalid-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: "none",
      source: "none",
    });
  });
});
