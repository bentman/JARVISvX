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

  async executeRun({
    agentId,
    agentIds = [],
    objective,
    mode = 'solo',
    conversationId = null,
    parentRunId = null,
    providerId = undefined,
    model = undefined,
    signal = undefined
  }) {
    const runRecord = this.database.createAgentRun({
      conversation_id: conversationId,
      agent_id: agentId || agentIds[0] || 'architect',
      adapter: 'process',
      parent_run_id: parentRunId,
      mode,
      objective
    });

    let resultText = '';

    try {
      if (mode === 'solo' || mode === 'delegate') {
        const agent = this.registry.get(agentId || 'architect');
        if (!agent) throw new Error(`Agent profile "${agentId}" not found.`);
        const adapter = this.getAdapter(agent.adapter);
        
        for await (const event of adapter.invoke({
          prompt: objective,
          agent,
          conversationId,
          runId: runRecord.id,
          providerId,
          model,
          signal
        })) {
          if (event.type === 'token') {
            resultText += event.value;
            this.publish({
              type: 'agent-token',
              runId: runRecord.id,
              agentId: agent.id,
              speaker: event.speaker,
              value: event.value,
              conversationId
            });
          }
        }
      } else if (mode === 'panel') {
        const targetAgents = agentIds.length ? agentIds.map((id) => this.registry.get(id)).filter(Boolean) : [this.registry.get('architect'), this.registry.get('reviewer'), this.registry.get('security')].filter(Boolean);
        resultText += `### Panel Analysis: ${objective}\n\n`;

        for (const agent of targetAgents) {
          const adapter = this.getAdapter(agent.adapter);
          resultText += `#### ${agent.name} (${agent.id})\n`;
          this.publish({
            type: 'agent-token',
            runId: runRecord.id,
            agentId: agent.id,
            speaker: { name: agent.name, voice: agent.voice },
            value: `\n#### ${agent.name} (${agent.id})\n`,
            conversationId
          });

          for await (const event of adapter.invoke({
            prompt: `Objective: ${objective}`,
            agent,
            conversationId,
            runId: runRecord.id,
            providerId,
            model,
            signal
          })) {
            if (event.type === 'token') {
              resultText += event.value;
              this.publish({
                type: 'agent-token',
                runId: runRecord.id,
                agentId: agent.id,
                speaker: event.speaker,
                value: event.value,
                conversationId
              });
            }
          }
          resultText += '\n\n';
        }
      } else if (mode === 'debate') {
        const debaters = agentIds.length ? agentIds.map((id) => this.registry.get(id)).filter(Boolean) : [this.registry.get('architect'), this.registry.get('reviewer'), this.registry.get('adversary')].filter(Boolean);
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
          const adapter = this.getAdapter(agent.adapter);
          resultText += `**${agent.name} Position:**\n`;
          
          for await (const event of adapter.invoke({
            prompt: `Topic: ${objective}\nProvide your independent position on this proposal.`,
            agent,
            conversationId,
            runId: runRecord.id,
            providerId,
            model,
            signal
          })) {
            if (event.type === 'token') {
              positions[agent.id] += event.value;
              resultText += event.value;
              this.publish({
                type: 'agent-token',
                runId: runRecord.id,
                agentId: agent.id,
                speaker: event.speaker,
                value: event.value,
                conversationId
              });
            }
          }
          resultText += '\n\n';
        }

        // Round 2: Critiques
        resultText += `### Debate Round 2: Critiques & Counter-Arguments\n\n`;
        const summarizedPositions = Object.entries(positions).map(([id, pos]) => `${id}: ${pos}`).join('\n');

        for (const agent of debaters) {
          const adapter = this.getAdapter(agent.adapter);
          resultText += `**${agent.name} Critique:**\n`;

          for await (const event of adapter.invoke({
            prompt: `Topic: ${objective}\nCompeting positions:\n${summarizedPositions}\nProvide your critique and refine your position.`,
            agent,
            conversationId,
            runId: runRecord.id,
            providerId,
            model,
            signal
          })) {
            if (event.type === 'token') {
              resultText += event.value;
              this.publish({
                type: 'agent-token',
                runId: runRecord.id,
                agentId: agent.id,
                speaker: event.speaker,
                value: event.value,
                conversationId
              });
            }
          }
          resultText += '\n\n';
        }

        // Final Synthesis
        resultText += `### Final Synthesis & Recommendation\n\n`;
        const synthesizer = this.registry.get('architect');
        const synthAdapter = this.getAdapter(synthesizer.adapter);

        for await (const event of synthAdapter.invoke({
          prompt: `Topic: ${objective}\nSummarize the consensus, trade-offs, and final recommendation based on the debate.`,
          agent: synthesizer,
          conversationId,
          runId: runRecord.id,
          providerId,
          model,
          signal
        })) {
          if (event.type === 'token') {
            resultText += event.value;
            this.publish({
              type: 'agent-token',
              runId: runRecord.id,
              agentId: synthesizer.id,
              speaker: { name: 'JARVIS Synthesizer', voice: 'bf_isabella' },
              value: event.value,
              conversationId
            });
          }
        }
      }

      this.database.updateAgentRun(runRecord.id, { status: 'completed', result: resultText });
      return this.database.agentRun(runRecord.id);
    } catch (error) {
      this.database.updateAgentRun(runRecord.id, { status: 'failed', result: error.message });
      throw error;
    }
  }
}
