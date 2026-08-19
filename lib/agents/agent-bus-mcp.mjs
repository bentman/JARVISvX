export class AgentBusMcpServer {
  constructor({ runtime }) {
    this.runtime = runtime;
    this.name = 'JARVIS Agent Bus MCP';
    this.id = 'mcp-agent-bus';
  }

  getTools() {
    return [
      {
        name: 'agents_list',
        description: 'Lists all available project agents, their capabilities, and voice personas.',
        parameters: {}
      },
      {
        name: 'agents_ask',
        description: 'Delegates a specialized sub-task to a named agent identity (e.g. security, reviewer, debugger). Call agents_list first to see available agent ids.',
        parameters: {
          targetAgentId: 'string',
          objective: 'string',
          currentDepth: 'number?'
        }
      },
      {
        name: 'agents_send',
        description: 'Sends a message to an active agent run session.',
        parameters: {
          runId: 'string',
          message: 'string'
        }
      }
    ];
  }

  async executeTool(toolName, params, context = {}) {
    if (toolName === 'agents_list') {
      return { success: true, agents: this.runtime.listAgents() };
    }

    if (toolName === 'agents_ask') {
      const { targetAgentId, objective, currentDepth = 1 } = params;
      if (currentDepth > 2) {
        return { success: false, error: 'Max delegation depth (2) exceeded.' };
      }

      const run = await this.runtime.executeRun({
        agentId: targetAgentId,
        objective,
        mode: 'delegate',
        parentRunId: context.parentRunId || null,
        conversationId: context.conversationId || null,
        approved: Boolean(context.approved),
        allowCloud: Boolean(context.allowCloud)
      });

      return { success: true, runId: run.id, result: run.result };
    }

    if (toolName === 'agents_send') {
      return this.runtime.sendToRun(params.runId, params.message);
    }

    throw new Error(`Unknown Agent Bus tool: ${toolName}`);
  }
}
