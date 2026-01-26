import { createPortal } from 'react-dom';
import { CommandCentreProvider, useCommandCentre } from '../../context/CommandCentreContext';
import { ToolBar } from './ToolBar';
import { SessionGrid } from './SessionGrid';

function CommandCentreContent() {
  const { state } = useCommandCentre();
  const { isFullscreen } = state;

  const content = (
    <div className={`flex flex-col bg-[hsl(var(--bg-base))] ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
      <ToolBar />
      <SessionGrid className="flex-1" />
    </div>
  );

  // When fullscreen, render via portal to overlay everything
  if (isFullscreen) {
    return createPortal(content, document.body);
  }

  return content;
}

export function CommandCentre() {
  return (
    <CommandCentreProvider>
      <CommandCentreContent />
    </CommandCentreProvider>
  );
}

// Re-export components for external use
export { ToolBar } from './ToolBar';
export { SessionGrid } from './SessionGrid';
export { SessionTile } from './SessionTile';
