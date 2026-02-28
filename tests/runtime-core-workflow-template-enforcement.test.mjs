import test from "node:test";
import assert from "node:assert/strict";
import { parseModelProposal, expandTemplate, validateSteps } from "../packages/polar-runtime-core/src/workflow-engine.mjs";

test("workflow-engine parses valid template action", () => {
    const text = `<polar_action>{"template": "lookup_weather", "args": {"location": "London"}}</polar_action>`;
    const result = parseModelProposal(text);
    assert.equal(result.templateId, "lookup_weather");
    assert.equal(result.args.location, "London");
});

test("workflow-engine rejects unknown template", () => {
    const text = `<polar_action>{"template": "hack_mainframe", "args": {}}</polar_action>`;
    const result = parseModelProposal(text);
    assert.ok(result.error !== undefined);
});

test("workflow-engine ignores legacy <polar_workflow> blocks", () => {
    const text = `<polar_workflow>{"template": "lookup_weather", "args": {"location": "London"}}</polar_workflow>`;
    const result = parseModelProposal(text);
    assert.equal(result, null);
});

test("workflow-engine expands template deterministically", () => {
    const steps = expandTemplate("delegate_to_agent", {
        agentId: "@writer",
        task_instructions: "Write a poem",
        forward_skills: ["search_web"]
    });

    assert.equal(steps.length, 1);
    assert.equal(steps[0].extensionId, "system");
    assert.equal(steps[0].capabilityId, "delegate_to_agent");
    assert.equal(steps[0].args.agentId, "@writer");
});

test("workflow-engine validateSteps checks against capabilityScope", () => {
    const steps = [
        { extensionId: "email", capabilityId: "draft_email" }
    ];

    const validation = validateSteps(steps, {
        capabilityScope: { allowed: { "system": ["lookup_weather"] } } // no email allowed
    });

    assert.equal(validation.ok, false);
    assert.ok(validation.errors[0].includes("email"));
});
test("workflow-engine rejects missing required args during expansion", () => {
    assert.throws(() => {
        expandTemplate("lookup_weather", {}); // location is required
    }, /missing required arguments/);
});

test("workflow-engine expansion keeps optional args if present", () => {
    const steps = expandTemplate("delegate_to_agent", {
        agentId: "@writer",
        task_instructions: "Write a poem",
        model_override: "gpt-4-mini"
    });
    assert.equal(steps[0].args.model_override, "gpt-4-mini");
});
