import type { PresenceStatus } from '@somni/chat-core';

interface OnlineIndicatorProps {
  status: PresenceStatus;
  className?: string;
}

export function OnlineIndicator({ status, className = '' }: OnlineIndicatorProps) {
  return (
    <span
      className={`somni-online-indicator somni-online-indicator--${status} ${className}`}
      aria-label={`Status: ${status}`}
      role="img"
    />
  );
}
