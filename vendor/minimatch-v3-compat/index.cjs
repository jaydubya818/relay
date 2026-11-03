"use strict";

const upstream = require("minimatch-upstream");
const minimatch = upstream.minimatch;

module.exports = minimatch;
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
