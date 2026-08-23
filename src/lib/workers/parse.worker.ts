/**
 * The parse worker.
 *
 * Deliberately trivial. All the logic lives in handler.ts so it can be tested under Node
 * without a worker at all; what remains here is the wiring, which has nothing to get wrong.
 */
import { createHandlerState, handleRequest } from './handler';
import type { WorkerRequest, WorkerResponse } from './protocol';

const state = createHandlerState();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handleRequest(
    event.data,
    (response: WorkerResponse, transfer?: ArrayBuffer[]) => {
      self.postMessage(response, { transfer: transfer ?? [] });
    },
    state,
  );
};
