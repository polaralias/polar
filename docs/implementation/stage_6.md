# Platform Build Documentation

## Stage 6: Deployment Packs (Local, Cloud, Edge)

### Purpose of this stage

Stage 6 makes the platform **platform-agnostic in practice**, not just in theory.

At the end of this stage, the system can be:

* Run locally by a single user
* Deployed in a standard cloud environment
* Fronted by edge infrastructure
* Operated without changing security semantics

The runtime behaves identically everywhere. Only **adapters change**, never trust boundaries.

---

## Stage 6 Goals (explicit)

By completion of Stage 6, the system must:

1. Support **multiple deployment targets**

   * Local
   * Cloud (AWS-style)
   * Edge-fronted

2. Preserve **identical security behaviour**

   * Same policy model
   * Same capability enforcement
   * Same audit guarantees

3. Make deployment **boring and reproducible**

   * No hand-rolled steps
   * No environment-specific logic in core

4. Keep credentials and identity **environment-appropriate**

   * Local secrets ≠ cloud secrets
   * No secrets in code or config files

---

## Stage 6 Deliverables

### Required artefacts

* `docs/deployment-model.md`
* `docs/local-deployment.md`
* `docs/cloud-deployment.md`
* `docs/edge-deployment.md`
* `docs/stage-6-complete.md`

---

## Stage 6 Work Breakdown

---

### 1. Define the Deployment Model (spec first)

**File:** `docs/deployment-model.md`

This document defines what *varies* and what *must not vary* across environments.

#### Immutable across all deployments

* Runtime behaviour
* Policy engine
* Capability model
* Audit semantics
* Memory semantics
* Tool gateway enforcement

#### Variable by deployment

* Process model
* Storage backend
* Secrets backend
* Networking and ingress
* Authentication frontends

**Acceptance criteria**

* You can reason about security without knowing the deployment target
* No deployment requires code changes in runtime or gateway

---

### 2. Local Deployment Pack

**File:** `docs/local-deployment.md`

Local deployment is the **reference implementation**.

#### Required characteristics

* Single command startup
* No cloud dependencies
* Encrypted local storage
* Loopback-only network exposure by default

#### Required components

* Runtime service
* Gateway service
* UI
* Local database (SQLite or equivalent)
* Local secrets store

#### Explicit rules

* No external network egress unless explicitly configured
* UI binds to localhost only
* Audit and memory stored locally and encrypted

**Acceptance criteria**

* A developer can clone the repo and be running safely in under 10 minutes
* Removing network access does not break core functionality

---

### 3. Cloud Deployment Pack (AWS-style, Bedrock-friendly)

**File:** `docs/cloud-deployment.md`

This pack targets a **standard cloud mental model**, not a vendor-specific one.

#### Core principles

* Runtime remains the authority
* Cloud services replace local infrastructure, not logic
* IAM never substitutes for policy engine

#### Required cloud substitutions

* Secrets → managed secrets store
* Storage → managed database
* Logs → managed logging
* Identity → managed identity (but mapped to runtime users)

#### Bedrock usage model

* Bedrock models may be used for:

  * reasoning
  * summarisation
* Bedrock agents must NOT:

  * call tools directly
  * hold credentials
  * bypass gateway

#### Application-layer enforcement (non-negotiable)

* Connectors are reachable only through the gateway.
* Gateway requires a valid capability token for every request.
* Runtime is the only minting authority; policy is evaluated per request.
* Cloud IAM controls infrastructure, **not** application authorization.

**Acceptance criteria**

* Switching from local to cloud does not change permission behaviour
* Cloud IAM misconfiguration cannot grant new tool access

#### Required validation

* Attempt direct connector call without a capability token → denied
* Attempt token mint bypass → denied
* Verify all connector SDK calls sit behind gateway enforcement

---

### 4. Edge-Fronted Deployment

**File:** `docs/edge-deployment.md`

Edge is treated as **ingress and control**, never execution authority.

#### Edge responsibilities

* Authentication
* Rate limiting
* Routing
* Static UI hosting

#### Edge non-responsibilities

* No policy decisions
* No capability minting
* No tool execution
* No memory access

#### Communication model

* Edge proxies requests to runtime
* All sensitive state lives behind the edge

**Acceptance criteria**

* Compromising edge does not grant tool access
* Runtime can be taken offline without leaking state

---

### 5. Secrets and identity handling

This is mandatory to document and implement.

#### Secrets rules

* Secrets are never:

  * logged
  * sent to agents
  * embedded in capability tokens
* Secrets are scoped:

  * per connector
  * per user (if multi-user)

#### Identity mapping

* External identity (local user, cloud IAM, edge auth)
* Mapped to internal runtime identity
* Internal identity drives policy, not external one

**Acceptance criteria**

* Rotating secrets does not require agent restart
* Identity changes do not invalidate audit history

---

### 6. Networking and egress control

Egress is a **first-class security surface**.

#### Required behaviours

* Default deny outbound network
* Allowlist per connector/skill
* DNS and IP restrictions enforced centrally
* All outbound calls audited

**Acceptance criteria**

* A compromised worker cannot exfiltrate data
* Network behaviour is visible in audit

---

### 7. Deployment validation and drift detection

Extend the doctor subsystem.

#### New checks

* Environment matches expected deployment profile
* Secrets backend reachable
* Audit persistence healthy
* Clock skew within tolerance
* Capability signing keys consistent

#### Clock skew defaults

* Warn if skew > 2 minutes
* Fail if skew > 10 minutes (configurable)

**Acceptance criteria**

* Misconfigured deployments are detected early
* Unsafe partial deployments fail closed

---

## Stage 6 Exit Checklist

**File:** `docs/stage-6-complete.md`

Example items:

* [ ] Local deployment reproducible
* [ ] Cloud deployment documented and tested
* [ ] Edge deployment documented
* [ ] Security semantics identical across environments
* [ ] Secrets never exposed to agents
* [ ] Egress control enforced everywhere
* [ ] Doctor validates deployment health

---

## What is explicitly *not* in Stage 6

To avoid dilution:

* Marketplace or public registry
* Multi-tenant SaaS features
* Automatic scaling heuristics
* Cost optimisation logic

Those are downstream concerns.

---

## Conceptual outcome of Stage 6

After Stage 6:

* You can run the platform anywhere
* Security guarantees survive environment changes
* The runtime is truly **portable infrastructure**

This is where most frameworks quietly reintroduce trust leaks. Yours shouldn’t.
