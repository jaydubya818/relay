import * as upstream from "minimatch-upstream";

const minimatch = upstream.minimatch;

minimatch.minimatch = minimatch;
minimatch.default = minimatch;
minimatch.Minimatch = upstream.Minimatch;
minimatch.filter = upstream.filter;
minimatch.defaults = upstream.defaults;
minimatch.braceExpand = upstream.braceExpand;
minimatch.match = upstream.match;
minimatch.sep = upstream.sep;
minimatch.GLOBSTAR = upstream.GLOBSTAR;
minimatch.escape = upstream.escape;
minimatch.unescape = upstream.unescape;
minimatch.makeRe = function makeRe(pattern, options) {
  const mm = new upstream.Minimatch(pattern, options);
  return {
    test: (value) => mm.match(String(value)),
  };
};

export default minimatch;
export { minimatch };
export const Minimatch = upstream.Minimatch;
export const filter = upstream.filter;
export const defaults = upstream.defaults;
export const braceExpand = upstream.braceExpand;
export const match = upstream.match;
export const sep = upstream.sep;
export const GLOBSTAR = upstream.GLOBSTAR;
export const escape = upstream.escape;
export const unescape = upstream.unescape;
