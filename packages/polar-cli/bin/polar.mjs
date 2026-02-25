#!/usr/bin/env node

const [node, script, command, action, resourceType, resourceId, ...args] = process.argv;

const VALID_RESOURCE_TYPES = ["provider", "channel", "extension", "automation", "profile"];
const ENDPOINT = "http://127.0.0.1:5173/api/upsertConfig";

async function main() {
    if (command !== "config" || action !== "set") {
        console.error("Usage: polar config set <resourceType> <resourceId> [options]");
        process.exit(1);
    }

    if (!VALID_RESOURCE_TYPES.includes(resourceType)) {
        console.error(`Invalid resourceType: ${resourceType}. Must be one of: ${VALID_RESOURCE_TYPES.join(", ")}`);
        process.exit(1);
    }

    if (!resourceId) {
        console.error("Missing resourceId");
        process.exit(1);
    }

    // Very basic CLI parser
    const config = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            const key = args[i]
                .slice(2)
                .replace(/-([a-z])/g, (g) => g[1].toUpperCase());
            const value = args[i + 1];

            try {
                config[key] = JSON.parse(value);
            } catch {
                config[key] = value;
            }
            i++;
        }
    }

    // Handle specialized agentProfile bindings
    if (resourceType === "profile") {
        if (config.providerId || config.modelId || config.lane) {
            config.modelPolicy = {};
            if (config.providerId) {
                config.modelPolicy.providerId = config.providerId;
                delete config.providerId;
            }
            if (config.modelId) {
                config.modelPolicy.modelId = config.modelId;
                delete config.modelId;
            }
            if (config.lane) {
                config.modelPolicy.lane = config.lane;
                delete config.lane;
            }
        }

        if (config.allowedHandoffTargets && typeof config.allowedHandoffTargets === "string") {
            config.allowedHandoffTargets = config.allowedHandoffTargets.split(",").map(t => t.trim());
        }

        if (config.skills && typeof config.skills === "string") {
            config.enabledSkills = config.skills.split(",").map(s => s.trim());
            delete config.skills;
        }
    }

    if (resourceType === "extension" && config.args && typeof config.args === "string") {
        try {
            config.args = JSON.parse(config.args);
        } catch {
            // Keep as string if parsing fails, but array is expected for extension args
        }
    }

    const payload = {
        resourceType: resourceType === "profile" ? "agentProfile" : resourceType,
        resourceId,
        config
    };

    try {
        const res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok || data.error) {
            console.error("Failed to upsert config:", data.error || data);
            process.exit(1);
        }

        console.log(`Successfully mapped ${resourceType} [${resourceId}]`);
        console.log(JSON.stringify(data.config, null, 2));
    } catch (error) {
        console.error("Connection error. Ensure the Polar Web UI (Operator Dashboard) is running via 'npm run dev' on port 5173.", error.message);
        process.exit(1);
    }
}

main();
