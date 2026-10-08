export interface ControlState {
  roomEnabled: boolean;
  workerAwake: boolean;
}

export class ControlStateStore {
  private state: ControlState = {
    roomEnabled: false,
    workerAwake: false,
  };

  get(): ControlState {
    return { ...this.state };
  }

  update(patch: Partial<ControlState>): ControlState {
    const next = { ...this.state, ...patch };
    if (!next.roomEnabled) {
      next.workerAwake = false;
    }
    if (patch.workerAwake === true && !next.roomEnabled) {
      throw new Error('room_must_be_enabled');
    }
    this.state = next;
    return this.get();
  }
}
