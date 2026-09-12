import { useCallback } from "react";

import { message } from "@/lib/format";

/**
 * Stops the turn running for a session.
 *
 * Every composer in a session offers this, so it lives here rather than being
 * threaded down as another prop: the panel that draws the button is often not
 * the component that was handed the API.
 *
 * Deliberately optimistic — nothing is disabled while the stop is in flight.
 * The turn ends when the worker's loop notices, and the `done` event that
 * follows is what clears the live run; showing a spinner on the stop button in
 * the meantime would be a second thing to wait for.
 */
export function useStopTurn(sessionId: string, onError?: (value: string) => void) {
  return useCallback(() => {
    void window.spar?.stopAgentTurn({ sessionId }).catch((cause: unknown) => onError?.(message(cause)));
  }, [onError, sessionId]);
}
