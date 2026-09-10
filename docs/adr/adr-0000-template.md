# ADR 0000: [Short imperative or descriptive title of the decision]

Status: Proposed | Accepted | Implemented | Pending ADR NNNN | Superseded by [ADR NNNN](adr-NNNN-<slug>.md)
Date: YYYY-MM-DD

<!--
Guidance on ADR usage in this repository:
- Non-trivial architecture decisions get a short ADR at docs/adr/adr-NNNN-<slug>.md.
- Follow the four-digit zero-padded numbering convention (e.g. adr-0009-<slug>.md).
- Status categories reflect lifecycle against the active codebase:
  * Proposed: Drafted and under architectural review; not yet adopted or built.
  * Accepted: Approved design consensus, awaiting full codebase implementation.
  * Implemented: Fully realized in the active codebase and verified by tests.
  * Pending ADR NNNN: Blocked by or dependent on the decision of another ADR.
  * Superseded by [ADR NNNN](...): Supplanted by a newer architectural decision
    (or "Partially superseded by..." when specific sections remain active).
- Keep ADRs concise, durable, and free of development narration, task references, or session residue.
- Express positive scope boundaries: state what each component does and which mechanism owns it.
- Include cross-reference links only in hub sections or the Consequences section where acting correctly requires reading the target.
-->

## Context

[Describe the architectural context, requirements, forces, and constraints.
Explain the technical tension or problem that requires a decision. Focus on
invariants, interface contracts, protocol differences, or storage boundaries.
Do not include conversational residue, authoring narration, or references to
temporary plans.]

## Decision

[State the architectural decision and identify module ownership directly
(e.g., `lib/<module>.mjs` owns...). Detail the concrete interfaces, data
structures, protocols, or storage patterns adopted.]

**[Key Mechanism or Policy Name].** [Describe the specific mechanism, its
invariants, and its parameters. Use bold sub-headings to break down distinct
facets of the decision, such as data contracts, authorization rules, error
handling, or lifecycle boundaries.]

**[Positive Scope Boundary].** [State clearly what the module owns and which
mechanism executes it. Formulate boundaries positively around ownership rather
than describing what an implementation is not.]

## Consequences

[List the durable outcomes, operational guarantees, and architectural
trade-offs resulting from this decision. Focus on verifiable system behavior.]

- [Guarantees]: [State the operational or structural guarantees established.]
- [Failure modes]: [Describe how invalid inputs, network failures, or edge
  cases are handled.]
- [System interactions]: [Describe the effect on consumers such as the desktop
  renderer, CLI, voice runtime, or daemon.]
- [Cross-references]: [Include just-in-time links to adjacent ADRs when
  operating correctly depends on their contracts (e.g., see
  [ADR NNNN](adr-NNNN-<slug>.md)).]
