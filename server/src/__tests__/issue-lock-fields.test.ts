/**
 * Regression tests for MATA-197:
 * Verify that execution lock fields (executionRunId, executionAgentNameKey,
 * executionLockedAt) are written via the internal service path and NOT
 * accessible through the external HTTP PATCH endpoint.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  agentWakeupRequests,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

// ---------------------------------------------------------------------------
// Part 1: Service-layer integration tests (embedded postgres)
// Verify checkout writes executionRunId to DB via the internal path.
// ---------------------------------------------------------------------------

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres lock field tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issueService.checkout — lock field persistence", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-lock-fields-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    // Delete in FK-dependency order: dependents first
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedFixture() {
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

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Test lock field persistence",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    // checkoutRunId and executionRunId have FK constraints → heartbeatRuns.id,
    // so we need a real wakeup request + run in the DB before checkout.
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

    return { companyId, agentId, issueId, runId };
  }

  it("checkout writes executionRunId to DB via service layer (not HTTP PATCH)", async () => {
    const { issueId, agentId, runId } = await seedFixture();

    // Dynamically import so the service uses the seeded DB
    const { issueService } = await import("../services/issues.js");
    const svc = issueService(db);

    const result = await svc.checkout(issueId, agentId, ["todo"], runId);

    expect(result).not.toBeNull();
    expect(result?.executionRunId).toBe(runId);
    expect(result?.status).toBe("in_progress");

    // Verify directly in DB — the field is actually persisted
    const row = await db
      .select({ executionRunId: issues.executionRunId, checkoutRunId: issues.checkoutRunId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);

    expect(row?.executionRunId).toBe(runId);
    expect(row?.checkoutRunId).toBe(runId);
  });

  it("clearing lock fields on status change away from in_progress works via service layer", async () => {
    const { issueId, agentId, runId } = await seedFixture();

    const { issueService } = await import("../services/issues.js");
    const svc = issueService(db);

    // First checkout to set lock fields
    await svc.checkout(issueId, agentId, ["todo"], runId);

    // Verify lock is set
    const lockedRow = await db
      .select({ executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    expect(lockedRow?.executionRunId).toBe(runId);

    // Transition to done — lock fields should be cleared
    await svc.update(issueId, {
      status: "done",
      actorAgentId: agentId,
    });

    const clearedRow = await db
      .select({
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);

    expect(clearedRow?.executionRunId).toBeNull();
    expect(clearedRow?.executionAgentNameKey).toBeNull();
    expect(clearedRow?.executionLockedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Part 2: Route-level tests (mocked services)
// Verify that HTTP PATCH strips lock fields before calling issueService.update.
// ---------------------------------------------------------------------------

const ISSUE_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "company-1";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  assertCheckoutOwner: vi.fn(),
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
  listWakeableBlockedDependents: vi.fn(),
  getWakeableParentAfterChildCompletion: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(async () => false),
    hasPermission: vi.fn(async () => false),
  }),
  agentService: () => ({ getById: vi.fn(async () => null) }),
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(async () => []),
    saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
  }),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  instanceSettingsService: () => ({
    get: vi.fn(async () => ({
      id: "instance-settings-1",
      general: { censorUsernameInLogs: false, feedbackDataSharingPreference: "prompt" },
    })),
    listCompanyIds: vi.fn(async () => [COMPANY_ID]),
  }),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: vi.fn(async () => undefined),
  projectService: () => ({}),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({}),
}));

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: ISSUE_ID,
    companyId: COMPANY_ID,
    status: "todo",
    assigneeAgentId: AGENT_ID,
    assigneeUserId: null,
    createdByUserId: "local-board",
    identifier: "MATA-1",
    title: "Test issue",
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    checkoutRunId: null,
    executionWorkspaceId: null,
    ...overrides,
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: [COMPANY_ID],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  return app;
}

describe("PATCH /api/issues/:id — lock field stripping", () => {
  beforeEach(async () => {
    vi.resetModules();

    mockIssueService.getById.mockReset();
    mockIssueService.update.mockReset();
    mockIssueService.assertCheckoutOwner.mockReset();
    mockIssueService.addComment.mockReset();
    mockIssueService.findMentionedAgents.mockReset();
    mockIssueService.listWakeableBlockedDependents.mockReset();
    mockIssueService.getWakeableParentAfterChildCompletion.mockReset();
    mockHeartbeatService.wakeup.mockReset();
    mockHeartbeatService.reportRunActivity.mockReset();
    mockHeartbeatService.getRun.mockReset();
    mockHeartbeatService.getActiveRunForAgent.mockReset();
    mockHeartbeatService.cancelRun.mockReset();

    mockHeartbeatService.wakeup.mockResolvedValue(undefined);
    mockHeartbeatService.reportRunActivity.mockResolvedValue(undefined);
    mockHeartbeatService.getRun.mockResolvedValue(null);
    mockHeartbeatService.getActiveRunForAgent.mockResolvedValue(null);
    mockHeartbeatService.cancelRun.mockResolvedValue(null);
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
    mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
  });

  it("strips executionRunId from PATCH body — issueService.update is called without it", async () => {
    const fakeRunId = randomUUID();
    const updatedIssue = makeIssue({ status: "done" });

    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockIssueService.update.mockResolvedValue(updatedIssue);

    const { issueRoutes } = await import("../routes/issues.js");
    const { errorHandler } = await import("../middleware/index.js");
    const app = createApp();
    app.use("/api", issueRoutes({} as any, {} as any));
    app.use(errorHandler);

    const res = await request(app)
      .patch(`/api/issues/${ISSUE_ID}`)
      .send({
        status: "done",
        executionRunId: fakeRunId,
        executionAgentNameKey: "backend-engineer",
        executionLockedAt: new Date().toISOString(),
      });

    expect(res.status).toBe(200);

    // The service update must NOT have received any lock fields
    expect(mockIssueService.update).toHaveBeenCalledWith(
      ISSUE_ID,
      expect.not.objectContaining({
        executionRunId: expect.anything(),
        executionAgentNameKey: expect.anything(),
        executionLockedAt: expect.anything(),
      }),
    );

    // status IS a legitimate field and must be passed through
    expect(mockIssueService.update).toHaveBeenCalledWith(
      ISSUE_ID,
      expect.objectContaining({ status: "done" }),
    );
  });

  it("accepts a PATCH without lock fields and returns 200", async () => {
    const updatedIssue = makeIssue({ status: "in_progress" });

    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockIssueService.update.mockResolvedValue(updatedIssue);

    const { issueRoutes } = await import("../routes/issues.js");
    const { errorHandler } = await import("../middleware/index.js");
    const app = createApp();
    app.use("/api", issueRoutes({} as any, {} as any));
    app.use(errorHandler);

    const res = await request(app)
      .patch(`/api/issues/${ISSUE_ID}`)
      .send({ status: "in_progress" });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      ISSUE_ID,
      expect.objectContaining({ status: "in_progress" }),
    );
  });
});
