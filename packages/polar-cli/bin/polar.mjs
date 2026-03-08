#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createPolarPlatform,
  defaultAgentConfigDir,
  defaultDbPath,
} from "@polar/platform";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printUsage() {
  console.log(`Usage:
  polar agents list
  polar agents show <agentId>
  polar agents export-yaml <agentId>
  polar agents apply-yaml <filePath>
  polar agents set-model <agentId> --provider <providerId> --model <modelId>
  polar agents set-tools <agentId> --skills <skillA,skillB|none>
  polar agents set-prompt <agentId> --text <systemPrompt>
  polar agents pin <agentId> --scope <session|user|global> [--session <sessionId>] [--user <userId>]
  polar config set <resourceType> <resourceId> [--key value ...]`);
}

function parseArgs(args) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { positionals, flags };
}

function parseJsonish(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeSkills(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return [];
  }
  if (rawValue.trim().toLowerCase() === "none") {
    return [];
  }
  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function withPlatform(flags, handler) {
  const dbPath = resolve(typeof flags.db === "string" ? flags.db : defaultDbPath());
  const agentConfigDir = resolve(
    typeof flags["agent-config-dir"] === "string"
      ? flags["agent-config-dir"]
      : defaultAgentConfigDir(),
  );
  const platform = createPolarPlatform({ dbPath, agentConfigDir });
  try {
    await platform.bootstrapPromise;
    await handler(platform);
  } finally {
    platform.shutdown();
  }
}

async function handleAgents(positionals, flags) {
  const subcommand = positionals[0];
  if (!subcommand) {
    printUsage();
    process.exit(1);
  }
  await withPlatform(flags, async (platform) => {
    const { controlPlane, agentConfigStore } = platform;
    if (subcommand === "list") {
      const listed = await controlPlane.listAgentProfiles();
      const items = Array.isArray(listed.items) ? listed.items : [];
      for (const item of items) {
        const model =
          item?.modelPolicy?.providerId && item?.modelPolicy?.modelId
            ? ` [${item.modelPolicy.providerId}/${item.modelPolicy.modelId}]`
            : "";
        console.log(`${item.agentId} -> ${item.profileId}: ${item.description}${model}`);
      }
      return;
    }

    if (subcommand === "show") {
      const agentId = positionals[1];
      if (!agentId) {
        fail("Usage: polar agents show <agentId>");
      }
      const result = await controlPlane.getAgentConfiguration({ agentId });
      if (result.status !== "found") {
        fail(`Agent not found: ${agentId}`);
      }
      console.log(JSON.stringify({
        agent: result.agent,
        profileConfig: result.profileConfig,
        configuration: result.configuration,
        configFile: resolve(agentConfigStore.agentConfigDir, `${String(result.agent.agentId).replace(/^@/, "")}.yaml`),
      }, null, 2));
      return;
    }

    if (subcommand === "export-yaml") {
      const agentId = positionals[1];
      if (!agentId) {
        fail("Usage: polar agents export-yaml <agentId>");
      }
      const result = await controlPlane.exportAgentConfigurationYaml({ agentId });
      if (result.status !== "found") {
        fail(`Agent not found: ${agentId}`);
      }
      console.log(result.yamlText);
      return;
    }

    if (subcommand === "apply-yaml") {
      const filePath = positionals[1];
      if (!filePath) {
        fail("Usage: polar agents apply-yaml <filePath>");
      }
      const yamlText = readFileSync(resolve(filePath), "utf8");
      const result = await agentConfigStore.applyYamlText(yamlText);
      console.log(`Applied ${result.agent.agentId} -> ${result.agent.profileId}`);
      return;
    }

    if (subcommand === "set-model") {
      const agentId = positionals[1];
      const providerId = flags.provider;
      const modelId = flags.model;
      if (!agentId || typeof providerId !== "string" || typeof modelId !== "string") {
        fail("Usage: polar agents set-model <agentId> --provider <providerId> --model <modelId>");
      }
      const found = await controlPlane.getAgentConfiguration({ agentId });
      if (found.status !== "found") {
        fail(`Agent not found: ${agentId}`);
      }
      const configuration = {
        ...found.configuration,
        profile: {
          ...(found.configuration.profile || {}),
          modelPolicy: {
            ...(found.configuration.profile?.modelPolicy || {}),
            providerId,
            modelId,
          },
        },
      };
      const result = await agentConfigStore.applyConfiguration(configuration);
      console.log(`Updated ${result.agent.agentId} model to ${providerId}/${modelId}`);
      return;
    }

    if (subcommand === "set-tools") {
      const agentId = positionals[1];
      if (!agentId || typeof flags.skills !== "string") {
        fail("Usage: polar agents set-tools <agentId> --skills <skillA,skillB|none>");
      }
      const allowedSkills = normalizeSkills(flags.skills);
      const found = await controlPlane.getAgentConfiguration({ agentId });
      if (found.status !== "found") {
        fail(`Agent not found: ${agentId}`);
      }
      const currentDefaults = Array.isArray(found.configuration.forwarding?.defaultForwardSkills)
        ? found.configuration.forwarding.defaultForwardSkills
        : [];
      const configuration = {
        ...found.configuration,
        forwarding: {
          ...(found.configuration.forwarding || {}),
          allowedForwardSkills: allowedSkills,
          defaultForwardSkills: currentDefaults.filter((skill) => allowedSkills.includes(skill)),
        },
        profile: {
          ...(found.configuration.profile || {}),
          allowedSkills,
        },
      };
      const result = await agentConfigStore.applyConfiguration(configuration);
      console.log(`Updated ${result.agent.agentId} allowed skills to ${allowedSkills.join(", ") || "(none)"}`);
      return;
    }

    if (subcommand === "set-prompt") {
      const agentId = positionals[1];
      const systemPrompt = flags.text;
      if (!agentId || typeof systemPrompt !== "string" || systemPrompt.trim().length === 0) {
        fail("Usage: polar agents set-prompt <agentId> --text <systemPrompt>");
      }
      const found = await controlPlane.getAgentConfiguration({ agentId });
      if (found.status !== "found") {
        fail(`Agent not found: ${agentId}`);
      }
      const configuration = {
        ...found.configuration,
        profile: {
          ...(found.configuration.profile || {}),
          systemPrompt,
        },
      };
      const result = await agentConfigStore.applyConfiguration(configuration);
      console.log(`Updated prompt for ${result.agent.agentId}`);
      return;
    }

    if (subcommand === "pin") {
      const agentId = positionals[1];
      const scope = typeof flags.scope === "string" ? flags.scope : "session";
      if (!agentId) {
        fail("Usage: polar agents pin <agentId> --scope <session|user|global> [--session <sessionId>] [--user <userId>]");
      }
      const found = await controlPlane.getAgentProfile({ agentId });
      if (found.status !== "found") {
        fail(`Agent not found: ${agentId}`);
      }
      const result = await controlPlane.pinProfileForScope({
        scope,
        profileId: found.agent.profileId,
        ...(typeof flags.session === "string" ? { sessionId: flags.session } : {}),
        ...(typeof flags.user === "string" ? { userId: flags.user } : {}),
      });
      console.log(`Pinned ${found.agent.agentId} (${found.agent.profileId}) for ${result.scope} scope`);
      return;
    }

    fail(`Unknown agents subcommand: ${subcommand}`);
  });
}

async function handleConfig(positionals, flags) {
  if (positionals[0] !== "set") {
    fail("Usage: polar config set <resourceType> <resourceId> [--key value ...]");
  }
  const resourceType = positionals[1];
  const resourceId = positionals[2];
  if (!resourceType || !resourceId) {
    fail("Usage: polar config set <resourceType> <resourceId> [--key value ...]");
  }
  await withPlatform(flags, async ({ controlPlane }) => {
    const config = {};
    for (const [key, value] of Object.entries(flags)) {
      if (key === "db" || key === "agent-config-dir") {
        continue;
      }
      config[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
        parseJsonish(String(value));
    }
    const result = await controlPlane.upsertConfig({
      resourceType,
      resourceId,
      config,
    });
    console.log(JSON.stringify(result, null, 2));
  });
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rawArgs);
  const [command, ...rest] = positionals;
  if (!command) {
    printUsage();
    process.exit(1);
  }
  if (command === "agents") {
    await handleAgents(rest, flags);
    return;
  }
  if (command === "config") {
    await handleConfig(rest, flags);
    return;
  }
  fail(`Unknown command: ${command}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
