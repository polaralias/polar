import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const DEFAULT_AGENT_CONFIGURATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    agentId: "@general",
    profileId: "profile.general",
    description: "General-purpose delegated worker for tasks that do not fit a specialist brief.",
    tags: ["general", "fallback"],
    forwarding: {
      defaultForwardSkills: [],
      allowedForwardSkills: [],
      defaultMcpServers: [],
      allowedMcpServers: [],
    },
    profile: {
      systemPrompt:
        "You are the general delegated worker. Complete bounded tasks pragmatically and return a concise outcome to the orchestrator.",
      modelPolicy: {
        providerId: "openai",
        modelId: "gpt-4.1-mini",
      },
      allowedSkills: [],
    },
  }),
  Object.freeze({
    version: 1,
    agentId: "@researcher",
    profileId: "profile.researcher",
    description: "Investigates topics across multiple sources and returns evidence-backed findings.",
    tags: ["research"],
    forwarding: {
      defaultForwardSkills: ["web"],
      allowedForwardSkills: ["web"],
      defaultMcpServers: [],
      allowedMcpServers: [],
    },
    profile: {
      systemPrompt:
        "You are the research sub-agent. Gather relevant evidence, compare sources, and return grounded findings with clear caveats.",
      modelPolicy: {
        providerId: "openai",
        modelId: "gpt-4.1-mini",
      },
      allowedSkills: ["web"],
    },
  }),
  Object.freeze({
    version: 1,
    agentId: "@writer",
    profileId: "profile.writer",
    description: "Produces polished prose, docs, drafts, and rewrites.",
    tags: ["writing"],
    forwarding: {
      defaultForwardSkills: [],
      allowedForwardSkills: [],
      defaultMcpServers: [],
      allowedMcpServers: [],
    },
    profile: {
      systemPrompt:
        "You are the writing sub-agent. Produce clean, readable drafts with good structure and tone, and return ready-to-use copy.",
      modelPolicy: {
        providerId: "openai",
        modelId: "gpt-4.1-mini",
      },
      allowedSkills: [],
    },
  }),
  Object.freeze({
    version: 1,
    agentId: "@coder",
    profileId: "profile.coder",
    description: "Handles code implementation, debugging, refactoring, and code review tasks.",
    tags: ["coding"],
    forwarding: {
      defaultForwardSkills: ["web"],
      allowedForwardSkills: ["web"],
      defaultMcpServers: [],
      allowedMcpServers: [],
    },
    profile: {
      systemPrompt:
        "You are the coding sub-agent. Solve implementation and debugging tasks methodically, and return concrete technical outcomes.",
      modelPolicy: {
        providerId: "openai",
        modelId: "gpt-4.1-mini",
      },
      allowedSkills: ["web"],
    },
  }),
]);

function ensureDirectory(pathname) {
  if (!existsSync(pathname)) {
    mkdirSync(pathname, { recursive: true });
  }
}

function agentConfigFilename(agentId) {
  const normalized =
    typeof agentId === "string" ? agentId.trim().replace(/^@/, "") : "agent";
  return `${normalized || "agent"}.yaml`;
}

function listYamlFiles(agentConfigDir) {
  if (!existsSync(agentConfigDir)) {
    return [];
  }
  return readdirSync(agentConfigDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yaml"))
    .map((entry) => resolve(agentConfigDir, entry.name))
    .sort();
}

/**
 * @param {{
 *   controlPlane: Record<string, (...args: unknown[]) => Promise<unknown>|unknown>,
 *   agentConfigDir: string,
 * }} config
 */
export function createAgentConfigStore({ controlPlane, agentConfigDir }) {
  if (!controlPlane || typeof controlPlane !== "object") {
    throw new TypeError("createAgentConfigStore requires a controlPlane object");
  }
  if (typeof controlPlane.applyAgentConfiguration !== "function") {
    throw new TypeError("agent config store requires controlPlane.applyAgentConfiguration");
  }
  if (typeof controlPlane.applyAgentConfigurationYaml !== "function") {
    throw new TypeError("agent config store requires controlPlane.applyAgentConfigurationYaml");
  }
  if (typeof controlPlane.exportAgentConfigurationYaml !== "function") {
    throw new TypeError("agent config store requires controlPlane.exportAgentConfigurationYaml");
  }
  if (typeof agentConfigDir !== "string" || agentConfigDir.trim().length === 0) {
    throw new TypeError("createAgentConfigStore requires a non-empty agentConfigDir");
  }

  const resolvedDir = resolve(agentConfigDir);

  async function writeAgentFile(agentId) {
    const exported = await controlPlane.exportAgentConfigurationYaml({ agentId });
    if (exported.status !== "found" || typeof exported.yamlText !== "string") {
      throw new Error(`Agent configuration not found: ${agentId}`);
    }
    ensureDirectory(resolvedDir);
    const filePath = resolve(resolvedDir, agentConfigFilename(agentId));
    writeFileSync(filePath, exported.yamlText, "utf8");
    return {
      status: "written",
      agentId,
      filePath,
    };
  }

  async function seedDefaultsIfEmpty() {
    ensureDirectory(resolvedDir);
    if (listYamlFiles(resolvedDir).length > 0) {
      return {
        status: "skipped",
        reason: "existing_yaml_files",
      };
    }
    for (const configuration of DEFAULT_AGENT_CONFIGURATIONS) {
      await controlPlane.applyAgentConfiguration({ configuration });
      await writeAgentFile(configuration.agentId);
    }
    return {
      status: "seeded",
      count: DEFAULT_AGENT_CONFIGURATIONS.length,
    };
  }

  async function syncFromDisk() {
    ensureDirectory(resolvedDir);
    const files = listYamlFiles(resolvedDir);
    const applied = [];
    for (const filePath of files) {
      const yamlText = readFileSync(filePath, "utf8");
      const result = await controlPlane.applyAgentConfigurationYaml({ yamlText });
      applied.push({
        filePath,
        agentId: result?.agent?.agentId,
        profileId: result?.agent?.profileId,
      });
    }
    return {
      status: "applied",
      items: Object.freeze(applied),
      totalCount: applied.length,
    };
  }

  return Object.freeze({
    agentConfigDir: resolvedDir,
    listFiles() {
      ensureDirectory(resolvedDir);
      const files = listYamlFiles(resolvedDir);
      return {
        status: "ok",
        items: Object.freeze(
          files.map((filePath) => ({
            filePath,
            filename: filePath.split(/[/\\]/).at(-1),
          })),
        ),
        totalCount: files.length,
      };
    },
    async seedDefaultsIfEmpty() {
      return seedDefaultsIfEmpty();
    },
    async syncFromDisk() {
      return syncFromDisk();
    },
    async writeAgentFile(agentId) {
      return writeAgentFile(agentId);
    },
    async applyConfiguration(configuration) {
      const result = await controlPlane.applyAgentConfiguration({ configuration });
      await writeAgentFile(result?.agent?.agentId || configuration.agentId);
      return result;
    },
    async applyYamlText(yamlText) {
      const result = await controlPlane.applyAgentConfigurationYaml({ yamlText });
      await writeAgentFile(result?.agent?.agentId);
      return result;
    },
  });
}
