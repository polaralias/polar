import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPolarPlatform, closePolarPlatform } from "../packages/polar-platform/src/index.mjs";

test("integration vertical slice boots platform, orchestrates with mocked provider, and persists feedback events", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "polar-vertical-slice-"));
  const dbPath = join(tempDirectory, "vertical-slice.db");

  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    const responseText = "{\"facts\":[]}";
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: responseText }],
            },
          ],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 4,
            total_tokens: 12,
          },
        };
      },
    };
  };

  const nowMs = Date.UTC(2026, 2, 1, 12, 0, 0);
  const platform = createPolarPlatform({
    dbPath,
    now: () => nowMs,
  });
  let platformClosed = false;

  try {
    assert.equal(typeof platform.dbPath, "string");
    assert.equal(platform.db.prepare("select 1").pluck().get(), 1);

    await platform.controlPlane.upsertConfig({
      resourceType: "provider",
      resourceId: "openai",
      config: {
        endpointMode: "responses",
        baseUrl: "https://mock.provider.local/v1/responses",
        apiKey: "test-key",
      },
    });
    await platform.controlPlane.upsertPersonalityProfile({
      scope: "user",
      userId: "integration-user-1",
      prompt: "Use concise bullet points and a calm tone.",
    });

    const orchestrated = await platform.controlPlane.orchestrate({
      sessionId: "integration-session-1",
      userId: "integration-user-1",
      messageId: "msg_u_integration_1",
      text: "Please summarize this setup in one line.",
    });

    assert.equal(orchestrated.status, "completed");
    assert.equal(typeof orchestrated.text, "string");
    assert.ok(orchestrated.text.length > 0);
    assert.ok(fetchCalls.length >= 1);
    assert.equal(fetchCalls[0].url, "https://mock.provider.local/v1/responses");
    const callWithPersonality = fetchCalls.find((entry) => {
      const body = entry?.init?.body;
      if (typeof body !== "string") return false;
      try {
        const parsed = JSON.parse(body);
        const input = Array.isArray(parsed.input) ? parsed.input : [];
        return input.some((item) =>
          JSON.stringify(item).includes("## Personality"),
        );
      } catch {
        return false;
      }
    });
    assert.ok(callWithPersonality);

    const recorded = await platform.controlPlane.recordFeedbackEvent({
      type: "reaction_added",
      sessionId: "integration-session-1",
      messageId: "msg_a_integration_1",
      emoji: "👍",
      polarity: "positive",
      payload: {
        source: "integration-test",
        reason: "Looks good",
      },
    });

    assert.equal(recorded.status, "recorded");
    assert.equal(recorded.sessionId, "integration-session-1");

    const listed = await platform.controlPlane.listFeedbackEvents({
      sessionId: "integration-session-1",
      limit: 10,
    });
    assert.equal(listed.status, "ok");
    assert.equal(listed.totalCount, 1);
    assert.equal(listed.items[0].messageId, "msg_a_integration_1");
    assert.equal(listed.items[0].payload.source, "integration-test");

    closePolarPlatform(platform);
    platformClosed = true;

    const rehydrated = createPolarPlatform({
      dbPath,
      now: () => nowMs,
    });
    try {
      const afterReopen = await rehydrated.controlPlane.listFeedbackEvents({
        sessionId: "integration-session-1",
        limit: 10,
      });
      assert.equal(afterReopen.status, "ok");
      assert.equal(afterReopen.totalCount, 1);
      assert.equal(afterReopen.items[0].emoji, "👍");

      const personalityAfterReopen =
        await rehydrated.controlPlane.getPersonalityProfile({
          scope: "user",
          userId: "integration-user-1",
        });
      assert.equal(personalityAfterReopen.status, "found");
      assert.equal(
        personalityAfterReopen.profile.prompt,
        "Use concise bullet points and a calm tone.",
      );
    } finally {
      closePolarPlatform(rehydrated);
    }
  } finally {
    if (!platformClosed) {
      closePolarPlatform(platform);
    }
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("integration: lane-scoped context, focus-anchor routing, and normalized tool failures stay contained", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "polar-context-routing-"));
  const dbPath = join(tempDirectory, "context-routing.db");

  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    const bodyText = typeof init?.body === "string" ? init.body : "{}";
    const parsed = JSON.parse(bodyText);
    fetchCalls.push({ url, parsed });

    const inputText = JSON.stringify(parsed.input ?? []);
    const isRouter = inputText.includes("You are a routing model. Output strict JSON only.");
    const outputText = isRouter
      ? JSON.stringify({
          decision: "delegate",
          target: { agentId: "@generic_sub_agent" },
          confidence: 0.4,
          rationale: "ambiguous pronoun",
          references: {
            refersTo: "focus_anchor",
            refersToReason: "use focused lane anchor",
          },
        })
      : "ack";

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: outputText }],
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      },
    };
  };

  const nowMs = Date.UTC(2026, 2, 2, 10, 0, 0);
  let tickMs = nowMs;
  const platform = createPolarPlatform({ dbPath, now: () => ++tickMs });

  try {
    await platform.controlPlane.upsertConfig({
      resourceType: "provider",
      resourceId: "openai",
      config: {
        endpointMode: "responses",
        baseUrl: "https://mock.provider.local/v1/responses",
        apiKey: "test-key",
      },
    });

    const sessionId = "telegram:chat:99";
    const userId = "integration-user-ctx";
    const laneA = "topic:99:1";
    const laneB = "topic:99:2";

    for (let index = 0; index < 32; index += 1) {
      await platform.controlPlane.orchestrate({
        sessionId,
        userId,
        messageId: `lane-a-${index}`,
        text: `lane A message ${index}`,
        metadata: { threadKey: laneA },
      });
    }

    for (let index = 0; index < 3; index += 1) {
      await platform.controlPlane.orchestrate({
        sessionId,
        userId,
        messageId: `lane-b-${index}`,
        text: `lane B message ${index}`,
        metadata: { threadKey: laneB },
      });
    }

    const laneASummary = await platform.controlPlane.getMemory({
      executionType: "handoff",
      scope: "session",
      sessionId,
      userId,
      memoryId: `thread_summary:${sessionId}:${laneA}`,
    });
    assert.equal(laneASummary.status, "completed");
    assert.equal(laneASummary.record.type, "thread_summary");
    assert.equal(laneASummary.record.threadKey, laneA);

    const sessionSummary = await platform.controlPlane.getMemory({
      executionType: "handoff",
      scope: "session",
      sessionId,
      userId,
      memoryId: `session_summary:${sessionId}`,
    });
    assert.equal(sessionSummary.status, "completed");
    assert.equal(sessionSummary.record.type, "session_summary");

    const beforeFinalCall = fetchCalls.length;
    await platform.controlPlane.orchestrate({
      sessionId,
      userId,
      messageId: "lane-a-final",
      text: "lane A follow-up",
      metadata: { threadKey: laneA },
    });
    const finalCall = fetchCalls.slice(beforeFinalCall).at(-1);
    const finalInput = Array.isArray(finalCall.parsed.input) ? finalCall.parsed.input : [];
    const finalInputText = JSON.stringify(finalInput);
    const recencyText = JSON.stringify(finalInput.filter((entry) => entry.role !== "developer"));
    assert.match(finalInputText, /\[THREAD_SUMMARY threadKey=topic:99:1\]/);
    assert.match(recencyText, /lane A follow-up/);
    assert.doesNotMatch(recencyText, /lane B message 2/);

    await platform.controlPlane.orchestrate({
      sessionId,
      userId,
      messageId: "focus-old",
      text: "retry weather tool",
      metadata: { threadKey: laneA },
    });
    await platform.controlPlane.orchestrate({
      sessionId,
      userId,
      messageId: "focus-new",
      text: "send project update email",
      metadata: { threadKey: laneA },
    });

    const beforeRouter = fetchCalls.length;
    const ambiguous = await platform.controlPlane.orchestrate({
      sessionId,
      userId,
      messageId: "focus-ambiguous",
      text: "do that",
      metadata: { threadKey: laneA },
    });
    assert.equal(ambiguous.type, "clarification_needed");
    assert.match(ambiguous.text, /Quick check: should I Continue with "[^"]+" or Delegate to a sub-agent\?/i);

    const routerCall = fetchCalls
      .slice(beforeRouter)
      .find((entry) => JSON.stringify(entry.parsed.input ?? []).includes("routing model"));
    assert.ok(routerCall);
    const routerPayloadText = JSON.stringify(routerCall.parsed.input ?? []);
    assert.match(routerPayloadText, /focusAnchorTextSnippet\\":\\"send project update email/);

    const failedWorkflowTurn = await platform.controlPlane.orchestrate({
      sessionId,
      userId,
      messageId: "wf-failure",
      text: "Please search the web for orbital launches",
      metadata: { threadKey: laneA },
    });
    assert.equal(typeof failedWorkflowTurn.text, "string");

    const postFailure = await platform.controlPlane.orchestrate({
      sessionId,
      userId,
      messageId: "post-failure",
      text: "do that",
      metadata: { threadKey: laneA },
    });
    assert.notEqual(postFailure.status, "error");
  } finally {
    closePolarPlatform(platform);
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
