/**
 * Offline promotion gate: run only with deployment metadata retrieved from
 * Railway, not branch heads or manually guessed environment names.
 *
 * Example:
 * node scripts/release-parity.mjs --staging-sha <40-hex> --candidate-sha <40-hex> \
 *   --staging-status SUCCESS --staging-builder RAILPACK --production-builder RAILPACK \
 *   --staging-branch feature/showcase-unified-auth-20261114 \
 *   --production-branch release/production-promoted-20261114
 *
 * This gate does not deploy, submit provider tasks or touch production data.
 */
const SHA = /^[0-9a-f]{40}$/i;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const allowedBuilders = new Set(["RAILPACK", "NIXPACKS", "DOCKERFILE"]);
export function assessPromotion({
  stagingSha,
  candidateSha,
  stagingStatus,
  stagingBuilder,
  productionBuilder,
  stagingBranch,
  productionBranch,
  stagingImageDigest,
  candidateImageDigest,
} = {}) {
  const failures = [];
  if (!SHA.test(stagingSha || "") || !SHA.test(candidateSha || ""))
    failures.push("Both commits must be exact 40-character Git SHAs from deployed artifacts.");
  else if (stagingSha.toLowerCase() !== candidateSha.toLowerCase())
    failures.push("Staging deployment and production candidate must use the identical Git commit.");
  // A shared branch causes both Railway environments to deploy simultaneously.
  // Production must follow its own reviewed release ref: staging success FIRST.
  if (!BRANCH.test(stagingBranch || "") || !BRANCH.test(productionBranch || ""))
    failures.push("Both live Railway source branches must be provided.");
  else {
    if (stagingBranch === productionBranch)
      failures.push("Staging and Production must not auto-deploy the same branch.");
    if (!productionBranch.startsWith("release/"))
      failures.push("Production must follow a dedicated release/* branch.");
  }
  if (stagingStatus !== "SUCCESS")
    failures.push("Staging deployment must have succeeded before promotion.");
  if (!allowedBuilders.has(stagingBuilder) || !allowedBuilders.has(productionBuilder))
    failures.push("Both environments must declare a recognized build system.");
  else if (stagingBuilder !== productionBuilder)
    failures.push("Staging and production build systems differ.");
  if (stagingImageDigest || candidateImageDigest) {
    if (!/^sha256:[0-9a-f]{64}$/i.test(stagingImageDigest || "") ||
        !/^sha256:[0-9a-f]{64}$/i.test(candidateImageDigest || "") ||
        stagingImageDigest.toLowerCase() !== candidateImageDigest.toLowerCase())
      failures.push("Supplied staging and candidate image digests must match exactly.");
  }
  return { permitted: failures.length === 0, failures };
}
function parseArgs(args) {
  const params = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z-]+$/.test(args[i]) || i + 1 >= args.length)
      throw Error("Expected --key value pairs.");
    const key = args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in {
      stagingSha: 1, candidateSha: 1, stagingStatus: 1,
      stagingBuilder: 1, productionBuilder: 1,
      stagingBranch: 1, productionBranch: 1,
      stagingImageDigest: 1, candidateImageDigest: 1,
    }) || key in params)
      throw Error("Unexpected or duplicate argument.");
    params[key] = args[i + 1];
  }
  return params;
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  try {
    const gate = assessPromotion(parseArgs(process.argv.slice(2)));
    if (!gate.permitted) {
      gate.failures.forEach(reason => console.error("PROMOTION_BLOCKED:", reason));
      process.exitCode = 1;
    } else {
      console.log("PROMOTION_CHECK_PASSED: exact staged commit and build strategy verified.");
    }
  } catch (error) {
    console.error("PROMOTION_BLOCKED:", error.message);
    process.exitCode = 1;
  }
}
