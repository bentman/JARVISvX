import React, { useState, useEffect, useCallback } from 'react';
import { FormEvent } from 'react';
import { api } from '../api';
import type { Root, WorkspaceEdit } from '../types';
import {
  Settings2,
  FolderPlus,
  FileText,
  X,
  CheckCircle2,
  Play,
  ShieldCheck,
  Plus
} from 'lucide-react';
import { PanelCard } from './ui/PanelCard';
import { SectionDivider } from './ui/SectionDivider';
import { StatusBadge } from './ui/StatusBadge';
import { PanelHeader } from './ui/PanelHeader';

export function WorkspacesPanel({
  roots,
  rootInput,
  setRootInput,
  setRoots
}: {
  roots: Root[];
  rootInput: string;
  setRootInput: (value: string) => void;
  setRoots: (value: Root[]) => void;
}) {
  const [edits, setEdits] = useState<WorkspaceEdit[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadEdits = useCallback(async () => {
    try { setEdits(await api.workspaceEdits()); } catch {}
  }, []);

  useEffect(() => { void loadEdits(); }, [loadEdits]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const root = await api.addRoot(rootInput);
    setRoots([...roots, root]);
    setRootInput('');
  };

  const remove = async (id: string) => {
    await api.removeRoot(id);
    setRoots(roots.filter((root) => root.id !== id));
  };

  const handleApprove = async (id: string) => {
    setLoading(true);
    try {
      await api.approveWorkspaceEdit(id);
      setActionSuccess('File edit approved & written to workspace!');
      setTimeout(() => setActionSuccess(null), 3000);
      await loadEdits();
    } catch (err: any) { alert(`Failed to apply edit: ${err.message}`); }
    finally { setLoading(false); }
  };

  const handleReject = async (id: string) => {
    setLoading(true);
    try {
      await api.rejectWorkspaceEdit(id);
      setActionSuccess('Proposed edit rejected.');
      setTimeout(() => setActionSuccess(null), 2500);
      await loadEdits();
    } catch (err: any) { alert(`Failed to reject edit: ${err.message}`); }
    finally { setLoading(false); }
  };

  const handleProposeTestEdit = async () => {
    if (!roots.length) { alert('Add an approved workspace root first.'); return; }
    const targetFile = `${roots[0].path}/jarvis-sample-skill.ts`;
    const sampleCode = `// JARVIS Self-Evolution Generated Module\nexport function customAssistantSubroutine(input: string) {\n  return { processed: true, result: \`Hello from JARVIS Future-Safe Boundary: \${input}\` };\n}`;
    try {
      await api.proposeWorkspaceEdit({ path: targetFile, content: sampleCode, reason: 'Self-evolution subroutine proposal' });
      setActionSuccess('Test edit proposed for human review!');
      setTimeout(() => setActionSuccess(null), 3000);
      await loadEdits();
    } catch (err: any) { alert(`Failed to propose edit: ${err.message}`); }
  };

  const pendingEdits = edits.filter((e) => e.status === 'pending_review');
  const pastEdits = edits.filter((e) => e.status !== 'pending_review');

  return (
    <div className="panel-surface">
      <PanelHeader
        icon={<Settings2 className="w-5 h-5 text-cyan-400" />}
        title="Workspace access"
        subtitle="JARVIS can only read and write UTF-8 text files inside roots you explicitly approve."
      />

      <PanelCard className="space-y-3">
        <form className="root-form" onSubmit={add}>
          <input
            value={rootInput}
            onChange={(e) => setRootInput(e.target.value)}
            placeholder="Absolute folder path"
            className="form-input flex-1"
          />
          <button className="btn btn-primary btn-sm">
            <FolderPlus className="w-3.5 h-3.5" /> Add root
          </button>
        </form>

        <div className="roots space-y-1">
          {roots.map((root) => (
            <div key={root.id} className="flex items-center gap-2 text-xs font-mono p-2 rounded-lg bg-slate-950 border border-slate-800">
              <FileText className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
              <span className="flex-1 overflow-wrap-anywhere break-all">{root.path}</span>
              <button
                onClick={() => remove(root.id)}
                className="btn-icon btn-sm p-1"
                title="Remove workspace root"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {!roots.length && <p className="text-small text-tertiary">No workspace roots are approved.</p>}
        </div>
      </PanelCard>

      {/* Future-Safe Boundary */}
      <PanelCard className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-small font-mono text-cyan-400 uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            Future-Safe Boundary
          </h3>
          <StatusBadge status="info">
            <span className="badge-icon"><ShieldCheck className="w-3 h-3" /></span>
            Human-in-the-Loop Active
          </StatusBadge>
        </div>

        <p className="text-small text-tertiary">
          Skills and self-evolution routines may propose code edits for review, but cannot execute or write files without explicit human approval.
        </p>

        {actionSuccess && (
          <div className="p-3 rounded-xl bg-success-subtle border border-emerald text-success text-xs font-mono">
            {actionSuccess}
          </div>
        )}

        <button
          onClick={handleProposeTestEdit}
          className="btn btn-sm btn-secondary"
        >
          <Plus className="w-3.5 h-3.5" />
          + Propose Test Workspace Code Edit
        </button>

        <SectionDivider title="Pending Review Queue" count={pendingEdits.length} />

        <div className="space-y-3">
          {pendingEdits.map((edit) => (
            <PanelCard key={edit.id} padding="compact" gap="tight" className="border border-rose">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-cyan-300 break-all">{edit.file_path}</span>
                <StatusBadge status="pending">Pending Approval</StatusBadge>
              </div>
              <p className="text-xs text-tertiary">Reason: {edit.reason}</p>
              <pre className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-emerald-400 font-mono overflow-x-auto max-h-32">{edit.content}</pre>
              <div className="flex gap-2">
                <button
                  disabled={loading}
                  onClick={() => handleApprove(edit.id)}
                  className="btn btn-sm btn-primary"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Approve & Write File
                </button>
                <button
                  disabled={loading}
                  onClick={() => handleReject(edit.id)}
                  className="btn btn-sm btn-secondary"
                >
                  Reject
                </button>
              </div>
            </PanelCard>
          ))}
          {!pendingEdits.length && (
            <p className="text-xs text-tertiary font-mono">No file edits currently pending human review.</p>
          )}
        </div>

        {pastEdits.length > 0 && (
          <>
            <SectionDivider title="Audit History" count={pastEdits.length} />
            <div className="space-y-1">
              {pastEdits.map((edit) => (
                <div key={edit.id} className="flex justify-between items-center text-xs font-mono py-1.5 border-b border-slate-800">
                  <span className="text-tertiary break-all">{edit.file_path}</span>
                  <span className={edit.status === 'approved_and_applied' ? 'text-success' : 'text-danger'}>
                    {edit.status === 'approved_and_applied' ? 'Approved & Applied' : 'Rejected'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </PanelCard>
    </div>
  );
}

