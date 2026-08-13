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

  executeRun(options) {
    return this.coordinator.executeRun(options);
  }

  getRun(runId) {
    return this.database.agentRun(runId);
  }

  listRuns(conversationId = null) {
    return this.database.agentRuns(conversationId);
  }
}
