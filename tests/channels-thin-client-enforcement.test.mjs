import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const webChatPath = path.join(repoRoot, "packages", "polar-web-ui", "src", "views", "chat.js");
const webVitePath = path.join(repoRoot, "packages", "polar-web-ui", "vite.config.js");
const telegramRunnerPath = path.join(repoRoot, "packages", "polar-bot-runner", "src", "index.mjs");

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("web chat is a thin client: uses backend orchestration endpoints only", () => {
  const chatSource = readFile(webChatPath);
  const viteSource = readFile(webVitePath);

  assert.match(chatSource, /fetchApi\('orchestrate'/);
  assert.match(chatSource, /fetchApi\('executeWorkflow'/);
  assert.match(chatSource, /fetchApi\('rejectWorkflow'/);
  assert.match(chatSource, /fetchApi\('handleRepairSelection'/);

  assert.doesNotMatch(chatSource, /fetchApi\('generateOutput'/);
  assert.doesNotMatch(chatSource, /providerGateway\.generate/);
  assert.doesNotMatch(chatSource, /<polar_action>/);

  assert.match(
    viteSource,
    /'orchestrate'[\s\S]*'executeWorkflow'[\s\S]*'rejectWorkflow'[\s\S]*'handleRepairSelection'/,
  );
});

test("telegram runner renders workflow proposal controls and processes approval callbacks", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /result\.status === 'workflow_proposed'/);
  assert.match(runnerSource, /callback_data: `wf_app:\$\{result\.workflowId\}`/);
  assert.match(runnerSource, /callback_data: `wf_rej:\$\{result\.workflowId\}`/);
  assert.match(runnerSource, /controlPlane\.executeWorkflow\(workflowId\)/);
  assert.match(runnerSource, /controlPlane\.rejectWorkflow\(workflowId\)/);
});

test("telegram runner renders repair_question buttons and processes selection events", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /result\.status === 'repair_question'/);
  assert.match(runnerSource, /callback_data: `repair_sel:A:\$\{result\.correlationId\}`/);
  assert.match(runnerSource, /callback_data: `repair_sel:B:\$\{result\.correlationId\}`/);
  assert.match(runnerSource, /callbackData\.startsWith\('repair_sel:'\)/);
  assert.match(runnerSource, /controlPlane\.handleRepairSelection\(/);
});

test("telegram inline reply anchoring is strict: invalid anchor disables inline reply", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /const useInlineReply = result\.useInlineReply === true/);
  assert.match(runnerSource, /const parsedAnchor = .*Number\(anchorId\)/);
  assert.match(runnerSource, /const numericAnchor =[\s\S]*\? parsedAnchor[\s\S]*: null/);
  assert.match(runnerSource, /if \(useInlineReply && numericAnchor !== null\)/);
  assert.match(runnerSource, /reply_parameters: \{ message_id: numericAnchor \}/);
  assert.doesNotMatch(runnerSource, /numericAnchor \|\| telegramMessageId/);
});

test("web chat renders repair_question A/B controls and routes selection to handleRepairSelection", () => {
  const chatSource = readFile(webChatPath);

  assert.match(chatSource, /result\.status === 'repair_question'/);
  assert.match(chatSource, /repair-select-btn-A-/);
  assert.match(chatSource, /repair-select-btn-B-/);
  assert.match(chatSource, /fetchApi\('handleRepairSelection', \{/);
  assert.match(chatSource, /selection: 'A'/);
  assert.match(chatSource, /selection: 'B'/);
  assert.match(chatSource, /correlationId: result\.correlationId/);
});
