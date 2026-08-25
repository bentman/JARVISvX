import { EMPTY_AUTHORIZATION } from '../authorization.mjs';
import { selectApprovedRoot } from '../tools.mjs';

export class RunCoordinator {
  constructor({ registry, adapters, policy, database, publish }) {
    this.registry = registry;
    this.adapters = adapters;
    this.policy = policy;
    this.database = database;
    this.publish = publish || (() => {});
  }

  getAdapter(name) {
    return this.adapters.get(name) || this.adapters.get('process');
  }

  authorizeAgent(agent, requestedCapabilities, authorization) {
    const policyEvaluation = this.policy.evaluate({ agent, requestedCapabilities, authorization });
    if (!policyEvaluation.allowed) {
      const error = new Error(`Policy Rejected: ${policyEvaluation.reason}`);
      error.code = policyEvaluation.requiresHumanApproval ? 'approval_required' : 'policy_denied';
      throw error;
    }
    return policyEvaluation;
  }

  // Agent workspace access resolves to an approved root; the process working
  // directory is never an implicit one.
  async workingDirectory() {
    return selectApprovedRoot(this.database.roots().map((root) => root.path));
  }

  async invokeAgent({
    agent,
    prompt,
    runId,
    conversationId,
    providerId,
    model,
    signal,
    requestedCapabilities,
    authorization = EMPTY_AUTHORIZATION
  }) {
    const evaluation = this.authorizeAgent(agent, requestedCapabilities, authorization);
    const adapter = this.getAdapter(agent.adapter);
    const cwd = await this.workingDirectory();
    this.database.setAgentRunAuthority(runId, { adapter: adapter.name || agent.adapter, effectiveCapabilities: evaluation.effectiveCapabilities });
    let output = '';

    for await (const event of adapter.invoke({
      prompt,
      agent,
      conversationId,
      runId,
      providerId,
      model,
      signal,
      cwd,
      processMode: evaluation.processMode,
      authorization
    })) {
      if (event.type === 'failed') {
        const error = new Error(event.error || `Agent '${agent.id}' failed.`);
        if (event.code) error.code = event.code;
        throw error;
      }
      if (event.type === 'token') {
        output += event.value;
        this.publish({
          type: 'agent-token',
          runId,
          agentId: agent.id,
          speaker: event.speaker,
          value: event.value,
          conversationId
        });
      }
    }

    if (!output.trim()) {
      throw new Error(`Agent '${agent.id}' completed without producing output.`);
    }
    return output;
  }

  async executeRun({
    agentId,
    agentIds = [],
    objective,
    mode = 'solo',
    conversationId = null,
    parentRunId = null,
    providerId = undefined,
    model = undefined,
    signal = undefined,
    requestedCapabilities = [],
    authorization = EMPTY_AUTHORIZATION
  }) {
    const primaryAgentId = agentId || agentIds[0] || 'architect';
    const primaryAgent = this.registry.get(primaryAgentId);
    const adapterName = primaryAgent?.adapter || 'acp';

    const runRecord = this.database.createAgentRun({
      conversation_id: conversationId,
      agent_id: primaryAgentId,
      adapter: adapterName,
      parent_run_id: parentRunId,
      mode,
      objective
    });

    let resultText = '';

    try {
      if (mode === 'solo' || mode === 'delegate') {
        const agent = primaryAgent || this.registry.get('architect');
        if (!agent) throw new Error(`Agent profile "${primaryAgentId}" not found.`);

        resultText += await this.invokeAgent({
          prompt: objective,
          agent,
          conversationId,
          runId: runRecord.id,
          providerId,
          model,
          signal,
          requestedCapabilities,
          authorization
        });
      } else if (mode === 'panel') {
        const targetAgents = agentIds.length ? agentIds.map((id) => this.registry.get(id)).filter(Boolean) : [this.registry.get('architect'), this.registry.get('reviewer'), this.registry.get('security')].filter(Boolean);
        if (!targetAgents.length) throw new Error('No valid agents selected for panel run.');
        resultText += `### Panel Analysis: ${objective}\n\n`;

        for (const agent of targetAgents) {
          resultText += `#### ${agent.name} (${agent.id})\n`;
          this.publish({
            type: 'agent-token',
            runId: runRecord.id,
            agentId: agent.id,
            speaker: { name: agent.name, voice: agent.voice },
            value: `\n#### ${agent.name} (${agent.id})\n`,
            conversationId
          });

          resultText += await this.invokeAgent({
            prompt: `Objective: ${objective}`,
            agent,
            conversationId,
            runId: runRecord.id,
            providerId,
            model,
            signal,
            requestedCapabilities,
            authorization
          });
          resultText += '\n\n';
        }
      } else if (mode === 'debate') {
        const debaters = agentIds.length ? agentIds.map((id) => this.registry.get(id)).filter(Boolean) : [this.registry.get('architect'), this.registry.get('reviewer'), this.registry.get('adversary')].filter(Boolean);
        if (!debaters.length) throw new Error('No valid agents selected for debate run.');
        const positions = {};

        // Round 1: Independent Positions
        resultText += `### Debate Round 1: Independent Positions\n\n`;
        this.publish({
          type: 'agent-token',
          runId: runRecord.id,
          agentId: 'system',
          speaker: { name: 'JARVIS Synthesizer', voice: 'bf_isabella' },
          value: `### Debate Round 1: Independent Positions\n\n`,
          conversationId
        });

        for (const agent of debaters) {
          positions[agent.id] = '';
          resultText += `**${agent.name} Position:**\n`;

          const position = await this.invokeAgent({
            prompt: `Topic: ${objective}\nProvide your independent position on this proposal.`,
            agent,
            conversationId,
            runId: runRecord.id,
            providerId,
            model,
            signal,
            requestedCapabilities,
            authorization
          });
          positions[agent.id] += position;
          resultText += position;
          resultText += '\n\n';
        }

        // Round 2: Critiques
        resultText += `### Debate Round 2: Critiques & Counter-Arguments\n\n`;
        const summarizedPositions = Object.entries(positions).map(([id, pos]) => `${id}: ${pos}`).join('\n');

        for (const agent of debaters) {
          resultText += `**${agent.name} Critique:**\n`;

          resultText += await this.invokeAgent({
            prompt: `Topic: ${objective}\nCompeting positions:\n${summarizedPositions}\nProvide your critique and refine your position.`,
            agent,
            conversationId,
            runId: runRecord.id,
            providerId,
            model,
            signal,
            requestedCapabilities,
            authorization
          });
          resultText += '\n\n';
        }

        // Final Synthesis
        resultText += `### Final Synthesis & Recommendation\n\n`;
        const synthesizer = this.registry.get('architect');
        if (!synthesizer) throw new Error('Agent profile "architect" not found.');

        resultText += await this.invokeAgent({
          prompt: `Topic: ${objective}\nSummarize the consensus, trade-offs, and final recommendation based on the debate.`,
          agent: synthesizer,
          conversationId,
          runId: runRecord.id,
          providerId,
          model,
          signal,
          requestedCapabilities,
          authorization
        });
      }

      this.database.updateAgentRun(runRecord.id, { status: 'completed', result: resultText });
      return this.database.agentRun(runRecord.id);
    } catch (error) {
      this.database.updateAgentRun(runRecord.id, { status: 'failed', result: error.message });
      throw error;
    }
  }
}
