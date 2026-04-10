import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  addApprovalCommentSchema,
  agentConfigChangeApprovalPayloadSchema,
  createApprovalSchema,
  requestApprovalRevisionSchema,
  resolveApprovalSchema,
  resubmitApprovalSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import {
  approvalService,
  agentService,
  heartbeatService,
  issueApprovalService,
  logActivity,
  secretService,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { redactEventPayload } from "../redaction.js";
import { notFound, unprocessable } from "../errors.js";

function redactApprovalPayload<T extends { payload: Record<string, unknown> }>(approval: T): T {
  return {
    ...approval,
    payload: redactEventPayload(approval.payload) ?? {},
  };
}

export function approvalRoutes(db: Db) {
  const router = Router();
  const svc = approvalService(db);
  const agentsSvc = agentService(db);
  const heartbeat = heartbeatService(db);
  const issueApprovalsSvc = issueApprovalService(db);
  const secretsSvc = secretService(db);
  const strictSecretsMode = process.env.PAPERCLIP_SECRETS_STRICT_MODE === "true";

  async function normalizeApprovalPayload(
    companyId: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    if (type === "hire_agent") {
      return secretsSvc.normalizeHireApprovalPayloadForPersistence(
        companyId,
        payload,
        { strictMode: strictSecretsMode },
      );
    }

    if (type === "agent_config_change") {
      const parsed = agentConfigChangeApprovalPayloadSchema.parse(payload);
      const targetAgent = await agentsSvc.getById(parsed.targetAgentId);
      if (!targetAgent) throw notFound("Target agent not found");
      if (targetAgent.companyId !== companyId) {
        throw unprocessable("Target agent must belong to the same company");
      }

      const requestedPatch = { ...parsed.requestedPatch } as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(requestedPatch, "adapterConfig")) {
        const adapterConfig = requestedPatch.adapterConfig;
        if (typeof adapterConfig !== "object" || adapterConfig === null || Array.isArray(adapterConfig)) {
          throw unprocessable("requestedPatch.adapterConfig must be an object");
        }
        requestedPatch.adapterConfig = await secretsSvc.normalizeAdapterConfigForPersistence(
          companyId,
          adapterConfig as Record<string, unknown>,
          { strictMode: strictSecretsMode },
        );
      }

      return {
        ...parsed,
        requestedPatch,
      };
    }

    return payload;
  }

  async function applyApprovedAgentConfigChange(
    approval: Awaited<ReturnType<typeof svc.getById>>,
    decidedByUserId: string,
  ) {
    if (!approval || approval.type !== "agent_config_change") return null;
    const parseResult = agentConfigChangeApprovalPayloadSchema.safeParse(approval.payload);
    if (!parseResult.success) {
      throw unprocessable(
        `Stored approval payload is invalid and cannot be applied: ${parseResult.error.message}`,
      );
    }
    const parsed = parseResult.data;
    const targetAgent = await agentsSvc.getById(parsed.targetAgentId);
    if (!targetAgent) throw notFound("Target agent not found");
    if (targetAgent.companyId !== approval.companyId) {
      throw unprocessable("Target agent must belong to the same company");
    }

    const updated = await agentsSvc.update(parsed.targetAgentId, parsed.requestedPatch, {
      recordRevision: {
        createdByAgentId: null,
        createdByUserId: decidedByUserId,
        source: "approval",
      },
    });
    if (!updated) throw notFound("Target agent not found");
    return { updated, parsed };
  }

  router.get("/companies/:companyId/approvals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const status = req.query.status as string | undefined;
    const result = await svc.list(companyId, status);
    res.json(result.map((approval) => redactApprovalPayload(approval)));
  });

  router.get("/approvals/:id", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    res.json(redactApprovalPayload(approval));
  });

  router.post("/companies/:companyId/approvals", validate(createApprovalSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    // Issue 4 fix: agent_config_change requests can alter any agent's configuration
    // once board-approved. Restrict submission to agents that have been explicitly
    // granted the canRequestAgentConfigChange permission (analogous to canCreateAgents).
    if (req.body.type === "agent_config_change" && req.actor.type === "agent" && req.actor.agentId) {
      const actorAgent = await agentsSvc.getById(req.actor.agentId);
      const hasPermission =
        actorAgent?.role === "ceo"
        || Boolean((actorAgent?.permissions as Record<string, unknown> | null)?.canRequestAgentConfigChange);
      if (!hasPermission) {
        res.status(403).json({
          error: "Agent does not have permission to submit agent config change approvals",
        });
        return;
      }
    }

    const rawIssueIds = req.body.issueIds;
    const issueIds = Array.isArray(rawIssueIds)
      ? rawIssueIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const uniqueIssueIds = Array.from(new Set(issueIds));
    const { issueIds: _issueIds, ...approvalInput } = req.body;
    const normalizedPayload = await normalizeApprovalPayload(
      companyId,
      approvalInput.type,
      approvalInput.payload,
    );

    const actor = getActorInfo(req);
    const approval = await svc.create(companyId, {
      ...approvalInput,
      payload: normalizedPayload,
      requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
      requestedByAgentId:
        approvalInput.requestedByAgentId ?? (actor.actorType === "agent" ? actor.actorId : null),
      status: "pending",
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      updatedAt: new Date(),
    });

    if (uniqueIssueIds.length > 0) {
      await issueApprovalsSvc.linkManyForApproval(approval.id, uniqueIssueIds, {
        agentId: actor.agentId,
        userId: actor.actorType === "user" ? actor.actorId : null,
      });
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.created",
      entityType: "approval",
      entityId: approval.id,
      details: { type: approval.type, issueIds: uniqueIssueIds },
    });

    res.status(201).json(redactApprovalPayload(approval));
  });

  router.get("/approvals/:id/issues", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const issues = await issueApprovalsSvc.listIssuesForApproval(id);
    res.json(issues);
  });

  router.post("/approvals/:id/approve", validate(resolveApprovalSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const { approval, applied } = await svc.approve(
      id,
      req.body.decidedByUserId ?? "board",
      req.body.decisionNote,
    );

    // Issue 5 fix: svc.approve() has already committed the approval record as
    // "approved" before we get here (idempotency design). If applyApprovedAgent-
    // ConfigChange fails (e.g. target agent deleted between creation and approval),
    // we must not let that throw a 500 — the approval DB state is already final.
    // Instead, return a 207 with the approved approval and an applicationError so
    // the caller knows the side-effect didn't fully complete.
    let applicationError: string | null = null;

    if (applied) {
      let appliedAgentConfigChange: Awaited<ReturnType<typeof applyApprovedAgentConfigChange>> = null;
      try {
        appliedAgentConfigChange = await applyApprovedAgentConfigChange(
          approval,
          req.body.decidedByUserId ?? "board",
        );
      } catch (err) {
        applicationError = err instanceof Error ? err.message : String(err);
        logger.warn({ err, approvalId: approval.id }, "apply step failed after approval was committed");
      }

      const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(approval.id);
      const linkedIssueIds = linkedIssues.map((issue) => issue.id);
      const primaryIssueId = linkedIssueIds[0] ?? null;

      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.approved",
        entityType: "approval",
        entityId: approval.id,
        details: {
          type: approval.type,
          requestedByAgentId: approval.requestedByAgentId,
          linkedIssueIds,
          targetAgentId: appliedAgentConfigChange?.updated.id ?? null,
        },
      });

      if (appliedAgentConfigChange) {
        await logActivity(db, {
          companyId: approval.companyId,
          actorType: "user",
          actorId: req.actor.userId ?? "board",
          action: "agent.updated",
          entityType: "agent",
          entityId: appliedAgentConfigChange.updated.id,
          details: {
            sourceApprovalId: approval.id,
            changedTopLevelKeys: Object.keys(appliedAgentConfigChange.parsed.requestedPatch).sort(),
          },
        });
      }

      if (approval.requestedByAgentId) {
        try {
          const wakeRun = await heartbeat.wakeup(approval.requestedByAgentId, {
            source: "automation",
            triggerDetail: "system",
            reason: "approval_approved",
            payload: {
              approvalId: approval.id,
              approvalStatus: approval.status,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
            },
            requestedByActorType: "user",
            requestedByActorId: req.actor.userId ?? "board",
            contextSnapshot: {
              source: "approval.approved",
              approvalId: approval.id,
              approvalStatus: approval.status,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
              taskId: primaryIssueId,
              wakeReason: "approval_approved",
            },
          });

          await logActivity(db, {
            companyId: approval.companyId,
            actorType: "user",
            actorId: req.actor.userId ?? "board",
            action: "approval.requester_wakeup_queued",
            entityType: "approval",
            entityId: approval.id,
            details: {
              requesterAgentId: approval.requestedByAgentId,
              wakeRunId: wakeRun?.id ?? null,
              linkedIssueIds,
            },
          });
        } catch (err) {
          logger.warn(
            {
              err,
              approvalId: approval.id,
              requestedByAgentId: approval.requestedByAgentId,
            },
            "failed to queue requester wakeup after approval",
          );
          await logActivity(db, {
            companyId: approval.companyId,
            actorType: "user",
            actorId: req.actor.userId ?? "board",
            action: "approval.requester_wakeup_failed",
            entityType: "approval",
            entityId: approval.id,
            details: {
              requesterAgentId: approval.requestedByAgentId,
              linkedIssueIds,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    }

    const responseBody = redactApprovalPayload(approval) as Record<string, unknown>;
    if (applicationError) {
      // 207: approval record is saved but side-effect failed.
      responseBody.applicationError = applicationError;
      res.status(207).json(responseBody);
    } else {
      res.json(responseBody);
    }
  });

  router.post("/approvals/:id/reject", validate(resolveApprovalSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const { approval, applied } = await svc.reject(
      id,
      req.body.decidedByUserId ?? "board",
      req.body.decisionNote,
    );

    if (applied) {
      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.rejected",
        entityType: "approval",
        entityId: approval.id,
        details: { type: approval.type },
      });
    }

    res.json(redactApprovalPayload(approval));
  });

  router.post(
    "/approvals/:id/request-revision",
    validate(requestApprovalRevisionSchema),
    async (req, res) => {
      assertBoard(req);
      const id = req.params.id as string;
      const approval = await svc.requestRevision(
        id,
        req.body.decidedByUserId ?? "board",
        req.body.decisionNote,
      );

      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.revision_requested",
        entityType: "approval",
        entityId: approval.id,
        details: { type: approval.type },
      });

      res.json(redactApprovalPayload(approval));
    },
  );

  router.post("/approvals/:id/resubmit", validate(resubmitApprovalSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    if (req.actor.type === "agent" && req.actor.agentId !== existing.requestedByAgentId) {
      res.status(403).json({ error: "Only requesting agent can resubmit this approval" });
      return;
    }

    const normalizedPayload = req.body.payload
      ? await normalizeApprovalPayload(existing.companyId, existing.type, req.body.payload)
      : undefined;
    const approval = await svc.resubmit(id, normalizedPayload);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: approval.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.resubmitted",
      entityType: "approval",
      entityId: approval.id,
      details: { type: approval.type },
    });
    res.json(redactApprovalPayload(approval));
  });

  router.get("/approvals/:id/comments", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const comments = await svc.listComments(id);
    res.json(comments);
  });

  router.post("/approvals/:id/comments", validate(addApprovalCommentSchema), async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const actor = getActorInfo(req);
    const comment = await svc.addComment(id, req.body.body, {
      agentId: actor.agentId ?? undefined,
      userId: actor.actorType === "user" ? actor.actorId : undefined,
    });

    await logActivity(db, {
      companyId: approval.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.comment_added",
      entityType: "approval",
      entityId: approval.id,
      details: { commentId: comment.id },
    });

    res.status(201).json(comment);
  });

  return router;
}
