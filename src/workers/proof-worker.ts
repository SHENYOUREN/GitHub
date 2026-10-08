import type { WorkerAdapter, WorkerRequest, WorkerResult } from '../types.js';

export class ProofWorkerAdapter implements WorkerAdapter {
  readonly id = 'proof-worker';
  readonly kind = 'local-proof';
  readonly capabilities = ['echo-objective', 'report-authority'] as const;

  async run(request: WorkerRequest): Promise<WorkerResult> {
    if (request.signal.aborted) {
      throw new Error('Task was cancelled before the worker started.');
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 40);
      request.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Task was cancelled.'));
        },
        { once: true },
      );
    });

    return {
      text: [
        `Worker ${this.id} accepted a task from controller ${request.envelope.issuedBy.id}.`,
        `Objective: ${request.objective}`,
        `Acceptance criteria: ${request.envelope.acceptanceCriteria.join('; ')}`,
      ].join('\n'),
      metadata: {
        workerId: this.id,
        workerKind: this.kind,
      },
    };
  }
}
