import { SHARED_AGENT_FILES, configFileOwner } from './registry.js';
import type { Tool } from './types.js';

/** An AI tool a repository is set up for, and the files that show it. */
export interface AgentSetup {
  /** The registry tool, or undefined for instructions several agents share (AGENTS.md). */
  tool?: Tool;
  /** The tool's name, or "Shared agent instructions". */
  name: string;
  files: string[];
}

/**
 * Finds the AI tools a repository is configured for, from its file list (for example the output of
 * `git ls-files`): `CLAUDE.md` → Claude, `.cursor/rules/…` → Cursor, `AGENTS.md` → shared instructions.
 * This says the tools are set up, not that any particular change was written with them.
 */
export function detectAgentSetup(paths: Iterable<string>): AgentSetup[] {
  const byTool = new Map<string, AgentSetup>();
  for (const path of paths) {
    const owner = configFileOwner(path);
    if (!owner) continue;
    const key = owner.tool ? owner.tool.tool.id : '';
    let entry = byTool.get(key);
    if (!entry) {
      entry = owner.tool ? { tool: owner.tool.tool, name: owner.tool.tool.name, files: [] } : { name: SHARED_AGENT_FILES.name, files: [] };
      byTool.set(key, entry);
    }
    entry.files.push(path.replace(/^\.\//, ''));
  }
  return [...byTool.values()]
    .map((e) => ({ ...e, files: [...new Set(e.files)].sort() }))
    .sort((a, b) => (a.tool ? 0 : 1) - (b.tool ? 0 : 1) || a.name.localeCompare(b.name));
}
