import { AgentRegistry } from './registry.mjs';
import { PolicyGate } from './policy.mjs';
import { AcpAdapter } from './adapters/acp.mjs';
import { ProcessAdapter } from './adapters/process.mjs';
import { RunCoordinator } from './coordinator.mjs';
import { AgentBusMcpServer } from './agent-bus-mcp.mjs';

export class AgentRuntime {
  constructor({ database, selectProvider, publish, agentConfigPath }) {
    this.database = database;
    this.publish = publish || (() => {});
    this.registry = new AgentRegistry({ database, configPath: agentConfigPath });
    this.policy = new PolicyGate({ database });
    
    this.adapters = new Map([
      ['acp', new AcpAdapter()],
      ['process', new ProcessAdapter({ selectProvider })]
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

  async initialize() {
    await this.registry.load();
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

  // Follow-ups require a running record and an adapter with an interactive session.
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
