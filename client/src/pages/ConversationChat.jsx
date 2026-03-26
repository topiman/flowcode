import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { parseCommand, buildHelpText, COMMANDS } from '../utils/commands';

export default function ConversationChat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [streamBubble, setStreamBubble] = useState(null);
  const [parsedConfig, setParsedConfig] = useState(null);
  const [sessionStats, setSessionStats] = useState(null);
  const [sessionModel, setSessionModel] = useState('');
  const msgsRef = useRef(null);
  const inputRef = useRef(null);
  const eventSourceRef = useRef(null);

  // Load conversation
  useEffect(() => {
    let retryTimer;
    function loadConv() {
      fetch(`/api/conversations/${id}`).then(r => r.json()).then(data => {
        setConv(data);
        setMessages(data.messages || []);
        // If no messages yet (AI auto-start may still be running), retry after a delay
        if (!data.messages?.length && !retryTimer) {
          retryTimer = setTimeout(loadConv, 3000);
        }
      });
    }
    loadConv();
    // Load session stats from persistent process (if alive)
    fetch(`/api/conversations/${id}/session-stats`).then(r => r.json()).then(data => {
      if (data.stats) setSessionStats(data.stats);
      if (data.initInfo?.model) setSessionModel(data.initInfo.model);
    }).catch(() => {});
    return () => clearTimeout(retryTimer);
  }, [id]);

  // SSE
  useEffect(() => {
    if (!id) return;
    const es = new EventSource(`/api/conversations/${id}/events`);

    es.addEventListener('thinking', e => {
      const d = JSON.parse(e.data);
      setStreamBubble(prev => prev ? { ...prev, thinking: (prev.thinking || '') + d.text } : { thinking: d.text, text: '', tools: [] });
    });
    es.addEventListener('text', e => {
      const d = JSON.parse(e.data);
      setStreamBubble(prev => prev ? { ...prev, text: (prev.text || '') + d.text } : { thinking: '', text: d.text, tools: [] });
    });
    es.addEventListener('tool', e => {
      const d = JSON.parse(e.data);
      setStreamBubble(prev => prev ? { ...prev, tools: [...prev.tools, `${d.tool}: ${d.input || ''}`] } : { thinking: '', text: '', tools: [`${d.tool}: ${d.input || ''}`] });
    });
    es.addEventListener('chat-message', e => {
      const d = JSON.parse(e.data);
      if (d.role === 'assistant') {
        setStreamBubble(null);
        setMessages(prev => [...prev, d]);
        setIsRunning(false);
      }
    });
    es.addEventListener('stream-end', () => {
      setStreamBubble(null);
      setIsRunning(false);
    });
    es.addEventListener('config-parsed', e => {
      setParsedConfig(JSON.parse(e.data));
    });
    es.addEventListener('session-stats', e => {
      const d = JSON.parse(e.data);
      setSessionStats(prev => ({
        costUsd: (prev?.costUsd || 0) + (d.costUsd || 0),
        durationMs: (prev?.durationMs || 0) + (d.durationMs || 0),
        turns: (prev?.turns || 0) + (d.turns || 0),
      }));
    });
    es.addEventListener('session-init', e => {
      const d = JSON.parse(e.data);
      if (d.model) setSessionModel(d.model);
    });

    eventSourceRef.current = es;
    return () => es.close();
  }, [id]);

  // Scroll to bottom + keep focus on input
  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
    inputRef.current?.focus();
  }, [messages, streamBubble]);

  // Send message
  const [chatImages, setChatImages] = useState([]);
  const [chatFiles, setChatFiles] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const fileInputRef = useRef(null);

  // Command autocomplete
  useEffect(() => {
    if (input.startsWith('/') && !input.includes(' ')) {
      const q = input.toLowerCase();
      const matches = Object.keys(COMMANDS).filter(c => c.startsWith(q));
      const s = matches.length > 0 && matches[0] !== input ? matches : [];
      setSuggestions(s);
      setSelectedSuggestion(-1);
    } else {
      setSuggestions([]);
      setSelectedSuggestion(-1);
    }
  }, [input]);

  const handleCommand = useCallback(async (cmd) => {
    if (cmd.command === '/help') {
      setMessages(prev => [...prev, { role: 'system', content: buildHelpText() }]);
      return;
    }
    if (cmd.command === '/clear') {
      setMessages([]);
      return;
    }
    if (cmd.command === '/retry') {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        setInput(lastUserMsg.content);
        // Don't auto-send, let user review
      }
      return;
    }
    // Server-side commands (app-level) or CLI commands (forwarded to Claude Code)
    if (cmd.scope === 'server' || cmd.scope === 'cli') {
      try {
        const res = await fetch('/api/commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: cmd.raw || (cmd.args ? `${cmd.command} ${cmd.args}` : cmd.command),
            conversationId: parseInt(id),
          }),
        });
        const data = await res.json();
        setMessages(prev => [...prev, { role: 'system', content: `${cmd.command} → ${data.message}` }]);
        if (cmd.command === '/cancel' && data.ok) setIsRunning(false);
      } catch (err) {
        setMessages(prev => [...prev, { role: 'system', content: `${cmd.command} 失败: ${err.message}` }]);
      }
    }
  }, [id, messages]);

  const send = useCallback(async () => {
    const msg = input.trim() || (chatImages.length > 0 ? '请查看截图' : chatFiles.length > 0 ? '请查看上传的文件' : '');
    if (!msg && chatImages.length === 0 && chatFiles.length === 0) return;

    // Check command
    const cmd = parseCommand(msg);
    if (cmd) {
      setInput('');
      setSuggestions([]);
      await handleCommand(cmd);
      return;
    }

    if (isRunning) return;
    setInput('');
    setSuggestions([]);
    const attachments = [
      ...chatImages.map(() => '📷 图片'),
      ...chatFiles.map(f => `📄 ${f.name}`),
    ];
    const displayMsg = attachments.length > 0 ? `${attachments.join('  ')}\n\n${msg}` : msg;
    setMessages(prev => [...prev, { role: 'user', content: displayMsg }]);
    setIsRunning(true);
    const imagesToSend = chatImages.length > 0 ? chatImages : undefined;
    const filesToSend = chatFiles.length > 0 ? chatFiles : undefined;
    setChatImages([]);
    setChatFiles([]);
    setTimeout(() => inputRef.current?.focus(), 0);
    setStreamBubble({ thinking: '', text: '', tools: [] });

    await fetch(`/api/conversations/${id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, images: imagesToSend, files: filesToSend }),
    });
  }, [id, input, isRunning, chatImages, chatFiles, handleCommand]);

  function handleConvPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = () => {
          setChatImages(prev => [...prev, { data: reader.result.split(',')[1], type: file.type, preview: reader.result }]);
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  }

  function handleFileSelect(e) {
    const selectedFiles = Array.from(e.target.files || []);
    for (const file of selectedFiles) {
      const reader = new FileReader();
      if (file.type.startsWith('image/')) {
        reader.onload = () => {
          setChatImages(prev => [...prev, { data: reader.result.split(',')[1], type: file.type, preview: reader.result }]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          setChatFiles(prev => [...prev, { data: reader.result.split(',')[1], name: file.name, type: file.type }]);
        };
        reader.readAsDataURL(file);
      }
    }
    e.target.value = '';
  }

  // Create project from conversation
  const createProject = useCallback(async () => {
    if (!conv) return;

    // Reload conversation to get latest parsed config
    const latestConv = await fetch(`/api/conversations/${id}`).then(r => r.json());
    const projectName = latestConv.project_name;
    const isIteration = !!latestConv.project_id;

    if (!projectName) {
      alert('需求简报中未找到项目名称，请继续和 AI 沟通确定项目名称。');
      return;
    }

    let res;
    if (isIteration) {
      const project = await fetch('/api/projects').then(r => r.json()).then(ps => ps.find(p => p.id === latestConv.project_id));
      res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: project.name, description: projectName, conversationId: parseInt(id) }),
      });
    } else {
      res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, conversationId: parseInt(id) }),
      });
    }

    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    navigate(`/workflow/${data.workflowId}`);
  }, [conv, id, navigate]);

  if (!conv) return <div className="flex items-center justify-center h-screen text-gray-500">加载中...</div>;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white text-sm">← 返回</button>
          <h1 className="text-lg font-semibold">{conv.name}</h1>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
            conv.status === 'chatting' ? 'bg-purple-500/20 text-purple-400' :
            conv.status === 'confirmed' ? 'bg-green-500/20 text-green-400' :
            'bg-gray-500/20 text-gray-400'
          }`}>{conv.status === 'chatting' ? '沟通中' : conv.status === 'confirmed' ? '已确认' : '已归档'}</span>
        </div>
        <div className="flex items-center gap-2">
          {parsedConfig && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              {parsedConfig.project_name && <span className="px-2 py-0.5 bg-gray-800 rounded">{parsedConfig.project_name}</span>}
              {parsedConfig.template_name && <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded">{parsedConfig.template_name}</span>}
              {parsedConfig.tech_stack && <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                {(() => { try { const t = JSON.parse(parsedConfig.tech_stack); return [t.frontend, t.backend, t.database].filter(Boolean).join(' + '); } catch { return ''; } })()}
              </span>}
              {parsedConfig.skills && <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded">
                {(() => { try { return JSON.parse(parsedConfig.skills).length + ' skills'; } catch { return ''; } })()}
              </span>}
            </div>
          )}
          {/* Session stats */}
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            {sessionModel && (
              <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-medium">
                {sessionModel.includes('opus') ? 'Opus' : sessionModel.includes('sonnet') ? 'Sonnet' : sessionModel.includes('haiku') ? 'Haiku' : ''}
              </span>
            )}
            {sessionStats?.costUsd > 0 && (
              <span className="text-amber-400/80">${sessionStats.costUsd < 0.01 ? sessionStats.costUsd.toFixed(4) : sessionStats.costUsd.toFixed(2)}</span>
            )}
            {sessionStats?.turns > 0 && (
              <span className="text-gray-600">{sessionStats.turns} turns</span>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={msgsRef} className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && !streamBubble && (
          <div className="text-center text-gray-500 mt-20">
            <div className="flex items-center justify-center gap-2">
              <span className="flex gap-0.5">{[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" style={{animationDelay:`${i*0.2}s`}} />)}</span>
              <span className="text-sm text-purple-400">AI 需求分析师准备中...</span>
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          m.role === 'system' ? (
            <div key={i} className="flex justify-center">
              <div className="px-3 py-1.5 bg-gray-800/60 border border-gray-700/50 rounded-lg text-xs text-gray-400 whitespace-pre-wrap max-w-[90%] font-mono">
                {m.content}
              </div>
            </div>
          ) : m.role === 'user' ? (
            <div key={i} className="max-w-[80%] ml-auto">
              <div className="text-[11px] text-gray-500 mb-0.5 text-right">你</div>
              <div className="px-4 py-2.5 bg-purple-600 text-white rounded-xl rounded-br-sm text-sm whitespace-pre-wrap">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="max-w-[80%]">
              <div className="text-[11px] text-gray-500 mb-0.5">AI 需求分析师</div>
              <div className="px-4 py-2.5 bg-gray-800 text-gray-200 rounded-xl rounded-bl-sm text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
            </div>
          )
        ))}

        {/* Streaming bubble */}
        {streamBubble && (
          <div className="max-w-[80%]">
            <div className="text-[11px] text-gray-500 mb-0.5">AI 需求分析师</div>
            {streamBubble.thinking && (
              <div className="text-xs text-purple-400/60 bg-purple-500/5 border-l-2 border-purple-500 px-3 py-1.5 rounded-r-md mb-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap">{streamBubble.thinking}</div>
            )}
            {streamBubble.tools.map((t, i) => (
              <div key={i} className="text-xs text-blue-400 bg-blue-500/5 px-3 py-1 rounded-md mb-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />{t}
              </div>
            ))}
            {streamBubble.text ? (
              <div className="px-4 py-2.5 bg-gray-800 text-gray-200 rounded-xl rounded-bl-sm text-sm whitespace-pre-wrap">{streamBubble.text}</div>
            ) : !streamBubble.thinking && (
              <div className="flex items-center gap-2 px-4 py-2 text-purple-400 text-sm">
                <span className="flex gap-0.5">{[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" style={{animationDelay:`${i*0.2}s`}} />)}</span>
                思考中...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Attachments preview */}
      {(chatImages.length > 0 || chatFiles.length > 0) && (
        <div className="flex gap-2 px-6 pb-2 flex-wrap">
          {chatImages.map((img, i) => (
            <div key={`img-${i}`} className="relative">
              <img src={img.preview} alt="preview" className="h-16 rounded-lg border border-gray-700" />
              <button onClick={() => setChatImages(prev => prev.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 text-white rounded-full text-[10px] flex items-center justify-center">x</button>
            </div>
          ))}
          {chatFiles.map((file, i) => (
            <div key={`file-${i}`} className="relative flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300">
              <span>📄</span>
              <span className="max-w-[120px] truncate">{file.name}</span>
              <button onClick={() => setChatFiles(prev => prev.filter((_, j) => j !== i))}
                className="ml-1 w-4 h-4 bg-red-600 text-white rounded-full text-[10px] flex items-center justify-center shrink-0">x</button>
            </div>
          ))}
        </div>
      )}

      {/* Create project button */}
      {conv.status === 'chatting' && (
        <div className="px-6 py-3 border-t border-gray-800 bg-gray-900/50">
          {parsedConfig?.project_name && parsedConfig?.template_name ? (
            <button onClick={createProject} disabled={isRunning}
              className="w-full py-3 bg-green-600 text-white text-base font-semibold rounded-xl hover:bg-green-700 transition disabled:opacity-50">
              确认需求 → 创建项目「{parsedConfig.project_name}」
            </button>
          ) : (
            <div className="w-full py-3 bg-gray-800 text-gray-500 text-sm text-center rounded-xl">
              继续和 AI 沟通，确定项目名称和工作流模板后即可创建项目
            </div>
          )}
        </div>
      )}

      {/* Command suggestions */}
      {suggestions.length > 0 && (
        <div className="mx-6 mb-1 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          {suggestions.map((cmd, i) => (
            <button key={cmd} onClick={() => { setInput(cmd); setSuggestions([]); setSelectedSuggestion(-1); inputRef.current?.focus(); }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === selectedSuggestion ? 'bg-gray-800' : 'hover:bg-gray-800'}`}>
              <span className="text-sm text-purple-400 font-mono">{cmd}</span>
              <span className="text-xs text-gray-500">{COMMANDS[cmd]?.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <input ref={fileInputRef} type="file" multiple accept=".md,.txt,.json,.yaml,.yml,.csv,.xml,.html,.css,.js,.ts,.jsx,.tsx,.py,.go,.rs,.java,.sh,.sql,.env,.toml,.ini,.cfg,image/*" className="hidden" onChange={handleFileSelect} />
      <div className="flex gap-2 items-end px-6 py-4 border-t border-gray-800">
        <button onClick={() => fileInputRef.current?.click()} title="上传文件"
          className="px-2.5 py-2.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-xl transition-colors shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onPaste={handleConvPaste}
          onKeyDown={e => {
            if (suggestions.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedSuggestion(prev => (prev + 1) % suggestions.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedSuggestion(prev => prev <= 0 ? suggestions.length - 1 : prev - 1); return; }
              if (e.key === 'Tab' || (e.key === 'Enter' && selectedSuggestion >= 0)) { e.preventDefault(); setInput(suggestions[selectedSuggestion >= 0 ? selectedSuggestion : 0]); setSuggestions([]); setSelectedSuggestion(-1); return; }
              if (e.key === 'Escape') { setSuggestions([]); setSelectedSuggestion(-1); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
          disabled={isRunning && !input.startsWith('/')} placeholder="描述你的需求...（输入 / 查看命令）" rows={1}
          className={`flex-1 px-4 py-2.5 bg-gray-900 border rounded-xl text-sm resize-none max-h-32 outline-none disabled:opacity-50 transition-colors ${
            input.startsWith('/') ? 'border-purple-500/50 text-purple-300 font-mono' : 'border-gray-700 focus:border-purple-500'
          }`} />
        <button onClick={send} disabled={(isRunning && !input.startsWith('/')) || (!input.trim() && chatImages.length === 0 && chatFiles.length === 0)}
          className="px-5 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 disabled:opacity-50">
          {input.startsWith('/') ? '执行' : '发送'}
        </button>
      </div>

      {/* Bottom status bar */}
      {(sessionModel || sessionStats) && (
        <div className="flex items-center gap-3 px-6 py-1.5 border-t border-gray-800 text-[11px] text-gray-500 shrink-0">
          {isRunning && <span className="w-2.5 h-2.5 border-[1.5px] border-gray-700 border-t-purple-500 rounded-full animate-spin" />}
          {sessionModel && (
            <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-medium">
              {sessionModel.includes('opus') ? 'Opus' : sessionModel.includes('sonnet') ? 'Sonnet' : sessionModel.includes('haiku') ? 'Haiku' : sessionModel}
            </span>
          )}
          {sessionStats?.costUsd > 0 && (
            <span className="text-amber-400/80">
              ${sessionStats.costUsd < 0.01 ? sessionStats.costUsd.toFixed(4) : sessionStats.costUsd.toFixed(2)}
            </span>
          )}
          {sessionStats?.turns > 0 && (
            <span className="text-gray-600">{sessionStats.turns} turns</span>
          )}
          {sessionStats?.durationMs > 0 && (
            <span className="text-gray-600">
              {sessionStats.durationMs < 60000
                ? `${Math.floor(sessionStats.durationMs / 1000)}s`
                : `${Math.floor(sessionStats.durationMs / 60000)}m ${Math.floor((sessionStats.durationMs % 60000) / 1000)}s`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
