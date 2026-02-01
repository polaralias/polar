import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchPolicy, updatePolicy, type PolicyStore } from '../api';

function parseLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function PermissionsPage() {
  const { data: policy } = useQuery({ queryKey: ['policy'], queryFn: fetchPolicy });
  const [subject, setSubject] = useState('main-session');
  const [readRoot, setReadRoot] = useState('');
  const [readPaths, setReadPaths] = useState('');
  const [listRoot, setListRoot] = useState('');
  const [listPaths, setListPaths] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!policy) return;

    const readGrant = policy.grants.find(
      (grant) => grant.subject === subject && grant.action === 'fs.readFile',
    );
    const listGrant = policy.grants.find(
      (grant) => grant.subject === subject && grant.action === 'fs.listDir',
    );

    setReadRoot(readGrant?.resource.root ?? '');
    setReadPaths((readGrant?.resource.paths ?? []).join('\n'));
    setListRoot(listGrant?.resource.root ?? '');
    setListPaths((listGrant?.resource.paths ?? []).join('\n'));
  }, [policy, subject]);

  const mutation = useMutation({
    mutationFn: (payload: PolicyStore) => updatePolicy(payload),
    onSuccess: () => setStatus('Saved'),
    onError: (error) => setStatus((error as Error).message),
  });

  const handleSave = () => {
    const basePolicy: PolicyStore = policy ?? { grants: [], rules: [] };
    const grants = basePolicy.grants.filter(
      (grant) =>
        !(
          grant.subject === subject &&
          (grant.action === 'fs.readFile' || grant.action === 'fs.listDir')
        ),
    );

    const readPathsArray = parseLines(readPaths);
    const listPathsArray = parseLines(listPaths);

    if (readRoot || readPathsArray.length) {
      grants.push({
        id: crypto.randomUUID(),
        subject,
        action: 'fs.readFile',
        resource: {
          type: 'fs',
          root: readRoot || undefined,
          paths: readPathsArray.length ? readPathsArray : undefined,
        },
      });
    }

    if (listRoot || listPathsArray.length) {
      grants.push({
        id: crypto.randomUUID(),
        subject,
        action: 'fs.listDir',
        resource: {
          type: 'fs',
          root: listRoot || undefined,
          paths: listPathsArray.length ? listPathsArray : undefined,
        },
      });
    }

    mutation.mutate({
      grants,
      rules: basePolicy.rules,
    });
  };

  return (
    <div className="grid two">
      <section className="panel">
        <h2 className="section-title">Subject</h2>
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="main-session"
        />
        <p className="mono">Permissions are evaluated per subject.</p>
      </section>

      <section className="panel">
        <h2 className="section-title">Read File Grant</h2>
        <input
          value={readRoot}
          onChange={(event) => setReadRoot(event.target.value)}
          placeholder="Allowed root (e.g. C:\\sandbox\\allowed)"
        />
        <textarea
          value={readPaths}
          onChange={(event) => setReadPaths(event.target.value)}
          placeholder="Optional explicit paths, one per line"
        />
      </section>

      <section className="panel">
        <h2 className="section-title">List Directory Grant</h2>
        <input
          value={listRoot}
          onChange={(event) => setListRoot(event.target.value)}
          placeholder="Allowed root (e.g. C:\\sandbox\\allowed)"
        />
        <textarea
          value={listPaths}
          onChange={(event) => setListPaths(event.target.value)}
          placeholder="Optional explicit paths, one per line"
        />
      </section>

      <section className="panel">
        <h2 className="section-title">Actions</h2>
        <button type="button" onClick={handleSave} disabled={mutation.isPending}>
          Save Permissions
        </button>
        {status && <p className="mono">{status}</p>}
      </section>
    </div>
  );
}
