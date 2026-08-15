import React from 'react';

export interface SectionDividerProps {
  title: string;
  subtitle?: string;
  count?: number;
  icon?: React.ReactNode;
}

/**
 * Styled section divider with title, optional icon, and
 * optional count badge or subtitle text.
 * Creates visual separation between logical groups of content
 * within a panel.
 */
export function SectionDivider({ title, subtitle, count, icon }: SectionDividerProps) {
  return (
    <div className="panel-section">
      <h3 className="panel-section-title">
        {icon && <span className="section-icon">{icon}</span>}
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
      </h3>
      {subtitle && <div className="panel-section-subtitle">{subtitle}</div>}
    </div>
  );
}
