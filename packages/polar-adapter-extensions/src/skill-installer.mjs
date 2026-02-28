import crypto from "node:crypto";

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeSkillSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {string} content
 * @returns {string}
 */
function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * @param {string} skillMarkdown
 * @returns {{ frontmatter: Record<string, unknown>, body: string }}
 */
function parseFrontmatter(skillMarkdown) {
  const normalized = skillMarkdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("SKILL.md must start with YAML frontmatter");
  }

  const endMarker = normalized.indexOf("\n---\n", 4);
  if (endMarker < 0) {
    throw new Error("SKILL.md frontmatter is missing closing delimiter");
  }

  const frontmatterText = normalized.slice(4, endMarker);
  const body = normalized.slice(endMarker + 5);
  const lines = frontmatterText.split("\n");
  const frontmatter = {};

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    index += 1;

    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const keyMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!keyMatch) {
      throw new Error(`Invalid frontmatter line: "${line}"`);
    }

    const key = keyMatch[1];
    const inlineValue = keyMatch[2].trim();

    if (inlineValue.length > 0) {
      frontmatter[key] = inlineValue;
      continue;
    }

    const listValues = [];
    while (index < lines.length) {
      const listLine = lines[index];
      const listMatch = /^\s*-\s*(.+?)\s*$/.exec(listLine);
      if (!listMatch) {
        break;
      }

      listValues.push(listMatch[1].trim());
      index += 1;
    }

    if (listValues.length > 0) {
      frontmatter[key] = Object.freeze(listValues);
      continue;
    }

    frontmatter[key] = "";
  }

  return {
    frontmatter: Object.freeze(frontmatter),
    body,
  };
}

/**
 * @param {string} markdown
 * @param {string} heading
 * @returns {readonly string[]}
 */
function extractSectionBulletLines(markdown, heading) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const target = `## ${heading}`.toLowerCase();

  let startIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().toLowerCase() === target) {
      startIndex = index + 1;
      break;
    }
  }

  if (startIndex < 0) {
    return Object.freeze([]);
  }

  const bulletLines = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*##\s+/.test(line)) {
      break;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      bulletLines.push(line.trim());
    }
  }

  return Object.freeze(bulletLines);
}

/**
 * @param {readonly string[]} values
 * @returns {readonly string[]}
 */
function normalizeStringList(values) {
  const deduped = new Set();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    deduped.add(value);
  }

  return Object.freeze([...deduped].sort((left, right) => left.localeCompare(right)));
}

/**
 * @param {string} skillMarkdown
 * @returns {Record<string, unknown>}
 */
