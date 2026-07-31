import { z } from "zod";
import { id, isoDate } from "./model";

export const attemptEventTypeSchema = z.enum([
  "attempt_started", "file_opened", "file_changed", "command_executed",
  "test_created", "test_run", "hint_requested", "agent_message",
  "learner_remark", "submission_created", "submission_evaluated",
  "attempt_paused", "attempt_resumed", "attempt_completed"
]);

export const attemptEventSchema = z.object({
  id,
  attemptId: id,
  sequence: z.number().int().nonnegative(),
  type: attemptEventTypeSchema,
  occurredAt: isoDate,
  payload: z.record(z.unknown()),
  source: z.enum(["learner", "agent", "runner", "system"]),
  schemaVersion: z.literal(1)
});
export type AttemptEvent = z.infer<typeof attemptEventSchema>;

export const appendEventsRequestSchema = z.object({
  attemptId: id,
  expectedSequence: z.number().int().nonnegative(),
  events: z.array(attemptEventSchema).min(1).max(250)
}).superRefine((value, context) => {
  value.events.forEach((event, index) => {
    if (event.attemptId !== value.attemptId || event.sequence !== value.expectedSequence + index) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Attempt event sequence is not contiguous" });
    }
  });
});

