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
  assert.match(runnerSource, /callback_data: `wf_app:\$\{result\.workflowId\}:\$\{telegramMessageId\}`/);
  assert.match(runnerSource, /callback_data: `wf_rej:\$\{result\.workflowId\}:\$\{telegramMessageId\}`/);
  assert.match(runnerSource, /controlPlane\.executeWorkflow\(workflowId\)/);
  assert.match(runnerSource, /controlPlane\.rejectWorkflow\(workflowId\)/);
});

test("telegram runner renders automation proposal controls and processes approval callbacks", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /result\.status === 'automation_proposed'/);
  assert.match(runnerSource, /callback_data: `auto_app:\$\{result\.proposalId\}:\$\{telegramMessageId\}`/);
  assert.match(runnerSource, /callback_data: `auto_rej:\$\{result\.proposalId\}:\$\{telegramMessageId\}`/);
  assert.match(runnerSource, /controlPlane\.consumeAutomationProposal\(proposalId\)/);
  assert.match(runnerSource, /controlPlane\.createAutomationJob\(/);
  assert.match(runnerSource, /controlPlane\.rejectAutomationProposal\(proposalId\)/);
});

test("telegram runner renders repair_question buttons and processes selection events", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /result\.status === 'repair_question'/);
  assert.match(runnerSource, /callback_data: `repair_sel:A:\$\{result\.correlationId\}:\$\{telegramMessageId\}`/);
  assert.match(runnerSource, /callback_data: `repair_sel:B:\$\{result\.correlationId\}:\$\{telegramMessageId\}`/);
  assert.match(runnerSource, /callbackData\.startsWith\('repair_sel:'\)/);
  assert.match(runnerSource, /controlPlane\.handleRepairSelection\(/);
});

test("telegram inline reply anchoring is strict: invalid anchor disables inline reply", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /const useInlineReply = result\.useInlineReply === true/);
  assert.match(runnerSource, /resolveAnchorChannelMessageId\(polarSessionId, anchorId\)/);
  assert.match(runnerSource, /if \(useInlineReply && numericAnchor !== null\)/);
  assert.match(runnerSource, /reply_parameters:[\s\S]*message_id: numericAnchor[\s\S]*allow_sending_without_reply: true/);
  assert.doesNotMatch(runnerSource, /numericAnchor \|\| telegramMessageId/);
});

test("telegram debounce buffer key includes session, threadKey, and user id", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /const messageThreadKey = deriveThreadKey\(ctx\.message\)/);
  assert.match(runnerSource, /const bufferKey = `\$\{polarSessionId\}\|\$\{messageThreadKey\}\|\$\{ctx\.from\.id\.toString\(\)\}`/);
  assert.match(runnerSource, /MESSAGE_BUFFER\.has\(bufferKey\)/);
});

test("telegram replies preserve message_thread_id when inbound turn is in a topic", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /const topicReplyOptions = buildTopicReplyOptions\(ctx\.message\)/);
  assert.match(runnerSource, /let replyOptions = \{ \.\.\.topicReplyOptions \}/);
  assert.match(runnerSource, /message_thread_id: inboundMessage\.message_thread_id/);
});

test("telegram runner resolves internal anchors and reactions via session history mappings", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /async function resolveAnchorChannelMessageId\(sessionId, anchorId\)/);
  assert.match(runnerSource, /controlPlane\.getSessionHistory\(\{ sessionId, limit: 500 \}\)/);
  assert.match(runnerSource, /bindingType === "channel_message_id"/);
  assert.match(runnerSource, /feedbackMessageId = resolvedInternalMessageId \|\| `telegram:\$\{reaction\.chat\.id\}:\$\{reaction\.message_id\}`/);
  assert.match(runnerSource, /unresolved: true/);
});

test("telegram emoji lifecycle uses explicit state transitions and timer-based clear", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /const REACTION_EMOJI_BY_STATE = Object\.freeze\(/);
  assert.match(runnerSource, /await setReactionState\(ctx, ctx\.chat\.id, telegramMessageId, 'received'\)/);
  assert.match(runnerSource, /await setReactionState\(ctx, ctx\.chat\.id, telegramMessageId, 'thinking'\)/);
  assert.match(runnerSource, /await setReactionState\(ctx, ctx\.chat\.id, telegramMessageId, 'waiting_user'\)/);
  assert.match(runnerSource, /await setReactionState\(ctx, ctx\.chat\.id, telegramMessageId, 'done'\)/);
  assert.match(runnerSource, /setTimeout\(\(\) => \{\s*clearReaction\(ctx, chatId, inboundMessageId\)/);
  assert.match(runnerSource, /transitionWaitingReactionToDone\(ctx, callbackData\)/);
});

test("telegram command routing is deterministic and handled before orchestration", () => {
  const runnerSource = readFile(telegramRunnerPath);

  assert.match(runnerSource, /createTelegramCommandRouter/);
  assert.match(runnerSource, /const result = await commandRouter\.handle\(ctx\)/);
  assert.match(runnerSource, /if \(result\.handled\) \{\s*return;/);
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

test("web ui allowlist includes personality profile control-plane actions", () => {
  const viteSource = readFile(webVitePath);

  assert.match(viteSource, /'getPersonalityProfile'/);
  assert.match(viteSource, /'getEffectivePersonality'/);
  assert.match(viteSource, /'upsertPersonalityProfile'/);
  assert.match(viteSource, /'resetPersonalityProfile'/);
  assert.match(viteSource, /'listPersonalityProfiles'/);
});
