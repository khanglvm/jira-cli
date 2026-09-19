function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function describeTransition(transition) {
  const destination = transition.to?.name ? ` -> ${transition.to.name}` : "";
  return `${transition.id}:${transition.name}${destination}`;
}

export function selectTransition(transitions, requested, issueKey) {
  const wanted = normalize(requested);
  const available = Array.isArray(transitions) ? transitions : [];
  const selectors = [
    (transition) => transition.id,
    (transition) => transition.name,
    (transition) => transition.to?.name,
  ];

  for (const select of selectors) {
    const matches = available.filter((transition) => normalize(select(transition)) === wanted);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `Transition "${requested}" is ambiguous for ${issueKey}. Matches: ${matches.map(describeTransition).join(", ")}. Use a transition id.`,
      );
    }
  }

  throw new Error(
    `No transition matching "${requested}" for ${issueKey}. Available: ${available.map(describeTransition).join(", ")}`,
  );
}
