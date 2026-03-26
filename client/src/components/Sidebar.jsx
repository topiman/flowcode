import Pipeline from './Pipeline';
import ContextPanel from './ContextPanel';

const STATUS_LABELS = { 'in-progress': '进行中', completed: '已完成', paused: '已暂停' };

export default function Sidebar({ workflow, steps, onStepClick, viewingStep }) {
  if (!workflow) return null;

  const total = steps.length;
  const done = steps.filter(s => s.status === 'completed').length;
  const pct = total ? Math.round(done / total * 100) : 0;

  return (
    <div className="w-64 border-r border-gray-800 overflow-y-auto p-4 shrink-0">
      <h2 className="text-base font-semibold">{workflow.project?.name}</h2>
      {workflow.description && <p className="text-xs text-gray-500 mt-1">{workflow.description}</p>}

      <div className="flex gap-1.5 mt-3 mb-3">
        {workflow.template_name && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-500/20 text-purple-400">{workflow.template_name}</span>}
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${workflow.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-purple-500/20 text-purple-400'}`}>{STATUS_LABELS[workflow.status] || workflow.status}</span>
      </div>

      <div className="h-1 bg-gray-800 rounded-full mb-1">
        <div className="h-full bg-gradient-to-r from-purple-500 to-blue-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-gray-500 text-right">{done}/{total} ({pct}%)</p>

      <Pipeline steps={steps} currentStep={workflow.current_step} onStepClick={onStepClick} viewingStep={viewingStep} />
      <ContextPanel workflowId={workflow.id} />
    </div>
  );
}
