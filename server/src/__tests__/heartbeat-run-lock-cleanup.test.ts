/**
 * Regression tests for MATA-198 (Bug #4 in MATA-178):
 *
 * Verify that issue execution lock fields (executionRunId, executionAgentNameKey,
 * executionLockedAt) are cleared to null when a heartbeat run reaches any of the
 * four terminal states: succeeded, timed_out, failed, or cancelled.
 *
 * Context: MATA-193 Phase 1 confirmed that `releaseIssueExecutionAndPromote`
 * (heartbeat.ts:3496) is called from all four terminal paths.  These tests
 * guard against future regressions where that call-site is accidentally removed.
 *
 * Assertions: executionRunId === null && executionAgentNameKey === null &&
 *             executionLockedAt === null
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  companySkills,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  registerServerAdapter,
  runningProcesses,
  unregisterServerAdapter,
} from "../adapters/index.ts";
import type {
  AdapterExecutionResult,
  ServerAdapterModule,
} from "../adapters/index.ts";
import { heartbeatService } from "../services/heartbeat.ts";

// ---------------------------------------------------------------------------
// Telemetry mocks (same pattern as heartbeat-process-recovery.test.ts)
// ---------------------------------------------------------------------------

const mockTelemetryClient = vi.hoisted(() => ({ track: vi.fn() }));
const mockTrackAgentFirstHeartbeat = vi.hoisted(() => vi.fn());

vi.mock("../telemetry.ts", () => ({
  getTelemetryClient: () => mockTelemetryClient,
}));

vi.mock("@paperclipai/shared/telemetry", async () => {
  const actual = await vi.importActual<
    typeof import("@paperclipai/shared/telemetry")
  >("@paperclipai/shared/telemetry");
  return {
    ...actual,
    trackAgentFirstHeartbeat: mockTrackAgentFirstHeartbeat,
  };
});

// ---------------------------------------------------------------------------
// Mock adapter for succeeded / timed_out paths
// ---------------------------------------------------------------------------

/**
 * A unique adapter type that is not a built-in, so it can be registered and
 * unregistered without clobbering any real adapter.
 */
const MOCK_ADAPTER_TYPE = "mock_test_adapter_lock_cleanup";

function makeMockAdapter(
  executeResult: AdapterExecutionResult,
): ServerAdapterModule {
  return {
    type: MOCK_ADAPTER_TYPE,
    execute: async (_ctx) => executeResult,
    testEnvironment: async () => ({ status: "pass" as const, checks: [] }),
  };
}

/**
 * Poll until the run leaves queued/running status or the deadline is exceeded.
 */
