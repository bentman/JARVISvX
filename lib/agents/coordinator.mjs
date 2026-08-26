import { EMPTY_AUTHORIZATION } from '../authorization.mjs';

// A participant that produced nothing is part of the evidence, not a gap in it.
function renderContributions(contributions) {
  return contributions
    .map(({ agent, output, failure }) => `**${agent.name} (${agent.id}):**\n${failure ? `[no result — ${failure}]` : output}`)
    .join('\n\n');
}
import { selectApprovedRoot } from '../tools.mjs';

export const DEFAULT_ROSTERS = {
  solo: ['architect'],
  delegate: ['architect'],
  panel: ['architect', 'reviewer', 'security'],
  debate: ['architect', 'reviewer', 'adversary'],
};

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

  resolveAgents(ids, fallbackIds) {
    if (!ids.length) return fallbackIds.map((id) => this.registry.get(id)).filter(Boolean);
    const unknown = ids.filter((id) => !this.registry.get(id));
    if (unknown.length) {
      const error = new Error(`Unknown agent ${unknown.length === 1 ? 'profile' : 'profiles'}: ${unknown.join(', ')}.`);
      error.code = 'unknown_agent';
      throw error;
    }
    return ids.map((id) => this.registry.get(id));
  }

  /**
   * Run every participant and keep what each produced.
   *
   * A participant that fails does not end the round: its failure is recorded so
   * the synthesizer and the run metadata both show what was missing.
   */
  async gather(agents, buildPrompt, context) {
    const contributions = [];
    for (const agent of agents) {
      this.publish({ type: 'agent-token', runId: context.runId, agentId: agent.id, speaker: { name: agent.name, voice: agent.voice }, value: `\n**${agent.name} (${agent.id}):**\n`, conversationId: context.conversationId });
      try {
        contributions.push({ agent, output: await this.invokeAgent({ ...context, prompt: buildPrompt(agent), agent }) });
      } catch (error) {
        contributions.push({ agent, output: '', failure: error.message });
      }
    }
    return contributions;
  }

  // The synthesizer is the first selected profile, so a run synthesizes through
  // an agent the operator actually chose.
  async synthesize({ agents, prompt, ...context }) {
    return this.invokeAgent({ ...context, prompt, agent: agents[0] });
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
      agentProviderId: agent.provider || null,
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
    const supplied = [agentId, ...agentIds].filter(Boolean);
    const defaults = DEFAULT_ROSTERS[mode] || DEFAULT_ROSTERS.solo;
    const agents = this.resolveAgents(supplied, defaults);
    if (!agents.length) throw Object.assign(new Error('No agent profiles are available for this run.'), { code: 'unknown_agent' });
    const primaryAgent = agents[0];
    const primaryAgentId = primaryAgent.id;
    const adapterName = primaryAgent.adapter || 'acp';

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
        resultText += await this.invokeAgent({
          prompt: objective,
          agent: primaryAgent,
          conversationId,
          runId: runRecord.id,
          providerId,
          model,
          signal,
          requestedCapabilities,
          authorization
        });
      } else if (mode === 'panel') {
        const contributions = await this.gather(agents, () => `Objective: ${objective}`, { conversationId, runId: runRecord.id, providerId, model, signal, requestedCapabilities, authorization });
        resultText += `### Panel Analysis: ${objective}\n\n${renderContributions(contributions)}\n`;
        resultText += `### Panel Synthesis\n\n`;
        resultText += await this.synthesize({
          agents,
          prompt: `Objective: ${objective}\n\nEach panelist's response follows. Synthesize them into one recommendation, naming where they agree and where they do not.\n\n${renderContributions(contributions)}`,
          conversationId, runId: runRecord.id, providerId, model, signal, requestedCapabilities, authorization
        });
      } else if (mode === 'debate') {
        const positions = await this.gather(agents, () => `Topic: ${objective}\nProvide your independent position on this proposal.`, { conversationId, runId: runRecord.id, providerId, model, signal, requestedCapabilities, authorization });
        resultText += `### Debate Round 1: Independent Positions\n\n${renderContributions(positions)}\n`;

        const critiques = await this.gather(agents, () => `Topic: ${objective}\nCompeting positions:\n${renderContributions(positions)}\nProvide your critique and refine your position.`, { conversationId, runId: runRecord.id, providerId, model, signal, requestedCapabilities, authorization });
        resultText += `### Debate Round 2: Critiques & Counter-Arguments\n\n${renderContributions(critiques)}\n`;

        // The synthesizer is given the evidence it is asked to summarize.
        resultText += `### Final Synthesis & Recommendation\n\n`;
        resultText += await this.synthesize({
          agents,
          prompt: `Topic: ${objective}\n\nIndependent positions:\n${renderContributions(positions)}\n\nCritiques and refinements:\n${renderContributions(critiques)}\n\nSummarize the consensus, the trade-offs, and your final recommendation from the positions and critiques above.`,
          conversationId, runId: runRecord.id, providerId, model, signal, requestedCapabilities, authorization
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
