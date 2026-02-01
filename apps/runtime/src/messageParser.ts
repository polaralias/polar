export type WorkerRequest = {
  action: 'fs.readFile' | 'fs.listDir';
  path: string;
};

export function parseMessage(message: string): WorkerRequest | null {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('read file ')) {
    const path = trimmed.slice('read file '.length).trim();
    return path ? { action: 'fs.readFile', path } : null;
  }

  if (lower.startsWith('read ')) {
    const path = trimmed.slice('read '.length).trim();
    return path ? { action: 'fs.readFile', path } : null;
  }

  if (lower.startsWith('list dir ')) {
    const path = trimmed.slice('list dir '.length).trim();
    return path ? { action: 'fs.listDir', path } : null;
  }

  if (lower.startsWith('list ')) {
    const path = trimmed.slice('list '.length).trim();
    return path ? { action: 'fs.listDir', path } : null;
  }

  return null;
}