async function waitForRunTerminal(
  heartbeat: ReturnType<typeof heartbeatService>,
  runId: string,
  maxMs = 8_000,
): Promise<typeof heartbeatRuns.$inferSelect> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const run = await heartbeat.getRun(runId);
    if (run && run.status !== "queued" && run.status !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Run ${runId} did not reach a terminal state within ${maxMs}ms`,
  );
}

// ---------------------------------------------------------------------------
// Embedded Postgres setup
// ---------------------------------------------------------------------------

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres lock cleanup tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres(
  "releaseIssueExecutionAndPromote — lock fields cleared on run terminal",
  () => {
    let db!: ReturnType<typeof createDb>;
    let tempDb: Awaited<
      ReturnType<typeof startEmbeddedPostgresTestDatabase>
    > | null = null;

    beforeAll(async () => {
      tempDb = await startEmbeddedPostgresTestDatabase(
        "paperclip-heartbeat-lock-cleanup-",
      );
      db = createDb(tempDb.connectionString);
    }, 20_000);

    afterEach(async () => {
      vi.clearAllMocks();
      runningProcesses.clear();

      // Delete in FK-dependency order (dependents first)
      await db.delete(issues);
      await db.delete(heartbeatRunEvents);
      await db.delete(agentRuntimeState);
      await db.delete(heartbeatRuns);
      await db.delete(agentWakeupRequests);
      await db.delete(agents);
      await db.delete(companySkills);
      await db.delete(companies);
    });

    afterAll(async () => {
      runningProcesses.clear();
      await tempDb?.cleanup();
    });

    // -----------------------------------------------------------------------
    // Shared fixture helpers
    // -----------------------------------------------------------------------

    /**
     * Seeds the minimal DB rows needed for lock-cleanup tests:
     *   company → agent → agentWakeupRequest → heartbeatRun → issue
     *
     * The issue is created with all three execution lock fields pointing to the
     * seeded run, so that `releaseIssueExecutionAndPromote` can find and clear
     * them.
     *
     * @param opts.runStatus   Initial status of the heartbeat run.
     * @param opts.adapterType Adapter type to assign to the agent.
     * @param opts.agentStatus Status of the agent.
     */
    async function seedFixture(opts?: {
      runStatus?: "running" | "queued";
      adapterType?: string;
      agentStatus?: "paused" | "idle" | "running";
    }) {
      const companyId = randomUUID();
      const agentId = randomUUID();
      const runId = randomUUID();
      const wakeupRequestId = randomUUID();
      const issueId = randomUUID();
      const now = new Date();
      const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      const adapterType = opts?.adapterType ?? "codex_local";
      const agentStatus = opts?.agentStatus ?? "idle";

      await db.insert(companies).values({
        id: companyId,
        name: "LockCleanupTestCo",
        issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });

      await db.insert(agents).values({
        id: agentId,
        companyId,
        name: "BackendEngineer",
        role: "engineer",
        status: agentStatus,
        adapterType,
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
        status: opts?.runStatus ?? "running",
        wakeupRequestId,
        // Intentionally omit wakeReason from contextSnapshot so that
        // `shouldRequireIssueCommentForWake` returns false and no comment-retry
        // wakeup is enqueued after the run finishes.
        contextSnapshot: { issueId },
        processPid: null,
        processLossRetryCount: 0,
        errorCode: null,
        error: null,
        startedAt: now,
        updatedAt: now,
      });

      // Create the issue with all three lock fields set to the run above.
      // executionRunId has an FK to heartbeatRuns.id (onDelete: set null),
      // so the run must exist before we can reference it here.
      await db.insert(issues).values({
        id: issueId,
        companyId,
        title: "Test lock cleanup on run terminal",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        checkoutRunId: runId,
        executionRunId: runId,
        executionAgentNameKey: "backend engineer",
        executionLockedAt: now,
        issueNumber: 1,
        identifier: `${issuePrefix}-1`,
      });

      return { companyId, agentId, runId, wakeupRequestId, issueId };
    }

    /**
     * Reads the three lock fields for an issue directly from the DB.
     */
    async function readLockFields(issueId: string) {
      return db
        .select({
          executionRunId: issues.executionRunId,
          executionAgentNameKey: issues.executionAgentNameKey,
          executionLockedAt: issues.executionLockedAt,
        })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);
    }

    // -----------------------------------------------------------------------
    // Path 1: cancelled
    // -----------------------------------------------------------------------

    it("lock fields cleared — run cancelled", async () => {
      const { issueId, runId } = await seedFixture({ runStatus: "running" });
      const heartbeat = heartbeatService(db);

      await heartbeat.cancelRun(runId);

      const run = await heartbeat.getRun(runId);
      expect(run?.status).toBe("cancelled");

      const lockFields = await readLockFields(issueId);
      expect(lockFields?.executionRunId).toBeNull();
      expect(lockFields?.executionAgentNameKey).toBeNull();
      expect(lockFields?.executionLockedAt).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Path 2: failed (orphan reaping, no process-loss retry)
    // -----------------------------------------------------------------------

    it("lock fields cleared — run failed (orphan reaping, no retry)", async () => {
      // Use an HTTP adapter type: not in SESSIONED_LOCAL_ADAPTERS, so
      // `isTrackedLocalChildProcessAdapter` returns false and `shouldRetry`
      // is unconditionally false.  This means `reapOrphanedRuns` calls
      // `releaseIssueExecutionAndPromote` directly without queuing a retry run.
      const { issueId, runId } = await seedFixture({
        runStatus: "running",
        adapterType: "http",
      });
      const heartbeat = heartbeatService(db);

      // The run has no associated process (processPid = null), so
      // reapOrphanedRuns classifies it as a lost orphan and fails it.
      const result = await heartbeat.reapOrphanedRuns();
      expect(result.reaped).toBeGreaterThanOrEqual(1);
      expect(result.runIds).toContain(runId);

      const run = await heartbeat.getRun(runId);
      expect(run?.status).toBe("failed");

      const lockFields = await readLockFields(issueId);
      expect(lockFields?.executionRunId).toBeNull();
      expect(lockFields?.executionAgentNameKey).toBeNull();
      expect(lockFields?.executionLockedAt).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Path 3: succeeded
    // -----------------------------------------------------------------------

    it("lock fields cleared — run succeeded", async () => {
      registerServerAdapter(
        makeMockAdapter({ exitCode: 0, signal: null, timedOut: false }),
      );
      try {
        const { issueId, agentId, runId } = await seedFixture({
          runStatus: "queued",
          adapterType: MOCK_ADAPTER_TYPE,
          agentStatus: "idle",
        });
        const heartbeat = heartbeatService(db);

        // resumeQueuedRuns triggers executeRun (fire-and-forget internally).
        // We poll until the run exits the queued/running states.
        await heartbeat.resumeQueuedRuns();
        const finalRun = await waitForRunTerminal(heartbeat, runId);

        expect(finalRun.status).toBe("succeeded");

        const lockFields = await readLockFields(issueId);
        expect(lockFields?.executionRunId).toBeNull();
        expect(lockFields?.executionAgentNameKey).toBeNull();
        expect(lockFields?.executionLockedAt).toBeNull();
      } finally {
        unregisterServerAdapter(MOCK_ADAPTER_TYPE);
      }
    });

    // -----------------------------------------------------------------------
    // Path 4: timed_out
    // -----------------------------------------------------------------------

    it("lock fields cleared — run timed_out", async () => {
      registerServerAdapter(
        makeMockAdapter({ exitCode: null, signal: null, timedOut: true }),
      );
      try {
        const { issueId, runId } = await seedFixture({
          runStatus: "queued",
          adapterType: MOCK_ADAPTER_TYPE,
          agentStatus: "idle",
        });
        const heartbeat = heartbeatService(db);

        await heartbeat.resumeQueuedRuns();
        const finalRun = await waitForRunTerminal(heartbeat, runId);

        expect(finalRun.status).toBe("timed_out");

        const lockFields = await readLockFields(issueId);
        expect(lockFields?.executionRunId).toBeNull();
        expect(lockFields?.executionAgentNameKey).toBeNull();
        expect(lockFields?.executionLockedAt).toBeNull();
      } finally {
        unregisterServerAdapter(MOCK_ADAPTER_TYPE);
      }
    });
  },
);
