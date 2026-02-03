import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type PolicyStore } from '../api.js';

// Grant type from PolicyStore
type Grant = PolicyStore['grants'][number];

export default function PermissionsPage() {
  const { data: policyData, refetch } = useQuery({
    queryKey: ['policy'],
    queryFn: () => api.fetchPolicy()
  });
  const [status, setStatus] = useState<string | null>(null);

  // New grant state
  const [subject, setSubject] = useState('main-session');
  const [action, setAction] = useState('');
  const [resourceJson, setResourceJson] = useState('{\n  "type": "fs",\n  "path": "/"\n}');

  // Extract policy from nested response
  const policy = policyData?.policy;

  const mutation = useMutation({
    mutationFn: (payload: PolicyStore) => api.updatePolicy(payload),
    onSuccess: () => {
      setStatus('Saved');
      refetch();
    },
    onError: (error) => setStatus((error as Error).message),
  });

  const handleRevoke = (grantId: string | undefined, index: number) => {
    if (!policy) return;
    const newGrants = [...policy.grants];
    // If id exists match by id, else index (legacy)
    if (grantId) {
      const idx = newGrants.findIndex(g => g.id === grantId);
      if (idx >= 0) newGrants.splice(idx, 1);
    } else {
      newGrants.splice(index, 1);
    }

    mutation.mutate({
      ...policy,
      grants: newGrants,
    });
  };

  const handleAdd = () => {
    if (!policy) return;
    try {
      const resource = JSON.parse(resourceJson);
      const newGrant: Grant = {
        id: crypto.randomUUID(),
        subject,
        action,
        resource,
      };

      mutation.mutate({
        ...policy,
        grants: [...policy.grants, newGrant],
      });
      setAction(''); // clear action but keep subject common
    } catch {
      setStatus('Invalid JSON in resource field');
    }
  };

  if (!policy) return <div>Loading...</div>;

  return (
    <div className="flex-col gap-4">
      <section className="panel">
        <h2 className="section-title">Active Permissions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="p-2">Subject</th>
                <th className="p-2">Action</th>
                <th className="p-2">Resource</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {policy.grants.map((grant: Grant, i: number) => (
                <tr key={grant.id || i} className="border-b border-border/50">
                  <td className="p-2 font-mono text-sm">{grant.subject}</td>
                  <td className="p-2 font-mono text-sm">{grant.action}</td>
                  <td className="p-2 font-mono text-xs">
                    <pre className="whitespace-pre-wrap">{JSON.stringify(grant.resource)}</pre>
                  </td>
                  <td className="p-2">
                    <button
                      className="text-red-500 hover:text-red-400 text-sm"
                      onClick={() => handleRevoke(grant.id, i)}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {policy.grants.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-muted">No active grants</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2 className="section-title">Add Permission</h2>
        <div className="grid two gap-4">
          <div className="flex flex-col gap-2">
            <label>Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. main-session"
            />

            <label>Action</label>
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g. fs.writeFile"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label>Resource (JSON)</label>
            <textarea
              className="font-mono text-sm h-32"
              value={resourceJson}
              onChange={(e) => setResourceJson(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4">
          <button onClick={handleAdd} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Grant Permission'}
          </button>
        </div>
        {status && <p className="mt-2 font-mono text-yellow-500">{status}</p>}
      </section>
    </div>
  );
}
