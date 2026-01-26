import { CommandCentreProvider } from '../../context/CommandCentreContext';
import { ToolBar } from './ToolBar';
import { SessionGrid } from './SessionGrid';

export function CommandCentre() {
  return (
    <CommandCentreProvider>
      <div className="h-full flex flex-col bg-[hsl(var(--bg-base))]">
        <ToolBar />
        <SessionGrid className="flex-1" />
      </div>
    </CommandCentreProvider>
  );
}

// Re-export components for external use
export { ToolBar } from './ToolBar';
export { SessionGrid } from './SessionGrid';
export { SessionTile } from './SessionTile';
export { SessionThumbnail } from './SessionThumbnail';
