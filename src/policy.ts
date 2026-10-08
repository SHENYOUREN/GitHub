import { Ajv2020 } from 'ajv/dist/2020.js';
import taskEnvelopeSchema from '../protocol/task-envelope.schema.json' with { type: 'json' };
import type { TaskEnvelope, WorkerMessageType } from './types.js';

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

const workerMessages = new Set<WorkerMessageType>([
  'status',
  'result',
  'question',
  'permission_request',
  'failure',
]);

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value: string) => Number.isFinite(Date.parse(value)),
});
const validateTaskEnvelope = ajv.compile<TaskEnvelope>(taskEnvelopeSchema);

export function parseControllerTask(value: unknown): TaskEnvelope {
  if (!validateTaskEnvelope(value)) {
    const detail = validateTaskEnvelope.errors
      ?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ');
    throw new PolicyError(`Invalid hierarchy task envelope: ${detail ?? 'unknown error'}`);
  }
  assertControllerTask(value);
  return value;
}

export function assertControllerTask(envelope: TaskEnvelope): void {
  if (envelope.protocolVersion !== '0.1') {
    throw new PolicyError('Unsupported hierarchy protocol version.');
  }

  if (envelope.issuedBy.role !== 'controller') {
    throw new PolicyError('Only a controller may issue a worker task.');
  }

  if (envelope.issuedBy.id !== envelope.authority.controllerId) {
    throw new PolicyError('The issuing principal does not own this task authority.');
  }

  if (!['worker', 'reviewer'].includes(envelope.assignedTo.role)) {
    throw new PolicyError('Tasks may only be assigned to a worker or reviewer.');
  }

  if (envelope.assignedTo.role !== envelope.authority.workerRole) {
    throw new PolicyError('Assigned role does not match the authority declaration.');
  }

  if (!envelope.objective.trim()) {
    throw new PolicyError('Task objective must not be empty.');
  }

  if (envelope.acceptanceCriteria.length === 0) {
    throw new PolicyError('At least one acceptance criterion is required.');
  }

  for (const messageType of envelope.authority.allowedWorkerMessages) {
    if (!workerMessages.has(messageType)) {
      throw new PolicyError(`Worker message type is not allowed: ${messageType}`);
    }
  }

  if (envelope.permissions.destructiveActions !== 'require-human-approval') {
    throw new PolicyError('Destructive actions must require human approval.');
  }

  const createdAt = Date.parse(envelope.createdAt);
  if (!Number.isFinite(createdAt)) {
    throw new PolicyError('createdAt must be a valid date-time.');
  }

  if (envelope.expiresAt) {
    const expiresAt = Date.parse(envelope.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new PolicyError('Task authorization has expired.');
    }
  }
}
