export class ProcessAdapter {
  constructor({ getProvider }) {
    this.name = 'process';
    this.getProvider = getProvider;
  }

  async probe() {
    return { status: 'available', protocol: 'process/local' };
  }

  async *invoke({ prompt, agent, conversationId, runId, signal, providerId, model, allowCloud = false }) {
    const provider = this.getProvider(providerId);
    // Same gate chat() applies before it will touch a cloud-tagged provider
    // (lib/application.mjs) — this adapter calls getProvider() directly instead of
    // going through chat()'s routing/approval chain, so without this check an agent
    // run could reach a cloud provider with no user approval at all.
    if (provider.tags?.includes('cloud') && !allowCloud) {
      yield {
        type: 'failed',
        runId,
        agentId: agent.id,
        speaker: { name: agent.name, voice: agent.voice },
        error: 'Cloud requests require explicit approval.',
        code: 'cloud_approval_required'
      };
      return;
    }
    const systemPrompt = `You are ${agent.name} (${agent.id}). ${agent.instructions}\nCapabilities: ${agent.capabilities.join(', ')}`;

    try {
      for await (const event of provider.streamChat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        model,
        signal
      })) {
        const value = typeof event === 'string' ? event : event?.type === 'token' ? event.value : '';
        if (value) {
          yield {
            type: 'token',
            runId,
            agentId: agent.id,
            speaker: { name: agent.name, voice: agent.voice },
            value
          };
        }
      }
      yield { type: 'completed', runId, agentId: agent.id };
    } catch (error) {
      yield {
        type: 'failed',
        runId,
        agentId: agent.id,
        speaker: { name: agent.name, voice: agent.voice },
        error: `${agent.name} provider error: ${error.message}`
      };
    }
  }

  async cancel() {}
}
