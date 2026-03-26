import { useEffect, useRef, useState } from 'react';
import { parseCommand, buildHelpText, COMMANDS } from '../utils/commands';

// Detect image tags in message content and render them
function renderContent(content) {
  const parts = content.split(/(\[img:\/[^\]]+\])/g);
  return parts.map((part, i) => {
    const imgMatch = part.match(/^\[img:(\/[^\]]+)\]$/);
    if (imgMatch) {
      return <img key={i} src={`/api/uploads${imgMatch[1].replace('/tmp/workflow-uploads', '')}`} alt="screenshot"
        className="max-w-full rounded-lg mt-1 max-h-60 cursor-pointer" onClick={() => window.open(`/api/uploads${imgMatch[1].replace('/tmp/workflow-uploads', '')}`, '_blank')} />;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function ChatPanel({ messages, streamBubble, onSend, isRunning, workflowStatus, onNext, onPrev, workflowId, onClearMessages, onSetRunning }) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]); // [{ data: base64, type: 'image/png', preview: dataUrl }]
  const [suggestions, setSuggestions] = useState([]);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages, streamBubble]);

  // Command autocomplete
  useEffect(() => {
    if (input.startsWith('/') && !input.includes(' ')) {
      const q = input.toLowerCase();
      const matches = Object.keys(COMMANDS).filter(c => c.startsWith(q));
      setSuggestions(matches.length > 0 && matches[0] !== input ? matches : []);
    } else {
      setSuggestions([]);
    }
  }, [input]);

  async function send(text) {
    const msg = text || input.trim();
    if (!msg && images.length === 0) return;

    // Check if it's a command
    const cmd = parseCommand(msg);
    if (cmd) {
      if (!text) setInput('');
      setSuggestions([]);
      await handleCommand(cmd, msg);
      return;
    }

    if (!text) setInput('');
    setSuggestions([]);
    onSend(msg || '请查看截图', images.length > 0 ? images : undefined);
    setImages([]);
  }

  async function handleCommand(cmd, rawText) {
    // Client-side commands
    if (cmd.command === '/help') {
      onClearMessages?.(prev => [...prev, { role: 'system', content: buildHelpText() }]);
      return;
    }

    if (cmd.command === '/clear') {
      onClearMessages?.([]);
      return;
    }

    if (cmd.command === '/retry') {
      // Find last user message and resend
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        onSend(lastUserMsg.content);
      }
      return;
    }

    // Server-side commands (app-level) or CLI commands (forwarded to Claude Code)
    if (cmd.scope === 'server' || cmd.scope === 'cli') {
      try {
        // Send the full raw text so CLI gets the complete command (e.g. "/model sonnet")
        const res = await fetch('/api/commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: cmd.raw || (cmd.args ? `${cmd.command} ${cmd.args}` : cmd.command),
            workflowId: workflowId ? parseInt(workflowId) : undefined,
          }),
        });
        const data = await res.json();
        onClearMessages?.(prev => [...prev, {
          role: 'system',
          content: `${cmd.command} → ${data.message}`,
        }]);

        // If cancel command, update running state
        if (cmd.command === '/cancel' && data.ok) {
          onSetRunning?.(false);
        }
      } catch (err) {
        onClearMessages?.(prev => [...prev, {
          role: 'system',
          content: `${cmd.command} 执行失败: ${err.message}`,
        }]);
      }
    }
  }

  function handleKeyDown(e) {
    // Tab to autocomplete
    if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      setInput(suggestions[0]);
      setSuggestions([]);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        fileToImage(file);
        return;
      }
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) fileToImage(file);
    e.target.value = '';
  }

  function fileToImage(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      setImages(prev => [...prev, { data: base64, type: file.type, preview: reader.result }]);
    };
    reader.readAsDataURL(file);
  }

  const isCommand = input.startsWith('/');

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Messages */}
      <div ref={ref} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          m.role === 'system' ? (
            <div key={i} className="flex justify-center">
              <div className="px-3 py-1.5 bg-gray-800/60 border border-gray-700/50 rounded-lg text-xs text-gray-400 whitespace-pre-wrap max-w-[90%] font-mono">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className={`max-w-[85%] ${m.role === 'user' ? 'ml-auto' : ''}`}>
              <div className="text-[11px] text-gray-500 mb-0.5">{m.role === 'user' ? '你' : 'AI'}</div>
              <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-purple-600 text-white rounded-br-sm' : 'bg-gray-800 text-gray-200 rounded-bl-sm'
              }`}>{renderContent(m.content)}</div>
            </div>
          )
        ))}

        {/* Streaming bubble */}
        {streamBubble && (
          <div className="max-w-[85%]">
            <div className="text-[11px] text-gray-500 mb-0.5">AI</div>
            {streamBubble.text ? (
              <div className="px-3 py-2 rounded-xl rounded-bl-sm bg-gray-800 text-gray-200 text-sm whitespace-pre-wrap">{streamBubble.text}</div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 text-purple-400 text-sm">
                <span className="flex gap-0.5">{[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />)}</span>
                思考中...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex gap-1.5 px-4 pb-2">
        {!isRunning && workflowStatus !== 'completed' && (
          <>
            <button onClick={onPrev} className="px-4 py-1.5 text-xs bg-gray-700 text-gray-300 rounded-full hover:bg-gray-600 font-semibold">
              ← 回退
            </button>
            <button onClick={() => onSend('开始')} className="px-4 py-1.5 text-xs bg-purple-600 text-white rounded-full hover:bg-purple-700 font-semibold">
              开始当前步骤
            </button>
            <button onClick={onNext} className="px-4 py-1.5 text-xs bg-green-600 text-white rounded-full hover:bg-green-700 font-semibold">
              下一步 →
            </button>
          </>
        )}
      </div>

      {/* Image preview */}
      {images.length > 0 && (
        <div className="flex gap-2 px-4 pb-2">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img src={img.preview} alt="preview" className="h-16 rounded-lg border border-gray-700" />
              <button onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 text-white rounded-full text-[10px] flex items-center justify-center">x</button>
            </div>
          ))}
        </div>
      )}

      {/* Command suggestions */}
      {suggestions.length > 0 && (
        <div className="mx-4 mb-1 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          {suggestions.map(cmd => (
            <button key={cmd} onClick={() => { setInput(cmd); setSuggestions([]); inputRef.current?.focus(); }}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-800 transition-colors">
              <span className="text-sm text-purple-400 font-mono">{cmd}</span>
              <span className="text-xs text-gray-500">{COMMANDS[cmd]?.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end px-4 pb-3 pt-2 border-t border-gray-800">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
        <button onClick={() => fileRef.current?.click()} disabled={isRunning}
          className="px-2 py-2 text-gray-500 hover:text-purple-400 disabled:opacity-50" title="上传图片">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
        </button>
        <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste}
          disabled={isRunning && !isCommand} placeholder={workflowStatus === 'completed' ? '输入消息或 / 命令...' : '输入消息或 / 命令...'} rows={1}
          className={`flex-1 px-3 py-2 bg-gray-900 border rounded-lg text-sm resize-none max-h-24 outline-none disabled:opacity-50 transition-colors ${
            isCommand ? 'border-purple-500/50 text-purple-300 font-mono' : 'border-gray-700 focus:border-purple-500'
          }`} />
        <button onClick={() => send()} disabled={(isRunning && !isCommand) || (!input.trim() && images.length === 0)}
          className="px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50">
          {isCommand ? '执行' : '发送'}
        </button>
      </div>
    </div>
  );
}
