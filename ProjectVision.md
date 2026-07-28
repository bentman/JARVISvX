## JARVISvX: Local-First Personal AI Assistant

JARVIS is a voice-first, local-first personal AI assistant designed for natural, conversational interaction on user-owned hardware. Moving beyond the traditional "chat window" paradigm, JARVIS is engineered to be a capable presence—available, interruptible, and consistent—providing a coherent experience where capabilities emerge from a foundation of trust.

---

### Core Interaction Model
The primary goal of JARVIS is to enable natural human-AI communication through a seamless feedback loop:

*   **Voice-First Experience:** Designed for fluid speech. JARVIS listens, understands, responds, and recovers gracefully from interruptions.
*   **Unified Interface:** While voice is the primary modality, text is integrated as a secondary "doorway" into the same assistant rather than a separate product.
*   **Behavioral Integrity:** Maintains a consistent personality and remains aware of its own limits, providing clear explanations when a task is unavailable or has failed.

### Technical Architecture
JARVIS is built for flexibility, privacy, and performance across diverse environments.

*   **Model Orchestration:** 
    *   **Local Execution:** Uses local LLMs (hosted via llama.app) for primary tasks.
    *   **Hardware Awareness:** Automatically detects system specs to configure the optimal local model for peak performance.
    *   **Cloud Escalation:** Ability to escalate to web-based LLMs via API or OAuth upon user request.
*   **Memory & Storage:** Features a remote memory system that is fully configurable via any cloud storage provider or network file share.
*   **Cross-Platform Compatibility:** Designed to run on multiple hardware device types and operating systems.

### Capabilities & Extensibility
JARVIS is not a collection of fragmented features, but an extensible system designed for growth.

*   **Tooling & Execution:**
    *   **Agent Orchestration:** Coordinates complex tasks through an integrated toolbox.
    *   **Extensible Skills:** Integrated search, Model Context Protocol (MCP), and custom skills accessible via "slash" (`/`) commands.
*   **Self-Evolution:** Highly skilled in software programming, allowing the assistant to update its own codebase for expansion and self-improvement.
*   **Interface Options:**
    *   **GUI:** A full application front-end for visual interaction.
    *   **CLI:** A command-line interface for power users and developers.