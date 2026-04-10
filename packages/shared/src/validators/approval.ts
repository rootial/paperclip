import { z } from "zod";
import { APPROVAL_TYPES } from "../constants.js";
import { updateAgentSchema } from "./agent.js";

export const agentConfigChangePatchSchema = updateAgentSchema
  .pick({
    adapterType: true,
    adapterConfig: true,
    runtimeConfig: true,
    replaceAdapterConfig: true,
  })
  .refine(
    (value) =>
      value.adapterType !== undefined
      || value.adapterConfig !== undefined
      || value.runtimeConfig !== undefined,
    {
      message: "requestedPatch must include at least one of: adapterType, adapterConfig, runtimeConfig",
    },
  )
  .refine(
    (value) => !(value.replaceAdapterConfig === true && value.adapterConfig === undefined),
    {
      message: "replaceAdapterConfig:true requires adapterConfig to be provided",
      path: ["replaceAdapterConfig"],
    },
  );

export const agentConfigChangeApprovalPayloadSchema = z.object({
  targetAgentId: z.string().uuid(),
  requestedPatch: agentConfigChangePatchSchema,
  reason: z.string().trim().min(1).optional(),
  risk: z.string().trim().min(1).optional(),
  rollbackPlan: z.string().trim().min(1).optional(),
});

export type AgentConfigChangeApprovalPayload = z.infer<typeof agentConfigChangeApprovalPayloadSchema>;

export const createApprovalSchema = z.object({
  type: z.enum(APPROVAL_TYPES),
  requestedByAgentId: z.string().uuid().optional().nullable(),
  payload: z.record(z.unknown()),
  issueIds: z.array(z.string().uuid()).optional(),
}).superRefine((value, ctx) => {
  if (value.type !== "agent_config_change") return;
  const parsed = agentConfigChangeApprovalPayloadSchema.safeParse(value.payload);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({
      ...issue,
      path: ["payload", ...issue.path],
    });
  }
});

export type CreateApproval = z.infer<typeof createApprovalSchema>;

export const resolveApprovalSchema = z.object({
  decisionNote: z.string().optional().nullable(),
  decidedByUserId: z.string().optional().default("board"),
});

export type ResolveApproval = z.infer<typeof resolveApprovalSchema>;

export const requestApprovalRevisionSchema = z.object({
  decisionNote: z.string().optional().nullable(),
  decidedByUserId: z.string().optional().default("board"),
});

export type RequestApprovalRevision = z.infer<typeof requestApprovalRevisionSchema>;

export const resubmitApprovalSchema = z.object({
  payload: z.record(z.unknown()).optional(),
});

export type ResubmitApproval = z.infer<typeof resubmitApprovalSchema>;

export const addApprovalCommentSchema = z.object({
  body: z.string().min(1),
});

export type AddApprovalComment = z.infer<typeof addApprovalCommentSchema>;
