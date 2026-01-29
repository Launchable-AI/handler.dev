import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';
import { GitBranch } from 'lucide-react';

interface WorktreeEdgeData {
  branch: string;
  status: string;
}

const statusEdgeColors: Record<string, string> = {
  creating: 'hsl(var(--amber))',
  ready: 'hsl(var(--cyan))',
  merging: 'hsl(var(--purple))',
  merged: 'hsl(var(--green))',
  error: 'hsl(var(--red))',
};

function WorktreeEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  ...rest
}: EdgeProps<WorktreeEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const color = statusEdgeColors[data?.status || 'ready'] || 'hsl(var(--cyan))';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: color, strokeWidth: 2 }}
        {...rest}
      />
      <EdgeLabelRenderer>
        <div
          className="absolute flex items-center gap-1 px-1.5 py-0.5 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded text-[9px] text-[hsl(var(--text-secondary))] pointer-events-all nodrag nopan"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <GitBranch className="h-2.5 w-2.5" style={{ color }} />
          {data?.branch}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const WorktreeEdge = memo(WorktreeEdgeComponent);
