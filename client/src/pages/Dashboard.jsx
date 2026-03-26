import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import useSSE from '../hooks/useSSE';
import Sidebar from '../components/Sidebar';
import LogViewer from '../components/LogViewer';
import ChatPanel from '../components/ChatPanel';
import StatusBar from '../components/StatusBar';

export default function Dashboard() {
  const { id } = useParams();
  const [workflow, setWorkflow] = useState(null);
  const [steps, setSteps] = useState([]);
  const [messages, setMessages] = useState([]);
  const [logEntries, setLogEntries] = useState([]);
  const [subagentEntries, setSubagentEntries] = useState([]);
  const [currentSubagent, setCurrentSubagent] = useState(null); // { description }
  const [historicalLog, setHistoricalLog] = useState(null);
  const [viewingStep, setViewingStep] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [streamBubble, setStreamBubble] = useState(null);
  const [sessionStats, setSessionStats] = useState(null); // { costUsd, durationMs, usage, modelUsage }
  const [sessionInit, setSessionInit] = useState(null);   // { model, sessionId, version }
  const cancelledRef = useRef(false);
  const splitRef = useRef(null);

  // Load workflow data + check if running
  useEffect(() => {
    fetch(`/api/workflows/${id}`).then(r => r.json()).then(data => {
      setWorkflow(data);
      setSteps(data.steps || []);
      setAutoMode(!!data.auto_mode);
      if (data.isRunning) {
        setIsRunning(true);
        setStreamBubble({ thinking: '', text: '', tools: [] });
      }
    });
    fetch(`/api/workflows/${id}/chat`).then(r => r.json()).then(setMessages);
    // Load session stats from persistent process (if alive)
    fetch(`/api/workflows/${id}/session-stats`).then(r => r.json()).then(data => {
      if (data.stats) setSessionStats(data.stats);
      if (data.initInfo) setSessionInit(data.initInfo);
    }).catch(() => {});
  }, [id]);

  // SSE events
  useSSE(id, {
    onState: (state) => {
      setWorkflow(prev => {
        if (!prev) return prev;
        const updates = {};
        if (state.status !== undefined) updates.status = state.status;
        if (state.currentStep !== undefined) updates.current_step = state.currentStep;
        return { ...prev, ...updates };
      });
      // Update steps from state
      if (state.steps) {
        setSteps(prev => prev.map(s => {
          const update = state.steps[s.step_name];
          return update ? { ...s, status: update.status, retries: update.retries || 0 } : s;
        }));
      }
    },
    onThinking: (d) => {
      if (cancelledRef.current) return;
      setIsRunning(true);
      const entry = { type: 'thinking', text: d.text };
      if (d.subagent) {
        setSubagentEntries(prev => [...prev, entry]);
      } else {
        setLogEntries(prev => [...prev, entry]);
      }
      setStreamBubble(prev => prev ? { ...prev, thinking: (prev.thinking || '') + d.text } : { thinking: d.text, text: '', tools: [] });
    },
    onText: (d) => {
      if (cancelledRef.current) return;
      const entry = { type: 'text', text: d.text };
      if (d.subagent) {
        setSubagentEntries(prev => [...prev, entry]);
      } else {
        setLogEntries(prev => [...prev, entry]);
      }
      setStreamBubble(prev => prev ? { ...prev, text: (prev.text || '') + d.text } : { thinking: '', text: d.text, tools: [] });
    },
    onTool: (d) => {
      if (cancelledRef.current) return;
      const entry = { type: 'tool', tool: d.tool, input: d.input || '', text: `[${d.tool}] ${d.input || ''}\n` };
      if (d.subagent) {
        setSubagentEntries(prev => [...prev, entry]);
      } else {
        setLogEntries(prev => [...prev, entry]);
      }
      setStreamBubble(prev => prev ? { ...prev, tools: [...prev.tools, `${d.tool}: ${d.input || ''}`] } : { thinking: '', text: '', tools: [`${d.tool}: ${d.input || ''}`] });
    },
    onSubagentStart: (d) => {
      const modelShort = d.model?.includes('opus') ? 'Opus' : d.model?.includes('sonnet') ? 'Sonnet' : d.model?.includes('haiku') ? 'Haiku' : '';
      setCurrentSubagent({ description: d.description || 'Subagent', model: modelShort });
      setSubagentEntries([]);
    },
    onSubagentEnd: () => {
      setCurrentSubagent(null);
    },
    onResult: () => {
      setStreamBubble(null);
      setCurrentSubagent(null);
    },
    onStreamEnd: () => {
      setIsRunning(false);
      setStreamBubble(null);
      setCurrentSubagent(null);
    },
    onChatMessage: (d) => {
      // Server-persisted message (might duplicate onResult, dedupe by checking last)
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === d.role && last?.content === d.content) return prev;
        return [...prev, { role: d.role, content: d.content }];
      });
    },
    onAutoContinue: (d) => {
      cancelledRef.current = false;
      setIsRunning(true);
      setMessages(prev => [...prev, { role: 'system', content: `自动继续: ${d.nextStep || '下一步'}` }]);
      setLogEntries([]);
      setSubagentEntries([]);
      setStreamBubble({ thinking: '', text: '', tools: [] });
    },
    onAutoPause: (d) => {
      setMessages(prev => [...prev, { role: 'system', content: `自动模式暂停: ${d.reason}` }]);
      setIsRunning(false);
      setStreamBubble(null);
    },
    onError: (d) => {
      setMessages(prev => [...prev, { role: 'system', content: 'Error: ' + d.message }]);
      setIsRunning(false);
    },
    onSessionStats: (d) => {
      setSessionStats(prev => ({
        costUsd: (prev?.costUsd || 0) + (d.costUsd || 0),
        durationMs: (prev?.durationMs || 0) + (d.durationMs || 0),
        durationApiMs: (prev?.durationApiMs || 0) + (d.durationApiMs || 0),
        turns: (prev?.turns || 0) + (d.turns || 0),
        usage: d.usage || prev?.usage || {},
        modelUsage: d.modelUsage || prev?.modelUsage || {},
      }));
    },
    onSessionInit: (d) => {
      setSessionInit(d);
    },
  });

  // Send message
  const sendMessage = useCallback(async (text, images) => {
    cancelledRef.current = false;
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    if (!isRunning) {
      setIsRunning(true);
      setStreamBubble({ thinking: '', text: '', tools: [] });
      setLogEntries([]);
      setSubagentEntries([]);
      setCurrentSubagent(null);
    }
    if (viewingStep) { setViewingStep(null); setHistoricalLog(null); }

    await fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: parseInt(id), message: text, images }),
    });
  }, [id, viewingStep]);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState(null);
  // Generic confirm dialog: { title, message, confirmLabel, confirmColor, onConfirm }
  const [simpleConfirm, setSimpleConfirm] = useState(null);

  // Next step (with confirmation)
  const handleNext = useCallback(async () => {
    // Check outputs first
    const checkRes = await fetch(`/api/workflows/${id}/check-outputs`);
    const checkData = await checkRes.json();

    const hasOutputs = checkData.outputs && checkData.outputs.length > 0;
    const allExist = hasOutputs && checkData.outputs.every(o => o.exists);
    const hasMissing = hasOutputs && checkData.outputs.some(o => !o.exists);

    // Show confirmation dialog
    setConfirmDialog({
      step: checkData.label || checkData.step,
      outputs: checkData.outputs || [],
      hasMissing,
      onConfirm: async () => {
        setConfirmDialog(null);
        const res = await fetch(`/api/workflows/${id}/next`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          setMessages(prev => [...prev, { role: 'system', content: data.error || '操作失败' }]);
          return;
        }
        if (data.completed) {
          setWorkflow(prev => prev ? { ...prev, status: 'completed' } : prev);
          setMessages(prev => [...prev, { role: 'system', content: '工作流已全部完成' }]);
        } else {
          cancelledRef.current = false;
          setIsRunning(true);
          setLogEntries([]);
          setSubagentEntries([]);
          setCurrentSubagent(null);
          setStreamBubble({ thinking: '', text: '', tools: [] });
        }
      },
      onCancel: () => setConfirmDialog(null),
    });
  }, [id]);

  // Go back to previous step (with confirmation)
  const handlePrev = useCallback(() => {
    setSimpleConfirm({
      title: '回退到上一步',
      message: '当前步骤将被重置为等待状态，上一步可恢复对话。',
      confirmLabel: '确认回退',
      confirmColor: 'bg-gray-600 hover:bg-gray-700',
      onConfirm: async () => {
        setSimpleConfirm(null);
        const res = await fetch(`/api/workflows/${id}/prev`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          setMessages(prev => [...prev, { role: 'system', content: data.error || '无法回退' }]);
          return;
        }
        setMessages(prev => [...prev, { role: 'system', content: `已回退到: ${data.prevStep}` }]);
        setIsRunning(false);
        setLogEntries([]);
        setSubagentEntries([]);
        setCurrentSubagent(null);
        const wfRes = await fetch(`/api/workflows/${id}`);
        const wfData = await wfRes.json();
        setWorkflow(wfData);
        setSteps(wfData.steps || []);
      },
    });
  }, [id]);

  // View step log
  const viewStepLog = useCallback(async (stepName) => {
    setViewingStep(stepName);
    const res = await fetch(`/api/workflows/${id}/steps/${stepName}/log`);
    const data = await res.json();
    setHistoricalLog(data.log || '暂无日志记录');
  }, [id]);

  // Cancel
  const cancel = useCallback(() => {
    setSimpleConfirm({
      title: '取消当前任务',
      message: '将强制终止正在执行的 AI 任务，已完成的部分不受影响。',
      confirmLabel: '确认取消',
      confirmColor: 'bg-red-600 hover:bg-red-700',
      onConfirm: async () => {
        setSimpleConfirm(null);
        cancelledRef.current = true;
        await fetch(`/api/workflows/${id}/cancel`, { method: 'POST' });
        setIsRunning(false);
        setStreamBubble(null);
      },
    });
  }, [id]);

  // Toggle auto mode
  const toggleAuto = useCallback(async () => {
    const next = !autoMode;
    setAutoMode(next);
    await fetch(`/api/workflows/${id}/auto-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
  }, [id, autoMode]);

  // Reset session
  const resetSession = useCallback(() => {
    setSimpleConfirm({
      title: '重置 Session',
      message: '将清除当前会话，工作流状态不受影响。下次发消息将开始新会话。',
      confirmLabel: '确认重置',
      confirmColor: 'bg-amber-600 hover:bg-amber-700',
      onConfirm: async () => {
        setSimpleConfirm(null);
        await fetch(`/api/workflows/${id}/reset-session`, { method: 'POST' });
        setMessages(prev => [...prev, { role: 'system', content: 'Session 已重置' }]);
      },
    });
  }, [id]);

  // Drag to resize
  useEffect(() => {
    const el = splitRef.current;
    if (!el) return;
    const handle = el.querySelector('[data-handle]');
    if (!handle) return;

    let dragging = false;
    const onDown = (e) => { dragging = true; e.preventDefault(); document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'; };
    const onMove = (e) => {
      if (!dragging) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(10, Math.min(90, ((e.clientY - rect.top) / rect.height) * 100));
      el.querySelector('[data-log]').style.height = pct + '%';
      el.querySelector('[data-chat]').style.height = (100 - pct) + '%';
    };
    const onUp = () => { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; };

    handle.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { handle.removeEventListener('mousedown', onDown); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [workflow]);

  if (!workflow) return <div className="flex items-center justify-center h-screen text-gray-500">加载中...</div>;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 shrink-0">
        <Link to="/" className="text-lg font-semibold text-gray-200 hover:text-white">Workflow Dashboard</Link>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={autoMode} onChange={toggleAuto} className="sr-only peer" />
            <div className="w-8 h-[18px] bg-gray-700 rounded-full peer-checked:bg-green-500 relative after:absolute after:top-0.5 after:left-0.5 after:w-3.5 after:h-3.5 after:bg-gray-400 after:rounded-full after:transition-all peer-checked:after:translate-x-3.5 peer-checked:after:bg-white" />
            全自动
          </label>
          {autoMode && <span className="text-[11px] text-green-400/70">关闭网页不影响执行</span>}
          <button onClick={resetSession} className="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:border-purple-500">重置 Session</button>
          <Link to="/" className="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:border-purple-500">+ 迭代</Link>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        <Sidebar workflow={workflow} steps={steps} onStepClick={viewStepLog} viewingStep={viewingStep} />

        <div className="flex-1 flex flex-col min-h-0">
          <div ref={splitRef} className="flex-1 flex flex-col min-h-0">
            {/* Log pane */}
            <div data-log style={{ height: '50%' }} className="min-h-[60px] overflow-hidden flex flex-col">
              <div className="px-4 py-1.5 text-[11px] border-b border-gray-800 shrink-0 flex items-center gap-2">
                {viewingStep ? (
                  <>
                    <span className="text-gray-500">日志: {viewingStep}</span>
                    <button onClick={() => { setViewingStep(null); setHistoricalLog(null); }} className="text-gray-600 hover:text-gray-400">✕ 返回实时</button>
                  </>
                ) : currentSubagent ? (
                  <>
                    <span className="text-purple-400 font-medium">{currentSubagent.description}</span>
                    {currentSubagent.model && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{currentSubagent.model}</span>}
                    <span className="text-purple-500/60 text-[10px] animate-pulse">● 执行中</span>
                  </>
                ) : (
                  <>
                    <span className="text-gray-500">执行日志</span>
                    {isRunning && logEntries.length > 0 && (
                      <span className="text-purple-500/60 text-[10px]">● LIVE</span>
                    )}
                  </>
                )}
              </div>
              <LogViewer
                entries={currentSubagent ? subagentEntries : logEntries}
                historicalLog={viewingStep ? historicalLog : null}
              />
            </div>

            {/* Drag handle */}
            <div data-handle className="h-1.5 bg-gray-800 cursor-row-resize hover:bg-purple-600 transition-colors shrink-0 flex items-center justify-center">
              <div className="w-8 h-0.5 bg-gray-600 rounded" />
            </div>

            {/* Chat pane */}
            <div data-chat style={{ height: '50%' }} className="min-h-[60px] overflow-hidden flex flex-col">
              <div className="px-4 py-1.5 text-[11px] text-gray-500 border-b border-gray-800 shrink-0">对话</div>
              <ChatPanel messages={messages} streamBubble={streamBubble} onSend={sendMessage} isRunning={isRunning} workflowStatus={workflow?.status} onNext={handleNext} onPrev={handlePrev}
                workflowId={id} onClearMessages={setMessages} onSetRunning={setIsRunning} />
            </div>
          </div>

          <StatusBar workflow={workflow} isRunning={isRunning} onCancel={cancel} sessionStats={sessionStats} sessionInit={sessionInit} />
        </div>
      </div>

      {/* Confirm next step dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={confirmDialog.onCancel}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-3">确认推进到下一步</h3>
            <p className="text-sm text-gray-400 mb-4">当前步骤: <span className="text-white">{confirmDialog.step}</span></p>

            {confirmDialog.outputs.length > 0 ? (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2">输出文件状态:</p>
                <div className="space-y-1.5">
                  {confirmDialog.outputs.map((o, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className={o.exists ? 'text-green-400' : 'text-red-400'}>{o.exists ? '\u2713' : '\u2717'}</span>
                      <span className={o.exists ? 'text-gray-300' : 'text-red-300'}>{o.file}</span>
                    </div>
                  ))}
                </div>
                {confirmDialog.hasMissing && (
                  <p className="mt-2 text-xs text-amber-400">部分输出文件尚未生成，确定要推进吗？</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500 mb-4">该步骤没有声明输出文件</p>
            )}

            <div className="flex gap-3 justify-end">
              <button onClick={confirmDialog.onCancel} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition">取消</button>
              <button onClick={confirmDialog.onConfirm} className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${confirmDialog.hasMissing ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'} text-white`}>
                确认推进
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generic confirm dialog */}
      {simpleConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setSimpleConfirm(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">{simpleConfirm.title}</h3>
            <p className="text-sm text-gray-400 mb-5">{simpleConfirm.message}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setSimpleConfirm(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition">取消</button>
              <button onClick={simpleConfirm.onConfirm} className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${simpleConfirm.confirmColor || 'bg-purple-600 hover:bg-purple-700'} text-white`}>
                {simpleConfirm.confirmLabel || '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
