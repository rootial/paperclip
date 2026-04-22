import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { activityLog, heartbeatRuns } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { PLUGIN_EVENT_TYPES, type PluginEventType } from "@paperclipai/shared";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import { publishLiveEvent } from "./live-events.js";
import { redactCurrentUserValue } from "../log-redaction.js";
import { sanitizeRecord } from "../redaction.js";
import { logger } from "../middleware/logger.js";
import type { PluginEventBus } from "./plugin-event-bus.js";
import { instanceSettingsService } from "./instance-settings.js";

const PLUGIN_EVENT_SET: ReadonlySet<string> = new Set(PLUGIN_EVENT_TYPES);

let _pluginEventBus: PluginEventBus | null = null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Wire the plugin event bus so domain events are forwarded to plugins. */
export function setPluginEventBus(bus: PluginEventBus): void {
  if (_pluginEventBus) {
    logger.warn("setPluginEventBus called more than once, replacing existing bus");
  }
  _pluginEventBus = bus;
}

export interface LogActivityInput {
  companyId: string;
  actorType: "agent" | "user" | "system";
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentId?: string | null;
  runId?: string | null;
  details?: Record<string, unknown> | null;
}

type ResolvedActivityRun = {
  id: string;
  agentId: string;
};

async function resolveActivityRun(db: Db, runId: string | null | undefined): Promise<ResolvedActivityRun | null> {
  const candidate = runId?.trim() ?? "";
  if (!candidate || !UUID_RE.test(candidate)) return null;

  const existing = await db
    .select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, candidate))
    .then((rows) => rows[0] ?? null);

  if (existing) return existing;

  logger.warn({ runId: candidate }, "dropping activity log runId because heartbeat run does not exist");
  return null;
}

function normalizeActivityActor(
  input: LogActivityInput,
  resolvedRun: ResolvedActivityRun | null,
) {
  const runAgentId = resolvedRun?.agentId ?? null;
  if (input.actorType === "user" && input.actorId === "local-board" && runAgentId) {
    return {
      actorType: "agent" as const,
      actorId: runAgentId,
      agentId: runAgentId,
      runId: resolvedRun?.id ?? null,
    };
  }

  return {
    actorType: input.actorType,
    actorId: input.actorId,
    agentId: input.agentId ?? runAgentId,
    runId: resolvedRun?.id ?? null,
  };
}

export async function logActivity(db: Db, input: LogActivityInput) {
  const currentUserRedactionOptions = {
    enabled: (await instanceSettingsService(db).getGeneral()).censorUsernameInLogs,
  };
  const sanitizedDetails = input.details ? sanitizeRecord(input.details) : null;
  const redactedDetails = sanitizedDetails
    ? redactCurrentUserValue(sanitizedDetails, currentUserRedactionOptions)
    : null;
  const resolvedRun = await resolveActivityRun(db, input.runId);
  const normalizedActor = normalizeActivityActor(input, resolvedRun);
  await db.insert(activityLog).values({
    companyId: input.companyId,
    actorType: normalizedActor.actorType,
    actorId: normalizedActor.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    agentId: normalizedActor.agentId ?? null,
    runId: normalizedActor.runId,
    details: redactedDetails,
  });

  publishLiveEvent({
    companyId: input.companyId,
    type: "activity.logged",
    payload: {
      actorType: normalizedActor.actorType,
      actorId: normalizedActor.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      agentId: normalizedActor.agentId ?? null,
      runId: normalizedActor.runId,
      details: redactedDetails,
    },
  });

  if (_pluginEventBus && PLUGIN_EVENT_SET.has(input.action)) {
    const event: PluginEvent = {
      eventId: randomUUID(),
      eventType: input.action as PluginEventType,
      occurredAt: new Date().toISOString(),
      actorId: normalizedActor.actorId,
      actorType: normalizedActor.actorType,
      entityId: input.entityId,
      entityType: input.entityType,
      companyId: input.companyId,
      payload: {
        ...redactedDetails,
        agentId: normalizedActor.agentId ?? null,
        runId: normalizedActor.runId,
      },
    };
    void _pluginEventBus.emit(event).then(({ errors }) => {
      for (const { pluginId, error } of errors) {
        logger.warn({ pluginId, eventType: event.eventType, err: error }, "plugin event handler failed");
      }
    }).catch(() => {});
  }
}
