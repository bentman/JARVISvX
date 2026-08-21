import React from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

/**
 * Modal dialog with header, body, footer, focus management, and Escape handling.
 */
export function Modal({ isOpen, onClose, title, icon, children, footer, maxWidth = '640px' }: ModalProps) {
  // Hooks precede the early return because isOpen changes on the same mounted instance.
  React.useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content" style={{ '--modal-max-width': maxWidth } as React.CSSProperties}>
        <div className="modal-header">
          <div className="modal-title">
            {icon && <span className="modal-title-icon">{icon}</span>}
            <h3 className="text-h3">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="modal-close"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
