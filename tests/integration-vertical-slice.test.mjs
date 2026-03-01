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
