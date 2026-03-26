const LABELS = {
  'agent-01-requirement': '需求沟通', 'agent-02-brd': '商业需求文档',
  'agent-03-prd': '产品需求文档', 'agent-04-tech-design': '技术方案设计',
  'commit-docs': '提交文档', 'agent-05-tdd': 'TDD 编码',
  'agent-05-tdd-backend': 'TDD 后端', 'agent-05-tdd-frontend': 'TDD 前端',
  'agent-05-incremental': '增量开发',
  'agent-06-code-review': '代码审查', 'agent-07-e2e-test': 'E2E 测试',
  'agent-08-deploy': '部署上线', 'agent-08-deploy-local': '本地部署',
};
const STATUS = { completed: '已完成', 'in-progress': '进行中', 'gate-failed': '门禁失败', paused: '已暂停', pending: '等待中' };

export default function Pipeline({ steps, currentStep, onStepClick, viewingStep }) {
  return (
    <div className="mt-4">
      {steps.map((step, i) => {
        const st = step.status || 'pending';
        const isCurrent = step.step_name === currentStep;
        const isViewing = step.step_name === viewingStep;
        const prevDone = i > 0 && steps[i - 1].status === 'completed';
        const thisDone = st === 'completed';
        const dotColor = st === 'completed' ? 'bg-green-500 border-green-500'
          : st === 'in-progress' ? 'bg-purple-500 border-purple-500 shadow-[0_0_0_3px_rgba(108,92,231,0.3)]'
          : st === 'gate-failed' ? 'bg-red-500 border-red-500' : 'border-gray-700';

        return (
          <div key={step.id} className={`flex items-stretch cursor-pointer ${isViewing ? 'bg-gray-800/50 rounded' : ''}`}
            onClick={() => st !== 'pending' && onStepClick(step.step_name)}>
            <div className="w-7 flex flex-col items-center shrink-0">
              <div className={`w-0.5 flex-1 ${i === 0 ? 'bg-transparent' : prevDone || thisDone ? 'bg-green-500' : 'bg-gray-700'}`} />
              <div className={`w-3 h-3 rounded-full border-2 ${dotColor} shrink-0`} />
              <div className={`w-0.5 flex-1 ${i === steps.length - 1 ? 'bg-transparent' : thisDone ? 'bg-green-500' : 'bg-gray-700'}`} />
            </div>
            <div className="py-1.5 pl-2.5 flex-1 min-h-[40px] flex flex-col justify-center">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium">{LABELS[step.step_name] || step.step_name}</span>
                {step.model && <span className="text-[9px] px-1 py-0.5 rounded bg-gray-800 text-gray-500">{step.model.includes('opus') ? 'Opus' : step.model.includes('sonnet') ? 'Sonnet' : step.model.includes('haiku') ? 'Haiku' : step.model}</span>}
              </div>
              <div className={`text-[11px] ${isCurrent ? 'text-purple-400' : 'text-gray-500'}`}>
                {STATUS[st] || st}{step.retries > 0 ? ` (重试${step.retries}次)` : ''}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
