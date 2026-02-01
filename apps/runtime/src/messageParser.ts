export type WorkerRequest = {
  action: string;
  skillId?: string;
  templateId?: string;
  args?: Record<string, unknown>;
  // legacy
  path?: string;
};

export function parseMessage(message: string): WorkerRequest | null {
  const trimmed = message.trim();

  // Try parsing as JSON first for structured tool calls
  try {
    const data = JSON.parse(trimmed);
    if (data.call && typeof data.call === 'string') {
      const [skillId, templateId] = data.call.split(':');
      if (skillId && templateId) {
        return {
          skillId,
          templateId,
          action: data.call,
          args: data.args || {}
        };
      }
    }
    if (data.action && typeof data.action === 'string') {
      return {
        action: data.action,
        args: data.args || {},
        path: data.path
      };
    }
  } catch {
    // Fall back to legacy string parsing
  }

  const lower = trimmed.toLowerCase();

  if (lower.startsWith('read file ') || lower.startsWith('read ')) {
    const path = trimmed.slice(lower.startsWith('read file ') ? 'read file '.length : 'read '.length).trim();
    return path ? { action: 'fs.readFile', path, args: { path } } : null;
  }

  if (lower.startsWith('list dir ') || lower.startsWith('list ')) {
    const path = trimmed.slice(lower.startsWith('list dir ') ? 'list dir '.length : 'list '.length).trim();
    return path ? { action: 'fs.listDir', path, args: { path } } : null;
  }

  return null;
}
