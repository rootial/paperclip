import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  instanceSettings,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { logActivity } from "../services/activity-log.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres activity log tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("logActivity runId handling", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-activity-log-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedActor() {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Logger Agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    return { companyId, agentId };
  }

  it("drops malformed run ids instead of failing the activity write", async () => {
    const { companyId, agentId } = await seedActor();

    await expect(
      logActivity(db, {
        companyId,
        actorType: "agent",
        actorId: agentId,
        agentId,
        runId: "manual-owl-drill-1",
        action: "issue.created",
        entityType: "issue",
        entityId: randomUUID(),
      }),
    ).resolves.toBeUndefined();

    const rows = await db.select().from(activityLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runId).toBeNull();
  });

  it("drops non-existent heartbeat run ids instead of failing the activity write", async () => {
    const { companyId, agentId } = await seedActor();

    await expect(
      logActivity(db, {
        companyId,
        actorType: "agent",
        actorId: agentId,
        agentId,
        runId: randomUUID(),
        action: "issue.created",
        entityType: "issue",
        entityId: randomUUID(),
      }),
    ).resolves.toBeUndefined();

    const rows = await db.select().from(activityLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runId).toBeNull();
  });

  it("preserves real heartbeat run ids", async () => {
    const { companyId, agentId } = await seedActor();
    const runId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      contextSnapshot: { issueId: randomUUID() },
    });

    await expect(
      logActivity(db, {
        companyId,
        actorType: "agent",
        actorId: agentId,
        agentId,
        runId,
        action: "issue.created",
        entityType: "issue",
        entityId: randomUUID(),
      }),
    ).resolves.toBeUndefined();

    const rows = await db.select().from(activityLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runId).toBe(runId);
  });
});
