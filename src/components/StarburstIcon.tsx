/**
 * Gemini-style sparkle/star icon for the empty state.
 */

interface StarburstIconProps {
  size?: number;
  className?: string;
}

export function StarburstIcon({ size = 40, className = '' }: StarburstIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Gemini 4-pointed star */}
      <path
        d="M20 2C20 2 22.5 14 26 17.5C29.5 21 38 20 38 20C38 20 29.5 19 26 22.5C22.5 26 20 38 20 38C20 38 17.5 26 14 22.5C10.5 19 2 20 2 20C2 20 10.5 21 14 17.5C17.5 14 20 2 20 2Z"
        fill="url(#geminiGradient)"
      />
      <defs>
        <linearGradient id="geminiGradient" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(212, 92%, 60%)" />
          <stop offset="1" stopColor="hsl(250, 80%, 65%)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
