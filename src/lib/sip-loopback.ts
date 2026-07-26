/**
 * What happens when you dial one of your *own* inbound numbers.
 *
 * The call leaves through an outbound trunk, arrives back on an inbound trunk,
 * and a dispatch rule decides who answers it. That is the quickest end-to-end
 * SIP test, but the answer depends entirely on the rule: with an agent attached
 * the caller reaches an agent (so an agent already in your room ends up talking
 * to another agent), and without one it reaches an empty room.
 */

export interface DispatchRuleSummary {
  ruleId: string;
  name: string;
  trunkIds: string[];
  inboundNumbers: string[];
  /** Agents this rule dispatches into the room it creates. */
  agents: string[];
}

export interface InboundNumber {
  number: string;
  /** Display name of the trunk that owns the number. */
  trunk: string;
  trunkId: string;
}

export type LoopbackOutcome =
  /** A dispatch rule answers with one or more agents. */
  | { kind: "agent"; agents: string[]; ruleName: string }
  /** A rule matches but dispatches nobody — the caller sits in an empty room. */
  | { kind: "empty"; agents: []; ruleName: string }
  /** Nothing matches, so the server has no room to put the call in. */
  | { kind: "rejected"; agents: [] };

/**
 * Rules that would answer a call arriving on `trunkId` for `number`.
 * Empty `trunkIds` or `inboundNumbers` on a rule mean "any", which is how
 * LiveKit treats a wildcard rule.
 */
export function rulesAnswering(
  rules: DispatchRuleSummary[],
  trunkId: string,
  number: string
): DispatchRuleSummary[] {
  return rules.filter(
    (rule) =>
      (rule.trunkIds.length === 0 || rule.trunkIds.includes(trunkId)) &&
      (rule.inboundNumbers.length === 0 || rule.inboundNumbers.includes(number))
  );
}

export function loopbackOutcome(
  rules: DispatchRuleSummary[],
  inbound: InboundNumber
): LoopbackOutcome {
  const matched = rulesAnswering(rules, inbound.trunkId, inbound.number);
  if (matched.length === 0) return { kind: "rejected", agents: [] };

  const withAgent = matched.find((rule) => rule.agents.length > 0);
  if (withAgent) {
    return {
      kind: "agent",
      agents: withAgent.agents,
      ruleName: withAgent.name || withAgent.ruleId,
    };
  }

  const first = matched[0];
  return { kind: "empty", agents: [], ruleName: first.name || first.ruleId };
}
