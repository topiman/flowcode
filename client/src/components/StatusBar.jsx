const STEP_LABELS = {
  'agent-01-requirement': '需求沟通', 'agent-02-brd': '商业需求文档',
  'agent-03-prd': '产品需求文档', 'agent-04-tech-design': '技术方案设计',
  'commit-docs': '提交文档', 'agent-05-tdd': 'TDD 编码',
  'agent-06-code-review': '代码审查', 'agent-07-e2e-test': 'E2E 测试',
  'agent-08-deploy': '部署上线',
};

function formatDuration(ms) {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatCost(usd) {
  if (!usd) return '';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function getModelShort(modelId) {
  if (!modelId) return '';
  if (modelId.includes('opus')) return 'Opus';
  if (modelId.includes('sonnet')) return 'Sonnet';
  if (modelId.includes('haiku')) return 'Haiku';
  return modelId.split('-').pop();
}

export default function StatusBar({ workflow, isRunning, onCancel, sessionStats, sessionInit }) {
  if (!workflow) return null;

  // Extract token usage from modelUsage (more detailed) or usage
  const usage = sessionStats?.usage || {};
  const inputTokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  const outputTokens = usage.output_tokens || 0;

  // Model from session init or from modelUsage keys
  const model = sessionInit?.model || (sessionStats?.modelUsage ? Object.keys(sessionStats.modelUsage)[0] : '');
  const modelShort = getModelShort(model);

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-t border-gray-800 text-[11px] text-gray-500 shrink-0">
      {/* Left: step status */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <>
            <span className="w-3 h-3 border-[1.5px] border-gray-700 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-gray-400">{STEP_LABELS[workflow.current_step] || workflow.current_step}</span>
          </>
        ) : workflow.status === 'completed' ? (
          <span className="text-green-400">工作流已完成</span>
        ) : workflow.status === 'paused' ? (
          <span className="text-yellow-400">已暂停</span>
        ) : (
          <span>{STEP_LABELS[workflow.current_step] || workflow.current_step}</span>
        )}
      </div>

      <span className="flex-1" />

      {/* Right: session stats */}
      <div className="flex items-center gap-3">
        {modelShort && (
          <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-medium">{modelShort}</span>
        )}

        {sessionStats?.costUsd > 0 && (
          <span className="text-amber-400/80" title="本次会话累计费用">
            {formatCost(sessionStats.costUsd)}
          </span>
        )}

        {(inputTokens > 0 || outputTokens > 0) && (
          <span title={`输入 ${formatTokens(inputTokens)} / 输出 ${formatTokens(outputTokens)}`}>
            <span className="text-blue-400/60">{formatTokens(inputTokens)}</span>
            <span className="text-gray-600 mx-0.5">/</span>
            <span className="text-green-400/60">{formatTokens(outputTokens)}</span>
          </span>
        )}

        {sessionStats?.turns > 0 && (
          <span className="text-gray-600" title="对话轮数">{sessionStats.turns} turns</span>
        )}

        {sessionStats?.durationMs > 0 && (
          <span className="text-gray-600" title="累计执行时间">{formatDuration(sessionStats.durationMs)}</span>
        )}

        {sessionInit?.version && (
          <span className="text-gray-700" title="Claude Code 版本">v{sessionInit.version}</span>
        )}

        {isRunning && (
          <button onClick={onCancel} className="px-2.5 py-0.5 text-red-400 border border-red-400/40 rounded hover:bg-red-500/10 transition-colors">
            取消
          </button>
        )}
      </div>
    </div>
  );
}
