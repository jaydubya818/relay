import { privatePreviewEnvironmentIssues } from "../lib/v2/deployment";

const issues = privatePreviewEnvironmentIssues();
if (issues.length) {
  console.error("Relay private-preview configuration is not deployable:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log("Relay private-preview configuration is valid. Consequential V2 runtime actions are disabled.");
}
