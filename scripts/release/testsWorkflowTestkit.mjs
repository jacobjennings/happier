// Shared expectations for contract tests that read .github/workflows/tests.yml.

// The automatic v0.3 Gate replaces the ordinary jobs on v0.3 pushes and PRs;
// explicit reusable selection keeps each job's own boundary underneath it.
export const V03_GATE_SKIP = "(!(!inputs.select_jobs_explicitly && ((github.event_name == 'push' && github.ref_name == 'v0.3') || (github.event_name == 'pull_request' && github.base_ref == 'v0.3'))))";

/** Returns an ordinary job's own `if` with the v0.3 Gate skip prefix removed (unchanged when absent). */
export function withoutV03GateSkip(expression) {
  const prefix = `\${{ ${V03_GATE_SKIP} && (`;
  if (typeof expression !== 'string' || !expression.startsWith(prefix) || !expression.endsWith(') }}')) return expression;
  return `\${{ ${expression.slice(prefix.length, -') }}'.length)} }}`;
}
