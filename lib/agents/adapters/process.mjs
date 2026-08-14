export class ProcessAdapter {
  constructor({ getProvider }) {
    this.name = 'process';
    this.getProvider = getProvider;
  }

  async probe() {
    return { status: 'available', protocol: 'process/local' };
  }

  async *invoke({ prompt, agent, conversationId, runId, signal, providerId, model }) {
    const provider = this.getProvider(providerId);
    const systemPrompt = `You are ${agent.name} (${agent.id}). ${agent.instructions}\nCapabilities: ${agent.capabilities.join(', ')}`;
    const fullPrompt = `${systemPrompt}\n\nTask: ${prompt}`;

    try {
      for await (const event of provider.streamChat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        model,
        signal
      })) {
        if (event.type === 'token') {
          yield {
            type: 'token',
            runId,
            agentId: agent.id,
            speaker: { name: agent.name, voice: agent.voice },
            value: event.value
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
