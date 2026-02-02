import { SkillContent } from './schemas.js';

export function parseSkillMarkdown(content: string): SkillContent {
    const frontMatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = content.match(frontMatterRegex);

    if (!match) {
        return { instructions: content, metadata: {} };
    }

    const yaml = match[1]!;
    const instructions = match[2]!.trim();
    const metadata: Record<string, any> = {};

    yaml.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
            metadata[key.trim()] = valueParts.join(':').trim();
        }
    });

    return { instructions, metadata };
}
