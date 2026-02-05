/**
 * Block/circuit-style "NEO" logo for the welcome screen.
 * Renders N, E, O as connected blocks (no outer border).
 */

interface NeoLogoProps {
  width?: number;
  className?: string;
}

export function NeoLogo({ width = 280, className = '' }: NeoLogoProps) {
  // Each letter is roughly 20 units wide, with 6 unit gaps, total ~78
  const viewWidth = 78;
  const viewHeight = 24;
  const scale = width / viewWidth;
  const height = viewHeight * scale;

  const blockColor = 'hsl(212, 92%, 60%)';
  const lineColor = 'hsl(212, 92%, 70%)';

  return (
    <div
      className={className}
      style={{ display: 'inline-block', width, height }}
      aria-label="Neo"
    >
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* N: two vertical bars + diagonal bar */}
        <g>
          {/* Left vertical */}
          <rect x="0" y="0" width="4" height="24" rx="0.5" fill={blockColor} />
          {/* Right vertical */}
          <rect x="16" y="0" width="4" height="24" rx="0.5" fill={blockColor} />
          {/* Diagonal from top-left to bottom-right */}
          <rect x="4" y="0" width="4" height="6" rx="0.5" fill={blockColor} />
          <rect x="8" y="6" width="4" height="6" rx="0.5" fill={blockColor} />
          <rect x="12" y="12" width="4" height="6" rx="0.5" fill={blockColor} />
          <rect x="16" y="18" width="4" height="6" rx="0.5" fill={blockColor} />
          {/* Connecting lines */}
          <line x1="4" y1="3" x2="8" y2="3" stroke={lineColor} strokeWidth="0.6" />
          <line x1="8" y1="9" x2="12" y2="9" stroke={lineColor} strokeWidth="0.6" />
          <line x1="12" y1="15" x2="16" y2="15" stroke={lineColor} strokeWidth="0.6" />
        </g>

        {/* E: vertical bar + 3 horizontal bars */}
        <g transform="translate(28, 0)">
          {/* Left vertical */}
          <rect x="0" y="0" width="4" height="24" rx="0.5" fill={blockColor} />
          {/* Top horizontal */}
          <rect x="0" y="0" width="16" height="4" rx="0.5" fill={blockColor} />
          {/* Middle horizontal */}
          <rect x="0" y="10" width="12" height="4" rx="0.5" fill={blockColor} />
          {/* Bottom horizontal */}
          <rect x="0" y="20" width="16" height="4" rx="0.5" fill={blockColor} />
          {/* Connecting lines */}
          <line x1="4" y1="2" x2="16" y2="2" stroke={lineColor} strokeWidth="0.6" />
          <line x1="4" y1="12" x2="12" y2="12" stroke={lineColor} strokeWidth="0.6" />
          <line x1="4" y1="22" x2="16" y2="22" stroke={lineColor} strokeWidth="0.6" />
        </g>

        {/* O: frame (4 bars forming rectangle) */}
        <g transform="translate(52, 0)">
          {/* Left vertical */}
          <rect x="0" y="0" width="4" height="24" rx="0.5" fill={blockColor} />
          {/* Right vertical */}
          <rect x="22" y="0" width="4" height="24" rx="0.5" fill={blockColor} />
          {/* Top horizontal */}
          <rect x="0" y="0" width="26" height="4" rx="0.5" fill={blockColor} />
          {/* Bottom horizontal */}
          <rect x="0" y="20" width="26" height="4" rx="0.5" fill={blockColor} />
          {/* Connecting lines */}
          <line x1="4" y1="2" x2="22" y2="2" stroke={lineColor} strokeWidth="0.6" />
          <line x1="4" y1="22" x2="22" y2="22" stroke={lineColor} strokeWidth="0.6" />
          <line x1="2" y1="4" x2="2" y2="20" stroke={lineColor} strokeWidth="0.6" />
          <line x1="24" y1="4" x2="24" y2="20" stroke={lineColor} strokeWidth="0.6" />
        </g>
      </svg>
    </div>
  );
}
