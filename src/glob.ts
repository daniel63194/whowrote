/**
 * Compiles the small glob language used for agent config files in the registry:
 * `**\/` at the start matches any folder (or none), `/**` at the end matches everything below a folder,
 * and `*` matches within one path segment. Everything else is literal.
 */
export function globToRegExp(glob: string): RegExp {
  let rest = glob;
  let prefix = '';
  let suffix = '';
  if (rest.startsWith('**/')) {
    prefix = '(?:[^/]+/)*';
    rest = rest.slice(3);
  }
  if (rest.endsWith('/**')) {
    suffix = '/.+';
    rest = rest.slice(0, -3);
  }
  const body = rest
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${prefix}${body}${suffix}$`);
}

/** The same glob as a git pathspec, for `git log -- <pathspec>`. */
export function globToPathspec(glob: string): string {
  return `:(glob)${glob}`;
}
