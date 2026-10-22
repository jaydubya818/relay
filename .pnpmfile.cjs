// Match the source and installed-manifest patch for this exact registry release.
// Its only fast-glob caller now imports tinyglobby; neither package is aliased.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "@next/eslint-plugin-next" && pkg.version === "15.5.27") {
        delete pkg.dependencies["fast-glob"];
        pkg.dependencies.tinyglobby = "0.2.17";
      }
      return pkg;
    },
  },
};
