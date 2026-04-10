import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => ({
    getById: vi.fn(),
  }),
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  feedbackService: () => ({}),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  instanceSettingsService: () => ({
    get: vi.fn(async () => ({})),
    getGeneral: vi.fn(async () => ({ censorUsernameInLogs: false })),
    listCompanyIds: vi.fn(async () => []),
  }),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => ({}),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({}),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId: "22222222-2222-4222-8222-222222222222",
      runId: "manual-owl-drill-1",
      companyId: "company-1",
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue create route invalid run id regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockIssueService.create.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-999",
      title: "Regression issue",
      description: "Ensure invalid run ids do not 500",
      status: "todo",
      priority: "medium",
      projectId: null,
      goalId: null,
      parentId: null,
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
    });
  });

  it("still creates the issue and queues assignment wakeup when the agent run id is not a UUID", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/issues")
      .send({
        title: "Regression issue",
        description: "Ensure invalid run ids do not 500",
        priority: "medium",
        assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        identifier: "PAP-999",
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.created",
        runId: "manual-owl-drill-1",
      }),
    );
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      expect.objectContaining({
        source: "assignment",
        triggerDetail: "system",
        reason: "issue_assigned",
        payload: expect.objectContaining({
          issueId: "11111111-1111-4111-8111-111111111111",
          mutation: "create",
        }),
        contextSnapshot: expect.objectContaining({
          issueId: "11111111-1111-4111-8111-111111111111",
          source: "issue.create",
        }),
      }),
    );
  });
});
