import { AgentRegistry } from './registry.mjs';
import { PolicyGate } from './policy.mjs';
import { AcpAdapter } from './adapters/acp.mjs';
import { ProcessAdapter } from './adapters/process.mjs';
import { RunCoordinator } from './coordinator.mjs';
import { AgentBusMcpServer } from './agent-bus-mcp.mjs';

export class AgentRuntime {
  constructor({ database, getProvider, publish }) {
    this.database = database;
    this.publish = publish || (() => {});
    this.registry = new AgentRegistry({ database });
    this.policy = new PolicyGate({ database });
    
    this.adapters = new Map([
      ['acp', new AcpAdapter()],
      ['process', new ProcessAdapter({ getProvider })]
    ]);

    this.coordinator = new RunCoordinator({
      registry: this.registry,
      adapters: this.adapters,
      policy: this.policy,
      database: this.database,
      publish: this.publish
    });

    this.busMcp = new AgentBusMcpServer({ runtime: this });
  }

  async initialize(roots = []) {
    await this.registry.load(roots);
    return this;
  }

  getAgent(id) {
    return this.registry.get(id);
  }

  listAgents() {
    return this.registry.list();
  }

  createAgent(profile) {
    return this.registry.createAgent(profile);
  }

  updateAgent(id, patch) {
    return this.registry.updateAgent(id, patch);
  }

  deleteAgent(id) {
    return this.registry.deleteAgent(id);
  }

  executeRun(options) {
    return this.coordinator.executeRun(options);
  }

  getRun(runId) {
    return this.database.agentRun(runId);
  }

  listRuns(conversationId = null) {
    return this.database.agentRuns(conversationId);
  }

  // Delivers a follow-up message to a still-running run. A run's coordinator
  // call doesn't resolve until the run completes (see RunCoordinator.executeRun),
  // so the only realistic way a caller learns a runId while it's still
  // 'running' is from a live 'agent-token' event on the event hub, published
  // as the run streams. Honest by construction: a finished run, an unknown
  // runId, or an adapter with no interactive session (see ProcessAdapter,
  // which doesn't implement send()) all produce a clear failure rather than
  // a fabricated "delivered".
  sendToRun(runId, message) {
    const run = this.database.agentRun(runId);
    if (!run) return { success: false, error: `No agent run found for id "${runId}".` };
    if (run.status !== 'running') return { success: false, error: `Run "${runId}" is already ${run.status}; there is no active session to send to.` };
    const adapter = this.adapters.get(run.adapter);
    if (!adapter || typeof adapter.send !== 'function') {
      return { success: false, error: `The "${run.adapter}" adapter does not support sending follow-up messages to a running agent.` };
    }
    return adapter.send(runId, message);
  }
}
