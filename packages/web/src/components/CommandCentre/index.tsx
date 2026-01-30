import { CommandCentreProvider, useCommandCentre } from '../../context/CommandCentreContext';
import { CanvasProvider } from '../../context/CanvasContext';
import { ToolBar } from './ToolBar';
import { SessionGrid } from './SessionGrid';
import { CanvasView } from './CanvasView';

function CommandCentreContent() {
  const { state } = useCommandCentre();
  const { isFullscreen, viewMode } = state;

  return (
    <div className={`flex flex-col bg-[hsl(var(--bg-base))] ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
      <ToolBar />
      {viewMode === 'canvas' ? (
        <CanvasView className="flex-1" />
      ) : (
        <SessionGrid className="flex-1" />
      )}
    </div>
  );
}

export function CommandCentre() {
  return (
    <CommandCentreProvider>
      <CanvasProvider>
        <CommandCentreContent />
      </CanvasProvider>
    </CommandCentreProvider>
  );
}

// Re-export components for external use
export { ToolBar } from './ToolBar';
export { SessionGrid } from './SessionGrid';
export { SessionTile } from './SessionTile';