export function parseSkillManifest(skillMarkdown) {
  if (typeof skillMarkdown !== "string" || skillMarkdown.length === 0) {
    throw new Error("SKILL.md content must be a non-empty string");
  }

  const { frontmatter, body } = parseFrontmatter(skillMarkdown);

  const name = frontmatter.name;
  const description = frontmatter.description;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("SKILL.md frontmatter requires non-empty \"name\"");
  }
  if (typeof description !== "string" || description.length === 0) {
    throw new Error("SKILL.md frontmatter requires non-empty \"description\"");
  }

  const slug = normalizeSkillSlug(name);
  if (slug.length === 0) {
    throw new Error("SKILL.md name must include at least one alphanumeric character");
  }

  const extensionId = `skill.${slug}`;
  const manifestHash = sha256(skillMarkdown);

  const frontmatterPermissions = Array.isArray(frontmatter.permissions)
    ? frontmatter.permissions
    : [];

  const sectionPermissionLines = extractSectionBulletLines(body, "Permissions");
  const sectionPermissions = sectionPermissionLines
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .map((token) => token.replace(/^`|`$/g, ""))
    .filter((token) => token.length > 0);

  const permissions = normalizeStringList([
    ...frontmatterPermissions,
    ...sectionPermissions,
  ]);

  const capabilityLines = extractSectionBulletLines(body, "Capabilities");
  const capabilities = capabilityLines
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .map((line) => {
      const matched = /^(?:`([^`]+)`|([A-Za-z0-9._:-]+))(?:\s*[:\-]\s*(.+))?$/.exec(
        line,
      );
      if (!matched) {
        throw new Error(`Invalid capability declaration: "${line}"`);
      }

      const capabilityId = matched[1] ?? matched[2];
      let description = matched[3]?.trim() || "";

      // Extract risk metadata if present: [risk: read, effects: none, egress: none]
      const metaMatch = /\[(.*)\]\s*$/.exec(description);
      let riskLevel = "unknown";
      let sideEffects = "unknown";
      let dataEgress = "unknown";

      if (metaMatch) {
        const metaStr = metaMatch[1];
        description = description.slice(0, metaMatch.index).trim();
        const segments = metaStr.split(",").map((s) => s.trim());
        for (const segment of segments) {
          const [key, val] = segment.split(":").map((s) => s.trim());
          if (key === "risk") riskLevel = val;
          if (key === "effects") sideEffects = val;
          if (key === "egress") dataEgress = val;
        }
      }

      const capability = {
        capabilityId,
        riskLevel,
        sideEffects,
        dataEgress,
      };
      if (description.length > 0) {
        capability.description = description;
      }

      return capability;
    });

  if (capabilities.length === 0) {
    capabilities.push({
      capabilityId: `${slug}.run`,
      description: "Default skill capability",
      riskLevel: "unknown",
      sideEffects: "unknown",
      dataEgress: "unknown",
    });
  }

  const normalizedCapabilities = Object.freeze(
    capabilities
      .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId))
      .map((capability) => Object.freeze({ ...capability })),
  );

  return Object.freeze({
    extensionId,
    extensionType: "skill",
    name,
    description,
    manifestHash,
    permissions,
    capabilities: normalizedCapabilities,
  });
}

/**
 * @param {string} sourceUri
 * @returns {"remote"|"local"}
 */
function parseSourceType(sourceUri) {
  if (/^https?:\/\//i.test(sourceUri)) {
    return "remote";
  }

  return "local";
}

/**
 * @param {string} sourceUri
 * @param {readonly string[]} prefixes
 * @returns {boolean}
 */
function hasPrefixMatch(sourceUri, prefixes) {
  return prefixes.some((prefix) => sourceUri.startsWith(prefix));
}

/**
 * @param {{
 *   sourceUri: string,
 *   manifestContent: string,
 *   expectedHash?: string,
 *   pinnedRevision?: string,
 *   trustedSourcePrefixes?: readonly string[],
 *   blockedSourcePrefixes?: readonly string[]
 * }} request
 * @returns {Record<string, unknown>}
 */
export function verifySkillProvenance(request) {
  if (!isPlainObject(request)) {
    throw new Error("Skill provenance request must be a plain object");
  }

  const sourceUri = request.sourceUri;
  const manifestContent = request.manifestContent;
  if (typeof sourceUri !== "string" || sourceUri.length === 0) {
    throw new Error("sourceUri must be a non-empty string");
  }
  if (typeof manifestContent !== "string" || manifestContent.length === 0) {
    throw new Error("manifestContent must be a non-empty string");
  }

  const trustedSourcePrefixes = Array.isArray(request.trustedSourcePrefixes)
    ? request.trustedSourcePrefixes
    : [];
  const blockedSourcePrefixes = Array.isArray(request.blockedSourcePrefixes)
    ? request.blockedSourcePrefixes
    : [];

  if (hasPrefixMatch(sourceUri, blockedSourcePrefixes)) {
    throw new Error("Skill source is blocked by provenance policy");
  }

  const sourceType = parseSourceType(sourceUri);
  if (
    sourceType === "remote" &&
    (typeof request.pinnedRevision !== "string" || request.pinnedRevision.length === 0)
  ) {
    throw new Error("Remote skill sources require pinnedRevision");
  }

  const computedHash = sha256(manifestContent);
  const expectedHash = request.expectedHash;
  if (expectedHash !== undefined) {
    if (typeof expectedHash !== "string" || expectedHash.length === 0) {
      throw new Error("expectedHash must be a non-empty string when provided");
    }

    if (computedHash !== expectedHash.toLowerCase()) {
      throw new Error("Skill manifest hash does not match expectedHash");
    }
  }

  let trustLevelRecommendation = "sandboxed";
  if (hasPrefixMatch(sourceUri, trustedSourcePrefixes)) {
    trustLevelRecommendation = "trusted";
  } else if (sourceType === "local") {
    trustLevelRecommendation = "reviewed";
  }

  const provenance = {
    sourceUri,
    sourceType,
    manifestHash: computedHash,
    hashMatched: expectedHash !== undefined,
    trustLevelRecommendation,
  };
  if (request.pinnedRevision !== undefined) {
    provenance.pinnedRevision = request.pinnedRevision;
  }

  return Object.freeze(provenance);
}

/**
 * @param {{
 *   skillManifest: Record<string, unknown>,
 *   capabilityHandlers?: Record<string, (request: Record<string, unknown>) => Promise<unknown>|unknown>
 * }} config
 * @returns {{ executeCapability: (request: Record<string, unknown>) => Promise<unknown> }}
 */
export function createSkillCapabilityAdapter(config) {
  if (!isPlainObject(config)) {
    throw new Error("createSkillCapabilityAdapter config must be a plain object");
  }

  const skillManifest = config.skillManifest;
  if (!isPlainObject(skillManifest)) {
    throw new Error("skillManifest must be a plain object");
  }

  const extensionId = skillManifest.extensionId;
  const manifestHash = skillManifest.manifestHash;
  const capabilities = Array.isArray(skillManifest.capabilities)
    ? skillManifest.capabilities
    : [];

  if (typeof extensionId !== "string" || extensionId.length === 0) {
    throw new Error("skillManifest.extensionId must be a non-empty string");
  }
  if (typeof manifestHash !== "string" || manifestHash.length === 0) {
    throw new Error("skillManifest.manifestHash must be a non-empty string");
  }

  const knownCapabilityIds = new Set(
    capabilities
      .map((capability) =>
        isPlainObject(capability) ? capability.capabilityId : undefined,
      )
      .filter((capabilityId) => typeof capabilityId === "string" && capabilityId.length > 0),
  );

  const capabilityHandlers = isPlainObject(config.capabilityHandlers)
    ? config.capabilityHandlers
    : {};

  return Object.freeze({
    /**
     * @param {Record<string, unknown>} request
     * @returns {Promise<unknown>}
     */
    async executeCapability(request) {
      if (!isPlainObject(request)) {
        throw new Error("Skill capability request must be a plain object");
      }

      const capabilityId = request.capabilityId;
      if (typeof capabilityId !== "string" || capabilityId.length === 0) {
        throw new Error("Skill capability request must include capabilityId");
      }

      if (!knownCapabilityIds.has(capabilityId)) {
        throw new Error(`Unknown skill capability: ${capabilityId}`);
      }

      const handler = capabilityHandlers[capabilityId];
      if (typeof handler === "function") {
        return await handler(request);
      }

      return Object.freeze({
        extensionId,
        capabilityId,
        manifestHash,
        status: "completed",
        message: `Skill capability "${capabilityId}" executed with default adapter`,
      });
    },
  });
}
