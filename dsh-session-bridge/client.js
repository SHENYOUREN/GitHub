window.__ModuleLoader__.load({
  id: '@local/taskroom-session-bridge',
  factory() {
    const STATUS_URL = 'http://127.0.0.1:4311/ui-api/worker-session';
    const POLL_INTERVAL_MS = 2_000;

    return {
      inject: ['uiWorkspace'],
      apply(ctx) {
        let stopped = false;
        let timer = null;
        let openedSessionId = null;

        const poll = async () => {
          if (stopped) return;
          try {
            const response = await fetch(STATUS_URL, { cache: 'no-store' });
            if (!response.ok) return;
            const session = await response.json();
            if (!session.connected || typeof session.sessionId !== 'string' || !session.sessionId) return;
            if (session.sessionId === openedSessionId) return;
            openedSessionId = session.sessionId;
            ctx.uiWorkspace.openSession(session.sessionId);
          } catch {
            // The task room may be closed; the next poll reconnects quietly.
          }
        };

        void poll();
        timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
        ctx.effect(() => () => {
          stopped = true;
          if (timer !== null) window.clearInterval(timer);
        });
      },
    };
  },
});
