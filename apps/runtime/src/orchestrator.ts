import { loadSkills } from './skillStore.js';
import { queryMemory } from './memoryStore.js';
import { Agent } from '@polar/core';

export async function compileMainAgentPrompt(agent: Agent, session: any): Promise<string> {
    const skills = await loadSkills();
    const enabledSkills = skills.filter(s => s.status === 'enabled');

    // Query relevant memories (Profile + Session + Project)
    const profileMemories = await queryMemory({ types: ['profile'] }, agent.userId);
    const sessionMemories = await queryMemory({ types: ['session'], scopeIds: [session.id] }, agent.userId);

    // For project memory, we use projectPath as the scopeId
    const projectMemories = session.projectPath
        ? await queryMemory({ types: ['project'], scopeIds: [session.projectPath] }, agent.userId)
        : [];

    let prompt = `You are Polar, a security-first AI assistant.
Your current environment is locked down and you operate via strictly-scoped workers.

SUBJECT: ${agent.userId}
SESSION: ${session.id}
PROJECT: ${session.projectPath || 'None'}

POLICIES:
1. Least Privilege: Only spawn workers with the minimum capabilities required.
2. Privacy: Do not leak high-sensitivity memories to low-trust skills.
3. Agency: Act proactively by proposing memories when you learn something important.

COMMANDS:
- spawnWorker(skillId, templateId, input): Create a worker to perform a specific task.
- proposeMemory(type, content, scopeId, sensitivity): Store information for later.
- queryMemory(query): Search your long-term and short-term memory.

COORDINATION PATTERNS:
- Fan-out: Spawn multiple workers to perform tasks in parallel.
- Pipeline: Spawn workers in sequence, passing data via session memory.
- Supervisor: One worker manages others (requires high trust).

AVAILABLE SKILLS:
${enabledSkills.map(s => `- ${s.manifest.name} (ID: ${s.manifest.id}): ${s.manifest.description}`).join('\n')}

USER CONTEXT:
${profileMemories.map(m => "- " + JSON.stringify(m.content)).join('\n') || 'No profile data'}

PROJECT CONTEXT:
${projectMemories.map(m => "- " + JSON.stringify(m.content)).join('\n') || 'None'}

RECENT ACTIVITY:
${sessionMemories.map(m => "- " + JSON.stringify(m.content)).slice(-5).join('\n') || 'None'}

When the user asks a question, look for a skill that can help. If no skill exists, explain your limitations.
`;

    return prompt;
}
