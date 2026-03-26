import { useEffect, useRef } from 'react';

export default function useSSE(workflowId, handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!workflowId) return;

    const es = new EventSource(`/api/workflows/${workflowId}/events`);

    const events = ['state', 'thinking', 'text', 'tool', 'result', 'stream-end', 'error',
      'chat-message', 'auto-continue', 'model-info', 'rate-limit', 'log',
      'subagent-start', 'subagent-end', 'auto-pause', 'step-done',
      'session-stats', 'session-init'];

    for (const evt of events) {
      es.addEventListener(evt, (e) => {
        const key = 'on' + evt.charAt(0).toUpperCase() + evt.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        try {
          const data = JSON.parse(e.data);
          handlersRef.current[key]?.(data);
        } catch {}
      });
    }

    return () => es.close();
  }, [workflowId]);
}
