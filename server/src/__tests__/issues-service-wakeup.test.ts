/**
 * Regression tests for MATA-196:
 * Verify that issueService.update and issueService.addComment fire wakeup
 * when a heartbeat dep is provided, covering the plugin-host-services call path
 * that bypasses the HTTP route layer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { issueService } from "../services/issues.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWakeup = vi.fn().mockResolvedValue(undefined);
const mockHeartbeat = { wakeup: mockWakeup };

// Mock instanceSettingsService so issueService can be instantiated without a DB.
vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => ({
    getGeneral: vi.fn().mockResolvedValue({ censorUsernameInLogs: false }),
    getExperimental: vi.fn().mockResolvedValue({ enableIsolatedWorkspaces: false }),
    get: vi.fn().mockResolvedValue({ id: "is-1", general: { censorUsernameInLogs: false } }),
  }),
}));

// Mock issue-goal-fallback helpers used inside issueService.update.
vi.mock("../services/issue-goal-fallback.js", () => ({
  resolveIssueGoalId: vi.fn().mockReturnValue(null),
  resolveNextIssueGoalId: vi.fn().mockReturnValue(null),
}));
vi.mock("../services/goals.js", () => ({
  getDefaultCompanyGoal: vi.fn().mockResolvedValue(null),
  goalService: () => ({}),
}));
vi.mock("../services/execution-workspace-policy.js", () => ({
  defaultIssueExecutionWorkspaceSettingsForProject: vi.fn().mockReturnValue(null),
  gateProjectExecutionWorkspacePolicy: vi.fn(),
  issueExecutionWorkspaceModeForPersistedWorkspace: vi.fn(),
  parseProjectExecutionWorkspacePolicy: vi.fn(),
}));

// ---------------------------------------------------------------------------
// DB stub helpers
// ---------------------------------------------------------------------------

const ISSUE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COMPANY_ID = "company-1";
const ASSIGNEE_AGENT_ID = "agent-assignee-1111-1111-111111111111";
const ACTOR_AGENT_ID = "agent-actor-2222-2222-222222222222";

function makeIssueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ISSUE_ID,
    companyId: COMPANY_ID,
    identifier: "PAP-1",
    title: "test",
    description: null,
    status: "in_progress",
    priority: "medium",
    parentId: null,
    projectId: null,
    projectWorkspaceId: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    goalId: null,
    assigneeAgentId: ASSIGNEE_AGENT_ID,
    assigneeUserId: null,
    assigneeAdapterOverrides: null,
    createdByAgentId: null,
    createdByUserId: null,
    executionPolicy: null,
    executionState: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    checkoutRunId: null,
    hiddenAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Build a chainable drizzle select stub that resolves to `rows`. */
function selectStub(rows: unknown[]) {
  const stub: Record<string, unknown> = {};
  stub.from = vi.fn(() => stub);
  stub.innerJoin = vi.fn(() => stub);
  stub.leftJoin = vi.fn(() => stub);
  stub.where = vi.fn(() => ({
    then: (cb: (r: unknown[]) => unknown) => Promise.resolve(cb(rows)),
    orderBy: vi.fn(() => Promise.resolve(rows)),
  }));
  stub.orderBy = vi.fn(() => Promise.resolve(rows));
  return stub;
}

/** Build a chainable drizzle insert stub. */
function insertStub(returning: unknown[]) {
  const stub: Record<string, unknown> = {};
  stub.values = vi.fn(() => stub);
  stub.returning = vi.fn(() => Promise.resolve(returning));
  return stub;
}

/** Build a chainable drizzle update stub (for the updatedAt touch after addComment). */
function updateStub() {
  const stub: Record<string, unknown> = {};
  stub.set = vi.fn(() => stub);
  stub.where = vi.fn(() => stub);
  stub.returning = vi.fn(() => Promise.resolve([]));
  return stub;
}

// ---------------------------------------------------------------------------
// Tests: addComment wakeup
// ---------------------------------------------------------------------------

