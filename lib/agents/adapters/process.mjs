import { ACTIONS, EMPTY_AUTHORIZATION, authorize } from '../../authorization.mjs';

export class ProcessAdapter {
  constructor({ getProvider }) {
    this.name = 'process';
    this.getProvider = getProvider;
  }

  async probe() {
    return { status: 'available', protocol: 'process/local' };
  }

  async *invoke({ prompt, agent, conversationId, runId, signal, providerId, model, authorization = EMPTY_AUTHORIZATION }) {
    const provider = this.getProvider(providerId);
    // Direct provider access reaches the same policy decision as chat routing.
    if (provider.tags?.includes('cloud')) {
      try {
        authorize(authorization, { action: ACTIONS.CLOUD, target: provider.id });
      } catch (denial) {
        yield {
          type: 'failed',
          runId,
          agentId: agent.id,
          speaker: { name: agent.name, voice: agent.voice },
          error: denial.message,
          code: denial.code
        };
        return;
      }
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
