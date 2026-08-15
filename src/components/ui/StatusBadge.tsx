import React from 'react';

export type BadgeStatus =
  | 'online'
  | 'offline'
  | 'pending'
  | 'info'
  | 'cyan'
  | 'amber'
  | 'purple'
  | 'emerald'
  | 'success'
  | 'danger';

export interface StatusBadgeProps {
  status: BadgeStatus;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Consistent status badge with predefined color variants.
 * Usage: <StatusBadge status="online"><CheckCircle2 /> Server</StatusBadge>
 */
export function StatusBadge({ status, children, icon, className = '' }: StatusBadgeProps) {
  const classes = ['badge', `badge-${status}`, className].filter(Boolean).join(' ');

  return (
    <span className={classes}>
      {icon && <span className="badge-icon">{icon}</span>}
      {children}
    </span>
  );
}
