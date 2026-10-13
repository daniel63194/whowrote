export { classifyActor, classifyCommit, classifyPullRequest, identify, isAI, isBot, isHuman } from './classify.js';
export { parseIdentity } from './identity.js';
export { getTool, tools } from './registry.js';
export type {
  CommitInput,
  Evidence,
  GitHubCommit,
  GitHubPullRequest,
  Identity,
  IdentityInput,
  PullRequestInput,
  Result,
  Scope,
  Signal,
  Tool,
  ToolKind,
  ToolUse,
  Verdict,
} from './types.js';
