import React from 'react';

export interface PanelHeaderProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

/**
 * Consistent panel header with icon, title, optional subtitle,
 * and right-aligned action elements (e.g. status badges, buttons).
 */
export function PanelHeader({ icon, title, subtitle, actions }: PanelHeaderProps) {
  return (
    <div className="panel-header">
      <div className="panel-title-row">
        <div className="panel-title">
          {icon && <span className="panel-icon">{icon}</span>}
          <span>{title}</span>
        </div>
        {subtitle && <div className="panel-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="panel-actions">{actions}</div>}
    </div>
  );
}
