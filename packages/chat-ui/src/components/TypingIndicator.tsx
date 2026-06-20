interface TypingIndicatorProps {
  userIds: string[];
  renderUser?: (userId: string) => string;
  className?: string;
}

export function TypingIndicator({ userIds, renderUser, className = '' }: TypingIndicatorProps) {
  if (!userIds.length) return <div className="somni-typing-indicator" />;

  const names = userIds.slice(0, 2).map((id) => (renderUser ? renderUser(id) : id));
  const others = userIds.length > 2 ? ` +${userIds.length - 2} more` : '';
  const label = `${names.join(', ')}${others} ${userIds.length === 1 ? 'is' : 'are'} typing`;

  return (
    <div className={`somni-typing-indicator ${className}`} aria-live="polite">
      <div className="somni-typing-indicator__dots" aria-hidden="true">
        <span className="somni-typing-indicator__dot" />
        <span className="somni-typing-indicator__dot" />
        <span className="somni-typing-indicator__dot" />
      </div>
      <span>{label}</span>
    </div>
  );
}
