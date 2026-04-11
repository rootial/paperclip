import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres release semantic tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issueService.release semantics", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-release-semantics-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedFixture(input?: {
    status?: "todo" | "in_progress" | "done" | "cancelled";
    completedAt?: Date | null;
    cancelledAt?: Date | null;
  }) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const wakeupRequestId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const now = new Date();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "BackendEngineer",
      role: "engineer",
      status: "active",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      status: "claimed",
      runId,
      claimedAt: now,
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      wakeupRequestId,
      contextSnapshot: { issueId },
      processPid: null,
      processLossRetryCount: 0,
      errorCode: null,
      error: null,
      startedAt: now,
      updatedAt: now,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Release semantic regression fixture",
      status: input?.status ?? "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
      checkoutRunId: runId,
      executionRunId: runId,
      executionAgentNameKey: "backendengineer",
      executionLockedAt: now,
      completedAt: input?.completedAt ?? null,
      cancelledAt: input?.cancelledAt ?? null,
    });

    return { issueId, agentId, runId };
  }

  it("releases normal in_progress issues back to todo and clears execution lock fields", async () => {
    const { issueId, agentId, runId } = await seedFixture();
    const { issueService } = await import("../services/issues.js");
    const svc = issueService(db);

    const released = await svc.release(issueId, agentId, runId);

    expect(released?.status).toBe("todo");
    expect(released?.assigneeAgentId).toBeNull();
    expect(released?.assigneeUserId).toBeNull();
    expect(released?.checkoutRunId).toBeNull();
    expect(released?.executionRunId).toBeNull();
    expect(released?.executionAgentNameKey).toBeNull();
    expect(released?.executionLockedAt).toBeNull();

    const row = await db
      .select({
        status: issues.status,
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);

    expect(row?.status).toBe("todo");
    expect(row?.checkoutRunId).toBeNull();
    expect(row?.executionRunId).toBeNull();
    expect(row?.executionAgentNameKey).toBeNull();
    expect(row?.executionLockedAt).toBeNull();
  });

  it("restores done for terminal probes and clears execution lock fields", async () => {
    const originalCompletedAt = new Date("2026-04-11T04:36:36.000Z");
    const { issueId, agentId, runId } = await seedFixture({
      status: "in_progress",
      completedAt: originalCompletedAt,
      cancelledAt: null,
    });
    const { issueService } = await import("../services/issues.js");
    const svc = issueService(db);

    const released = await svc.release(issueId, agentId, runId);

    expect(released?.status).toBe("done");
    expect(released?.completedAt?.toISOString()).toBe(originalCompletedAt.toISOString());
    expect(released?.checkoutRunId).toBeNull();
    expect(released?.executionRunId).toBeNull();
    expect(released?.executionAgentNameKey).toBeNull();
    expect(released?.executionLockedAt).toBeNull();
  });
});
