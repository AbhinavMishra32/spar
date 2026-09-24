export type OptimisticLearnerMessage = { id: string; body: string; createdAt: number };

type PersistedMessage = { role: string; body: string; createdAt: string };

/** Keep the local bubble until the refreshed session contains its durable twin. */
export function unreconciledOptimisticMessages(
  messages: readonly PersistedMessage[],
  optimistic: readonly OptimisticLearnerMessage[],
): OptimisticLearnerMessage[] {
  return optimistic.filter((pending) => !messages.some((item) =>
    item.role === "learner"
      && item.body === pending.body
      && new Date(item.createdAt).getTime() >= pending.createdAt - 1_000,
  ));
}
