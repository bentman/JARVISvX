import React from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { Toast } from '../../hooks/useToast';
import { StatusBadge } from './StatusBadge';

export interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} onClick={() => onDismiss(toast.id)} className="cursor-pointer">
          <StatusBadge
            status={toast.variant === 'success' ? 'success' : 'danger'}
            icon={toast.variant === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          >
            {toast.message}
          </StatusBadge>
        </div>
      ))}
    </div>
  );
}
