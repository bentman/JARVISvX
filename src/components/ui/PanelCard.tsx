import React from 'react';

export interface PanelCardProps {
  children: React.ReactNode;
  hover?: boolean;
  padding?: 'default' | 'compact';
  gap?: 'default' | 'tight' | 'none';
  onClick?: () => void;
  className?: string;
}

/**
 * Card container for flyout-panel background, border, spacing, and hover behavior.
 */
export function PanelCard({
  children,
  hover = true,
  padding = 'default',
  gap = 'default',
  onClick,
  className = '',
}: PanelCardProps) {
  const classes = [
    'panel-card',
    padding === 'compact' && 'compact',
    gap === 'tight' && 'tight',
    gap === 'none' && 'gap-none',
    !hover && 'no-hover',
    onClick && 'interactive-card',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} onClick={onClick}>
      {children}
    </div>
  );
}
