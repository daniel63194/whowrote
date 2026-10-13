export { classifyActor, classifyCommit, classifyPullRequest, identify, isAI, isBot, isHuman } from './classify.js';
export { parseIdentity } from './identity.js';
export { parseNotes, type NoteAttribution } from './notes.js';
export { detectAgentSetup, type AgentSetup } from './setup.js';
export { getTool, tools } from './registry.js';
export type {
  CommitInput,
  Evidence,
  GitHubCommit,
  GitHubPullRequest,
  Hint,
  Identity,
  IdentityInput,
  PullRequestContext,
  PullRequestInput,
  Result,
  Scope,
  Signal,
  Tool,
  ToolKind,
  ToolUse,
  Verdict,
} from './types.js';
