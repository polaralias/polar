# Policy Model

Polar uses a "Deny by Default" policy engine to control all system interactions. Policy is defined in human-readable terms and evaluated by the Runtime.

## Core Concepts

### 1. Subject
The identity requesting an action. This can be:
- **User**: The human owner of the system.
- **Session**: A specific interaction context (usually bound to a user).
- **Worker**: A specific tool execution process.

### 2. Action
The operation being performed. Examples:
- `fs.readFile`
- `fs.writeFile`
- `fs.listDir`
- `net.httpRequest`

### 3. Resource
The target of the action. Resources are typed and have specific attributes:
- **File System (`fs`)**: Defined by a path or root directory.
- **Network (`net`)**: Defined by a domain or URL.

### 4. Constraints
Detailed restrictions on the action:
- **Fields**: Specific fields within an object that can be read or written.
- **Root**: A base directory that the action cannot escape.
- **Paths**: Specific allowed paths.
- **TTL**: A time-to-live after which the grant expires.

---

## Policy Structure

Policy is composed of **Rules** and **Grants**.

### Rules
Rules are coarse-grained and can either `allow` or `deny`.
- **Deny Rules**: Take precedence. If a deny rule matches, the request is rejected immediately.
- **Allow Rules**: Provide broad permissions (use with caution).

### Grants
Grants are fine-grained, scoped permissions. They are the primary way authority is delegated to agents.
A grant includes:
- `subject`: Who receives the authority.
- `action`: What they can do.
- `resource`: What they can do it to.
- `fields`: (Optional) restricted access at the field level.
- `expiresAt`: (Optional) when the grant expires.

---

## Evaluation Logic

1.  **Check Deny Rules**: If any rule with `effect: 'deny'` matches the Subject, Action, and Resource, return **DENY**.
2.  **Match Grant**: Look for a Grant that matches the Subject, Action, and Resource, and is not expired.
3.  **Compute Intersection**: The final authority is the intersection of the requested action and the grant's constraints.
4.  **Issue Capability**: If a match is found, any resulting token is restricted to the *narrower* of the request or the grant.

---

## Explicitly Forbidden
- **Wildcard grants**: `*` actions or resources are forbidden without explicit user confirmation in the UI.
- **Implicit Inheritance**: A grant for `fs.read` does not imply `fs.write`. A grant for `/home/user` does not imply access to `/home/user/secrets` if specific sub-path rules exist (though standard path prefix matching applies unless otherwise specified).
- **Agent-Side Policy**: Agents never make policy decisions. They only propose actions which the Runtime validates.
