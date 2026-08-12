import { EventEmitter } from 'node:events';

export class AssistantEventHub {
  #events = new EventEmitter();

  publish(event) {
    this.#events.emit('assistant-event', { id: crypto.randomUUID(), at: new Date().toISOString(), ...event });
  }

  subscribe(listener) {
    this.#events.on('assistant-event', listener);
    return () => this.#events.off('assistant-event', listener);
  }
}