describe("issueService.addComment wakeup (regression: MATA-196)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wakes the assignee when a different agent comments on the issue", async () => {
    const issueRow = makeIssueRow({ status: "in_review", assigneeAgentId: ASSIGNEE_AGENT_ID });
    const commentRow = {
      id: COMMENT_ID,
      issueId: ISSUE_ID,
      companyId: COMPANY_ID,
      body: "please revise",
      authorAgentId: ACTOR_AGENT_ID,
      authorUserId: null,
      createdByRunId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = {
      select: vi.fn(() => selectStub([issueRow])),
      insert: vi.fn(() => insertStub([commentRow])),
      update: vi.fn(() => updateStub()),
    };

    const svc = issueService(db as any, { heartbeat: mockHeartbeat });
    await svc.addComment(ISSUE_ID, "please revise", { agentId: ACTOR_AGENT_ID });

    expect(mockWakeup).toHaveBeenCalledOnce();
    expect(mockWakeup).toHaveBeenCalledWith(
      ASSIGNEE_AGENT_ID,
      expect.objectContaining({
        reason: "issue_commented",
        payload: expect.objectContaining({ issueId: ISSUE_ID, mutation: "comment" }),
      }),
    );
  });

  it("does NOT wake assignee when the assignee comments on their own issue (self-comment)", async () => {
    const issueRow = makeIssueRow({ status: "in_progress", assigneeAgentId: ASSIGNEE_AGENT_ID });
    const commentRow = { id: COMMENT_ID, issueId: ISSUE_ID, companyId: COMPANY_ID, body: "updating status" };

    const db = {
      select: vi.fn(() => selectStub([issueRow])),
      insert: vi.fn(() => insertStub([commentRow])),
      update: vi.fn(() => updateStub()),
    };

    const svc = issueService(db as any, { heartbeat: mockHeartbeat });
    // Actor is the assignee themselves
    await svc.addComment(ISSUE_ID, "updating status", { agentId: ASSIGNEE_AGENT_ID });

    expect(mockWakeup).not.toHaveBeenCalled();
  });

  it("does NOT wake assignee when the issue is closed (done)", async () => {
    const issueRow = makeIssueRow({ status: "done", assigneeAgentId: ASSIGNEE_AGENT_ID });
    const commentRow = { id: COMMENT_ID, issueId: ISSUE_ID, companyId: COMPANY_ID, body: "post-done note" };

    const db = {
      select: vi.fn(() => selectStub([issueRow])),
      insert: vi.fn(() => insertStub([commentRow])),
      update: vi.fn(() => updateStub()),
    };

    const svc = issueService(db as any, { heartbeat: mockHeartbeat });
    await svc.addComment(ISSUE_ID, "post-done note", { agentId: ACTOR_AGENT_ID });

    expect(mockWakeup).not.toHaveBeenCalled();
  });

  it("does NOT wake if heartbeat dep is not provided", async () => {
    const issueRow = makeIssueRow({ status: "in_review", assigneeAgentId: ASSIGNEE_AGENT_ID });
    const commentRow = { id: COMMENT_ID, issueId: ISSUE_ID, companyId: COMPANY_ID, body: "test" };

    const db = {
      select: vi.fn(() => selectStub([issueRow])),
      insert: vi.fn(() => insertStub([commentRow])),
      update: vi.fn(() => updateStub()),
    };

    // No heartbeat dep
    const svc = issueService(db as any);
    await svc.addComment(ISSUE_ID, "test", { agentId: ACTOR_AGENT_ID });

    expect(mockWakeup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: update wakeup
// ---------------------------------------------------------------------------

describe("issueService.update wakeup (regression: MATA-196)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wakes the new assignee when the issue is assigned to an agent", async () => {
    const existingRow = makeIssueRow({ assigneeAgentId: null, status: "todo" });
    const updatedRow = makeIssueRow({ assigneeAgentId: ASSIGNEE_AGENT_ID, status: "in_progress" });
    const agentRow = { id: ASSIGNEE_AGENT_ID, companyId: COMPANY_ID, status: "active" };

    const db = {
      select: vi.fn()
        .mockReturnValueOnce(selectStub([existingRow])) // 1. fetch existing issue
        .mockReturnValueOnce(selectStub([agentRow]))    // 2. assertAssignableAgent: agents table
        .mockReturnValue(selectStub([])),              // 3. any other selects (goal lookups etc.)
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          select: vi.fn(() => selectStub([])),
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve([updatedRow])),
              })),
            })),
          })),
        };
        return fn(tx);
      }),
    };

    const svc = issueService(db as any, { heartbeat: mockHeartbeat });
    await svc.update(ISSUE_ID, { assigneeAgentId: ASSIGNEE_AGENT_ID, status: "in_progress" });

    expect(mockWakeup).toHaveBeenCalledOnce();
    expect(mockWakeup).toHaveBeenCalledWith(
      ASSIGNEE_AGENT_ID,
      expect.objectContaining({
        reason: "issue_assigned",
        payload: expect.objectContaining({ issueId: ISSUE_ID, mutation: "update" }),
      }),
    );
  });

  it("wakes the assignee when status changes from backlog to todo", async () => {
    const existingRow = makeIssueRow({ assigneeAgentId: ASSIGNEE_AGENT_ID, status: "backlog" });
    const updatedRow = makeIssueRow({ assigneeAgentId: ASSIGNEE_AGENT_ID, status: "todo" });

    const db = {
      select: vi.fn(() => selectStub([existingRow])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          select: vi.fn(() => selectStub([])),
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve([updatedRow])),
              })),
            })),
          })),
        };
        return fn(tx);
      }),
    };

    const svc = issueService(db as any, { heartbeat: mockHeartbeat });
    await svc.update(ISSUE_ID, { status: "todo" });

    expect(mockWakeup).toHaveBeenCalledOnce();
    expect(mockWakeup).toHaveBeenCalledWith(
      ASSIGNEE_AGENT_ID,
      expect.objectContaining({
        reason: "issue_status_changed",
        payload: expect.objectContaining({ issueId: ISSUE_ID, mutation: "update" }),
      }),
    );
  });

  it("does NOT wake when only the title changes (no assignee or backlog status change)", async () => {
    const existingRow = makeIssueRow({ assigneeAgentId: ASSIGNEE_AGENT_ID, status: "in_progress" });
    const updatedRow = makeIssueRow({ assigneeAgentId: ASSIGNEE_AGENT_ID, status: "in_progress", title: "new title" });

    const db = {
      select: vi.fn(() => selectStub([existingRow])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          select: vi.fn(() => selectStub([])),
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve([updatedRow])),
              })),
            })),
          })),
        };
        return fn(tx);
      }),
    };

    const svc = issueService(db as any, { heartbeat: mockHeartbeat });
    await svc.update(ISSUE_ID, { title: "new title" });

    expect(mockWakeup).not.toHaveBeenCalled();
  });
});
