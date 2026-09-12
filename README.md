# Virement Portal

**IFAMS Virement** is EPF's (Employees Provident Fund, Malaysia) internal budget-transfer request-and-approval portal. It lets staff raise **Supplement**, **Return**, and **Transfer (Virement)** budget requests, routes each one through a multi-level approval chain based on organisational rules (department, branch, region, GL grouping, functional department, and amount), and posts the approved result into SAP S/4HANA as a budget document.

## What it does

- **Supplement** — request additional budget for a cost centre / WBS element.
- **Return** — hand budget back, either zeroed out ("Budget Zerorise") or returned to a central fund.
- **Transfer (Virement)** — move budget from one cost centre/GL account to another within the organisation.

Approval routing for Transfer (Non-Project) requests is rule-driven: the system classifies each request against a priority-ordered set of scenarios (matching functional department, GL group, department, branch, or region) and resolves the correct approver(s) from an admin-maintained Approver Matrix — including parallel, per-cost-centre approvers when a transfer spans multiple cost centres. Supplement and Return requests use a flat amount-tiered rule. Once every level approves, the request posts automatically to S/4 via SAP CPI.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | SAP Cloud Application Programming Model (CAP), Node.js |
| Frontend | SAP Fiori Elements (OData V4), List Report + Object Page |
| Platform | SAP Business Technology Platform, Cloud Foundry |
| Database | SAP HANA (HDI container) |
| Auth | XSUAA + SAP Identity Authentication Service (IAS) with Authorization Management (AMS) |
| Workflow | SAP Build Process Automation |
| Integration | SAP Integration Suite (CPI), on-premise S/4HANA via Cloud Connector |
| Attachments | SAP Document Management Service (via `@cap-js/sdm`) |

## Getting started

```bash
npm install
cds watch
```

For local development, `package.json` provides mocked users for the `development` profile — no live XSUAA/IAS binding is required.

## Deploying

```bash
mbt build
cf deploy mta_archives/virement_1.0.0.mtar
```

Deployment provisions the CAP service, the Fiori app, the HANA database, and pushes the AMS authorization policies (`ams/dcl/`) to the bound Identity Authentication tenant. See §12 below for more detail, and §11 for the checks worth running before you build.

---

# Technical Handover

A working reference for anyone picking up this codebase — what each part of the system does, and exactly which file to open when you need to change it.

## Where do I change X? (quick index)

| Task | Go to |
|---|---|
| Add or adjust a submission validation | `srv/code/requests-before-create-logic.js` — one function per rule, see [§5](#5-submission--approval-lifecycle) |
| Change who approves a Virement request, or at what amount | `srv/code/utils/virement-scenario.js` (Non-Project scenarios) and `utils/approver-routing.js` (Supplement/Return bands), see [§4](#4-approval-routing-engine) |
| Add a new item-list field derived from Cost Centre / GL Account / Material | `srv/code/utils/*-lookup.js` + wire into `requestitems-drafts-before-create/update-logic.js`, see [§3](#3-data-model) |
| Fix or extend the S/4 posting (FMBB) payload | `srv/code/post-to-s4-logic.js` — `buildPayloads`/`buildHeader`, see [§6](#6-s4--earmarked-funds-integration) |
| A button/field silently doesn't respect a condition | Check `${...}` vs `%{...}` first — see the gotcha in [§11](#11-known-gotchas--hard-won-lessons) before anything else |
| Add a new admin-maintained master-data table (a new "Grouping") | Copy the GLGrouping five-file pattern, see [§10](#10-master-data-maintenance-pattern) |
| Change what SAP Build Process Automation receives at workflow start | `srv/code/utils/workflow-utils.js` — `startApprovalWorkflow` context, see [§7](#7-sap-build-workflow-integration) |
| Add a new role/permission check | Declarative: `srv/service.cds` `@requires`. Conditional-in-code: `srv/code/utils/role-check.js` + a new AMS policy in `ams/dcl/cap/basePolicies.dcl`, see [§8](#8-authorization-model) |
| A Fiori Elements table column, hide/disable rule, or item order | `app/virement.zui_pps_virement/annotations.cds` — 5 `UI.LineItem` qualifiers, see [§9](#9-fiori-elements-app-structure) |
| Deploy a change | `mbt build` then `cf deploy mta_archives/virement_1.0.0.mtar`, see [§12](#12-build--deploy-process) |

## 1. Program overview

There are three request types, set once at creation and immutable after (`db/schema.cds`, `RequestTypeCode` enum):

| Code | Type | Meaning |
|---|---|---|
| `S` | Supplement | Additional budget requested for a cost centre / WBS — increases available budget. |
| `R` | Return | Budget handed back — either zeroed out (**Zerorise**) or returned to a fixed central fund cost centre. |
| `T` | Transfer / Virement | Moves budget from one cost centre + GL account (transfer-out) to another (transfer-in), within the organisation. |

Two more classifications shape almost everything downstream:

- **Budget Type** — `Project` (`P`) or `Non-Project` (`N`). Project-budget requests are capped at **RM 5,000,000** total (Transfer-out or Supplement amount), and Project + Supplement requires a WBS element on every item.
- **Return Category** — Return-only. `Z` (Budget Zerorise) vs `C` (Budget Return to Central Fund, cost centre `100050500`). A Project-budget Return is *always* forced to Zerorise (Central Fund doesn't apply to Project budgets); raising a Zerorise return additionally requires the `BUDGET_ZERORISE` role, restricted to the BCM team.

**Transfer + Non-Project** gets the full business-rule-driven approval routing (§4); **Transfer + Project** is CAP-owned too, but deliberately simpler — a single level, Head of Transfer-out Cost Center per line, with no Level 2/3; **Return + Project** is also single-level (Head of JKEW, no amount tiering); every other combination uses the flat amount-tiered rule.

## 2. Architecture & deployment topology

Defined end-to-end in `mta.yaml` — 7 modules, 9 bound resources.

### Modules

| Module | Type | Role |
|---|---|---|
| `virement-virement.zuippsvirement` | html5 | The Fiori Elements UI5 app (`app/virement.zui_pps_virement`) |
| `virement-db-deployer` | hdb | Deploys CDS-generated HDI artifacts to HANA |
| `virement-srv` | nodejs | The CAP backend itself — single OData service `ZSVC_PPS_VIREMENT` |
| `virement-aux-destinations` | content | Creates 4 subaccount destinations (UAA, app-srv, HTML5-repo, and the API source SAP Build calls) |
| `virement-launchpad` | html5 | Separate launchpad shell app |
| `virement-aux-ui-deployer` | content | Pushes both zipped HTML5 apps into the HTML5 Apps Repo |
| `virement-ams-policies-deployer` | nodejs task | Runs `npm start` → `deploy-dcl`, pushing `ams/dcl/` policies to IAS |

### Bound services

| Service | Used for |
|---|---|
| `virement-service-uaa` (XSUAA) | Login/OAuth, role collections `REQUEST_APPROVE` / `ADMIN` |
| `virement-service-db` (HANA HDI) | Persistence |
| `virement-ias` (Identity, `authorization.enabled: true`) | AMS/DCL policy-based authorization — X.509 bindings for both `virement-srv` and the policies deployer |
| `virement-dms` | Attachment storage (Document Management Service, via `@cap-js/sdm`) |
| `shared-connectivity` | Cloud Connector routing to on-prem S/4 |
| `virement-service-destination`, `virement-service-metadata`, `shared-logs` | Destination lookups, service metadata, log aggregation |

Three external systems are reached purely by *destination name* at runtime — none are declared anywhere in this repo (not in `mta.yaml`, not in `xs-security.json`); they live only as BTP subaccount destinations:

- `QA1-800-S4HANA` — on-prem S/4, via Cloud Connector, for value helps and the Earmarked Funds completion PATCH
- `CPI` — the integration flow that fronts `ZFM_FI_FMBB_UPLOAD` and the Earmarked Funds creation API
- `sap_process_automation_service` — SAP Build Process Automation's REST API

> If a value-help or posting call starts failing with a connection error rather than a business error, check the destination configuration in BTP Cockpit first — it will not be visible anywhere in this codebase.

## 3. Data model

Everything lives in one file: `db/schema.cds` (namespace `ZDB_PPS_VIREMENT`).

### Requests (header)

Key fields: `requestNumber`, `requestType` (immutable after create), `budgetType`, `returnCategory`, `status` (Draft/Rejected/PendingApproval/Completed), `currentApprovalLevel`, the four `*Amount`/`*DocNumber` pairs (tracked independently per type, never summed), `earmarkedFundsDocNumber`, `workflowInstanceId`/`workflowStatus`/`workflowError`.

### RequestItems (line items)

Beyond the user-entered fields (`costCentre`, `glAccount`, `material`, `wbs`, amounts, `description`), nine fields are **system-derived and read-only** — resolved server-side the moment their source field changes, never left to client value-help write-back:

| Field | Derived from | Source |
|---|---|---|
| `costCentreDescription` | `costCentre` | Live S/4 Cost Centre search help |
| `department` | `costCentre` | `DepartmentGrouping` |
| `region` / `branch` | `costCentre` | `RegionBranchGrouping` |
| `buildingName` | `costCentre` | `BuildingGrouping` |
| `glAccountName` | `glAccount` | Live S/4 GL Account search help |
| `glGroup` | `glAccount` | `GLGrouping` |
| `assetType` | `glAccount` | `GLGrouping` — hides Asset Status when `NON ASSET` |
| `functionalDepartment` | `glAccount` | `FunctionalDepartmentGrouping` (matched against a multi-value list) |
| `materialGroupDescription` | `material` | Live S/4 Material Group search help |
| `wbsDescription` | `wbs` | Live S/4 WBS Element search help (`WBSElementVH`) |
| `responsibleCostCentre` | `wbs` | Same WBS Element search help — deliberately kept separate from `costCentre` (see below) |

All are populated in `srv/code/requestitems-drafts-before-create-logic.js` and `requestitems-drafts-before-update-logic.js`, calling `srv/code/utils/*-lookup.js` helper modules — one lookup module per field. **This is the pattern to copy for any new derived item field.**

`responsibleCostCentre` is not shown in any `UI.LineItem` by default (available via column personalization only) and is never read by the Department/Region/Branch cascade above — that cascade is a Non-Project (GL-based) concept. It exists solely to feed the Project Virement approval routing (§4): the Head of Transfer-out Cost Center role is resolved against it, via `ApproverMatrix.departmentBranch`, exactly like `costCentre` already does for Non-Project. A Project item's own `costCentre` is intentionally left empty.

### Master-data ("Grouping") entities

All admin-maintained, `cuid, managed`, explicitly "not sourced from S/4."

| Entity | Maps | Feeds into |
|---|---|---|
| `DepartmentGrouping` | Cost Centre → Department | Item `department`; "Same Department" routing |
| `RegionBranchGrouping` | Cost Centre → Region/State/Branch | Item `region`/`branch`; "Same Region/Branch" routing |
| `GLGrouping` | GL Account → GL Group, Asset Type | Item `glGroup`/`assetType`; "Same GL Group" routing |
| `FunctionalDepartmentGrouping` | GL Accounts list → Functional Department | Priority-0 and fallback "authorized functional department" routing |
| `BuildingGrouping` | Cost Centre → State/building | Item `buildingName` (display only, not yet a routing input) |
| `ApproverMatrix` | Role + scope → current approver email | Every approval lookup — see §4 |
| `ApproverDelegation` | Temporary cover for one `ApproverMatrix` row | Substituted live at lookup time, not retroactive to already-pending requests |

## 4. Approval routing engine

Three files, read together: `utils/virement-scenario.js` (Transfer/Non-Project only) → `utils/approver-routing.js` (branches by request type) → `utils/apply-approver-plan.js` (turns the plan into real `RequestApprovers` rows via `get-approvers-logic.js`).

### Non-Project Virement scenario priority (first match wins)

| # | Scenario | Level 1 | Level 2 |
|---|---|---|---|
| 0 | Functional Department Grouping match (all items share one FD, master-row flags confirm dept/region+branch) | `HOD_FUNC` | — |
| 1 | Different GL Group | `HOD_XFER_CC` × transfer-out line (lettered) | `HOD_JKEW` → L3 `CEO_CFO` |
| 2 | Same Department | `HOD` | — |
| 3 | Same Branch | `HOB` | — |
| 4 | Same Region, different Branch | `HOD_XFER_CC` × transfer-out line (lettered) | `REG_DIR` |
| 5 | Authorized Functional Department (loose) | `HOD_FUNC` | — |
| 6 | Fallback — relationship criteria not met | `HOD_XFER_CC` × transfer-out line (lettered) | Amount-tiered (below) |

Amount tiers (scenario 6, and identically for plain Supplement/Return): `<30,000 → JKEW_PG14` · `≤100,000 → JKEW_PG19` · `≤500,000 → JKEW_PG21` · `else → HOD_JKEW`.

### The "1A–1E" lettered mechanic

Whenever Level 1 is `HOD_XFER_CC`, it resolves **once per transfer-out line item**, in item order — `1A`, `1B`, ... up to `1E` (the enforced 1–5 line cap), each scoped to that line's own `costCentre` via `ApproverMatrix.departmentBranch`. These are **independent parallel approvers**, not redundant alternates — `approve-reject-request.js` waits for every sibling letter to act before the request advances past Level 1 (see §5).

### Project Virement scenario (`classifyVirementProjectScenario`)

Deliberately much simpler than the Non-Project chain above: a Project item is identified by WBS Element alone, whose Responsible Cost Center is auto-derived into the dedicated `responsibleCostCentre` field (§3 — kept separate from `costCentre`, which stays empty for a Project item since the GL-based Department/Region cascade doesn't apply to WBS-based items). There is exactly one level — `HOD_XFER_CC` (Head of Transfer-out Cost Center), resolved once per transfer-out line item against `responsibleCostCentre` via `ApproverMatrix.departmentBranch`, same lettered `1A`–`1E` mechanic as Non-Project. No Level 2/3.

### Other request types (approver-routing.js)

- **Supplement** — fixed single level, role `JKEW_BCM`, no amount dependency.
- **Return, Non-Project** — single level, amount-tiered role (same 4 bands as above).
- **Return, Project** — single level, always `HOD_JKEW` — no amount tiering.

`getManagedLevels(requestType, budgetType)` returns the full universe of levels a combo could *ever* use (e.g. `["1","1A".."1E","2","3"]` for Transfer/Non-Project, `["1A".."1E"]` for Transfer/Project) so `applyApproverPlan` can wipe every stale level from an earlier classification, not just the ones the current plan happens to use — important when item edits mid-draft change which scenario applies.

> Two read-only helpers built on the same plan, both used at submission (§5): `previewApprovalPlanGaps` (any level resolving to zero current approvers — hard blocks) and `resolveApprovalPlanWithApprovers` (levels with actual resolved emails — used for the same-person conflict checks).

## 5. Submission & approval lifecycle

### Every submission-time validation — `requests-before-create-logic.js`

Runs `@Before(CREATE, Requests)`, on both first submission and later edit-saves (distinguished by `isFirstSubmission = !request.data.requestNumber`). In order:

1. **Budget Zerorise role check** — `BUDGET_ZERORISE` role required if `returnCategory === "Z"`. Every submission, not just first.
2. **Field/enum validation** — request ID, type, fiscal year present; type-specific enum checks (return category, transfer category, budget type).
3. **At least one item** exists.
4. **WBS required** for Supplement + Project on every item.
5. **Material/GL alignment** — first 6 digits of Material must match first 6 of GL Account (exempt: Central Fund cost centre).
6. **Cost Centre existence** — validated live against S/4.
7. **Transfer In/Out exclusivity** — Virement only, no single item may carry both.
8. **Item count bounds** — Virement only, 1–5 Transfer-In and 1–5 Transfer-Out items.
9. **Balance check** — Virement only, total Transfer-Out must equal total Transfer-In.
10. **Zero-amount rejection** — every submission; the relevant amount for the request's type must be non-zero.
11. **Approval-plan gap check** — first submission only; any CAP-owned level with zero current approvers hard-blocks.
12. **Same-person conflict checks** — first submission only; Level 1 (incl. 1A–1E) vs Level 2 overlap, and requestor-is-also-an-approver, both via `resolveApprovalPlanWithApprovers`.
13. **Project budget cap** — RM 5,000,000 on Transfer-out/Supplement total.
14. **Request number generation** — first submission only.
15. **S/4 posting simulation** — `simulatePostToS4`, `IV_TEST="X"`, first submission only; a posting-time failure is caught here, before any approver sees the request.
16. **Earmarked Funds reservation** — Virement with transfer-out amount > 0, first submission only; failure aborts the whole submission (runs Before CREATE, nothing persisted yet).

### Approve — `approve-reject-request.js`

1. Finds the caller's own Pending `RequestApprovers` row(s) and every other currently-open task, matched against the BPA workflow's open task(s).
2. **Waits for every parallel sibling** — if other lettered sub-levels (e.g. `1B`/`1C`) at the same numeric level are still Pending, the request does *not* advance yet.
3. Marks this approver's row(s) Approved; if this really was the last outstanding sibling, activates the next level's rows (`LIKE '${nextLevel}%'` — the wildcard is what activates a whole lettered family together).
4. Auto-resolves any remaining same-letter duplicate approvers as "not required to act."
5. **Only once the last configured level has genuinely closed**, calls `performPostToS4` in-process (no BPA round trip) — builds the FMBB payload, posts via CPI, stamps the document number, commits the DB transaction.
6. Completes the BPA task *last*, after S/4 posting has already committed — a BPA-completion failure is logged but does not fail the request.

### Reject

Unconditional and terminal — no level-advancement logic. Sets the request straight to Rejected, auto-resolves every other Pending sibling at the same level as "not required to act," commits, then completes the BPA task with a reject decision.

## 6. S/4 & Earmarked Funds integration

### Posting — `post-to-s4-logic.js`

Calls the RFC-enabled function module **`ZFM_FI_FMBB_UPLOAD`** through the `CPI` destination, endpoint `/http/ZFM_FI_FMBB_UPLOAD`, hand-built SOAP-RFC XML in, XML parsed back out.

| Request Type | `IV_PROC` | Notes |
|---|---|---|
| Supplement | `SUPL` | — |
| Return, Zerorise | `RETN` | — |
| Return, Central Fund | `TRAN` | Funds genuinely move to a different fund centre, so it posts as a Transfer, plus a synthetic line into cost centre `100050500` / GL `760001` |
| Transfer/Virement | `TRAN` | One combined payload — transfer-out lines signed `-`, transfer-in signed `+`, in a single `IT_ITEM` array (not two documents) |

`IV_SUPL_TYPE` is simply `PROJECT` / `NONPROJ` from Budget Type.

> **simulatePostToS4** — runs the identical payload-build/validate/CPI-call path with `IV_TEST="X"` forced on every payload, no document number read, nothing persisted. Called from both `requests-before-create-logic.js` and `requests-resubmit-logic.js` so a bad Cost Centre/GL/unbalanced Transfer is caught at submission, not after the whole approval chain has run.

### Earmarked Funds — `utils/earmarked-funds.js`

A budget reservation created at *submit* time (before the FMBB posting exists) for any **Non-Project** Virement carrying a transfer-out amount — so the money can't be double-committed while the request is in flight. Skipped entirely for **Project** Virement (`requests-before-create-logic.js` gates creation on `budgetTypeCode !== 'P'`, and the `earmarkedFundsDocNumber` field is hidden in the UI for Project too): the Earmarked Funds API's account assignment is Fund Center/Commitment Item only, which doesn't apply to WBS-based items, and reusing the WBS's derived Cost Centre there would be semantically wrong. Two different backends, on purpose:

- **Create + read status** — via the `CPI` iFlow (GET/POST only).
- **Complete** — via the native S/4 OData V4 API directly (`QA1-800-S4HANA`), because the CPI iFlow doesn't expose PATCH. **Currently disabled** — S/4 only exposes a plain field PATCH on `EarmarkedFundsIsCompleted` which confirmed-live does nothing; `requests-after-read-logic.js`'s `refreshEarmarkedFundsStatus` derives completion *locally* instead (true once the transfer document number is set). A manual retry exists: `retryEarmarkedFundsCompletion`, callable by any approver on the request.

### Live S/4 value helps

| Field | Service path |
|---|---|
| Cost Centre | `/sap/opu/odata/sap/API_COSTCENTER_SRV/A_CostCenter` |
| GL Account | `/sap/opu/odata/sap/ZFGL_GW_JV_VALUEHELP_O2/GLAccountVH` |
| Material Group | `/sap/opu/odata/sap/ZFGL_GW_JV_VALUEHELP_O2/MaterialGroupVH` |
| WBS Element | `/sap/opu/odata/sap/ZFGL_GW_JV_VALUEHELP_O2/WBSElementVH` — a purpose-built custom value help, not a standard SAP API, see §11 |

All four go through `QA1-800-S4HANA` and share `srv/code/utils/value-help.js`'s fetch/narrow helpers, which re-rank S/4's fuzzy `search=` results against exactly what the user typed.

## 7. SAP Build workflow integration

One workflow instance per request lifecycle (not per level), started synchronously inside the submit transaction by `startApprovalWorkflow` (`utils/workflow-utils.js`) — POST to `sap_process_automation_service`, definition `virementapprovalworkflowv2.approvalWorkflow`. The context payload carries request identifiers, up to 5 transfer-in cost-centre/GL slots, and — critically — `approvallevel1/2/3` (+ lettered `1a..1e`) **pre-populated from the CAP-owned plan**, so BPA receives already-resolved approver emails for CAP-owned combinations instead of looking them up itself.

### Status tracking is polling, not a webhook

There is no inbound callback from BPA. `requests-after-read-logic.js`'s `refreshLiveWorkflowStatus` polls the instance status on every Object Page read (skipped once terminal), writing back to `workflowStatus`/`workflowError`. Task IDs are looked up live on every Approve/Reject (`getOpenTaskForWorkflowInstance`) rather than stored, so the app can discover the right task without BPA proactively reporting it.

### `getApprovers` / `assignApprovers` and the fully-qualified-path workaround

`getApprovers(userRole, departmentBranch)` is a read-only OData function SAP Build calls back to resolve the current Approver Matrix holder for a role — see `get-approvers-logic.js`. A sibling, `getRequestApprovers`, lets BPA read back approvers CAP has already assigned, bypassing its own decision table for migrated combinations.

> **Confirmed SAP Build connector bug.** Both SAP Build's own Actions-catalog Test tool and a live Process Automation Service Task send unbound actions/functions at the **fully qualified** path — `POST .../ZSVC_PPS_VIREMENT.assignApprovers` instead of the OData-correct `POST .../assignApprovers` — even though the Test tool's own UI *displays* the correct path. `srv/server.js` registers Express route-workaround handlers for this at bootstrap. **Any new unbound action or function called from SAP Build must be added to `ACTIONS_REQUIRING_WORKAROUND` / `FUNCTIONS_REQUIRING_WORKAROUND` in that file**, or SAP Build will 404 against it silently from the workflow side while the Test tool appears to work.

### Task completion

BPA's native Approval Form has no custom output fields, so it cannot carry approver identity/comments back into the workflow. All business logic (approver rows, S/4 posting, Earmarked Funds) happens in CAP first; `completeTask` is called *only* afterward, purely to close the BPA task and advance the workflow branch. If S/4 posting fails, the task is deliberately left open for retry.

### Delegation and BPA task recipients

This app's own `RequestApprovers.emailAddress` is always the source of truth for who can act via its own Approve/Reject/Delegate buttons — the BPA-side sync below is best-effort and never blocks or reverses a delegation that already committed locally.

- **`delegateApproval`** (`delegate-approval-logic.js`) — self-service: the current pending approver hands off their own pending row(s) to someone else.
- **`delegatePendingApproval`** (`delegate-pending-approval-logic.js`), bound to `RequestApprovers`, `@requires: ['ADMIN']` — lets an admin reassign one specific pending assignment from the Approver Matrix Object Page's Pending Approvals facet, without being the approver themselves. Bound-action deep paths matter here: invoked via `ApproverMatrix(ID=...)/PendingApprovals(ID=...)/delegatePendingApproval`, `request.params` holds one entry **per path segment** — the bound entity's own key is always the **last** element (`params[params.length - 1]`), not `params[0]`.
- **`delegateApprovalAsAdmin`** (`delegate-approval-as-admin-logic.js`), bound to `Requests`, `@requires: ['ADMIN']` — delegates every currently-pending approval on a request in one action, from the Requests Object Page itself. Currently wired but its UI button is unconditionally `UI.Hidden` in `annotations.cds` (not in active use).

All three, after committing their own change, best-effort swap the delegate in for the original approver on the matching SAP Build task's `recipientUsers` (`addTaskRecipient` in `utils/workflow-utils.js`) — the delegating approver is removed, any *other* recipient already on the task (e.g. a different approver at the same level) is left untouched. Per the Workflow Runtime API spec (`SPA_Workflow_Runtime.json`), `recipientUsers` is a JSON array on a `TaskInstance` GET but a **comma-separated string** on the `PATCH /v1/task-instances/{id}` payload — `addTaskRecipient` normalizes between the two. Setting it also requires the calling destination credential to hold `ProcessAutomationAdmin` (or already be a recipient) — missing that fails with a 403, logged only, never surfaced as a failure of the delegation itself.

## 8. Authorization model

Two mechanisms populate the exact same `req.user` role-name space, so CDS `@requires` and in-code `hasRole` checks never need to know which one granted a role:

| Mechanism | Defined in | Roles | Granted via |
|---|---|---|---|
| XSUAA (classic) | `xs-security.json` | `REQUEST_APPROVE`, `ADMIN` | BTP Cockpit role collections |
| AMS / IAS (policy-based) | `ams/dcl/cap/basePolicies.dcl` | `REQUEST_APPROVE`, `MASS_UPLOAD_TRANSFER`, `MASS_UPLOAD_ALL`, `BUDGET_ZERORISE` | IAS admin console → Users & Authorizations → Groups (`cap - VR_*`) |

`ADMIN` exists only on the XSUAA side — no AMS policy counterpart. The three "mass upload"/BCM roles exist *only* as AMS policy targets and are checked purely in JS (never at the CDS transport-authorization layer):

| AMS Policy | → Role checked | Gates |
|---|---|---|
| `VR_REQUEST_APPROVE` | `REQUEST_APPROVE` | Approve/Reject/Delegate/PostToS4 actions — declarative `@requires` in `service.cds` |
| `VR_FUNCTIONAL` | `MASS_UPLOAD_TRANSFER` | Which columns a bulk item-upload template exposes — `hasRole` in code |
| `VR_JKEW` | `MASS_UPLOAD_ALL` | Same, broader column set — `hasRole` in code |
| `VR_BCM` | `BUDGET_ZERORISE` | Raising a Budget Zerorise Return — `hasRole` in `requests-before-create-logic.js` and `requests-resubmit-logic.js` |

> To add a new role: add the AMS policy to `ams/dcl/cap/basePolicies.dcl` (this file is hand-maintained, not fully auto-generated — see the gotcha in §11 before touching `dclGenerationPackage`), then check it with `hasRole(user, roleName)` from `srv/code/utils/role-check.js`. For a whole-action gate instead, use CDS `@requires: ['RoleName']` in `srv/service.cds` and it works from either grant path automatically.

## 9. Fiori Elements app structure

`app/virement.zui_pps_virement/webapp/manifest.json` — single OData V4 service, root shell `ext.view.Main` (side-menu `NavContainer`).

### Routes

- **Home** — custom dashboard (pending count, recent requests)
- **VirementRequests / PendingApprovals / MyRequests** — three List Report views over the same `/Requests` entity set, differing only by `SelectionPresentationVariant` filter; Pending Approvals adds mass Approve/Reject toolbar actions
- **RequestsObjectPage** — the main form; 5 `RequestItems` line-item facets (SupplementItems / ReturnItems / TransferInOutItems / TransferFunctional / TransferJKEW), each with its own Upload/Download Template toolbar actions
- **GroupingMaintenance** — a menu hub linking to the 6 admin List Reports (5 Groupings + Approver Matrix)

### Item-list default view

All 5 `RequestItems` LineItem qualifiers live in `annotations.cds`: SR No first, then Cost Centre/GL Account/Material with their description fields inline, then the type-appropriate amount field(s), then Description. The routing/derived fields (Is Department, Department, Is Region & Branch, Region, Branch, GL Group, Functional Department, Is Building, Building Name) are present but marked `UI.Importance: #Low` — available via column personalization, hidden by default. Asset Status is conditionally `UI.Hidden` per row when `assetType = 'NON ASSET'`.

### Controller extensions — `webapp/ext/controller/`

| File | Role |
|---|---|
| `ObjectPageExt.controller.js` | Global ObjectPage extension — workflow-status formatters, Return Category radio write-back, workflow-error popover |
| `ObjectPageCustomActions.js` | RequestItems table toolbar — bound download/upload-items actions, draft-scoped row creation, per-row OData error mapping |
| `PendingApprovalsListReportActions.js` | Mass Approve/Reject — sequential (not parallel) to avoid overloading the S/4 connection |
| 6× `*GroupingListReportActions.js` / `ApproverMatrixListReportActions.js` | Near-identical download/upload pattern per master-data entity — see §10 |

## 10. Master-data maintenance pattern

Six admin-maintained entities (5 Groupings + Approver Matrix) each get an identical, independently-implemented five-file set — **not** a shared generic handler, deliberately duplicated per entity:

1. `download-<entity>-template-logic.js` — `@requires: ['ADMIN']` action returning a base64 XLSX built via `utils/<entity>-template.js`'s column list
2. `upload-<entity>-logic.js` — `@requires: ['ADMIN']`, parses the uploaded workbook, validates every row (required fields, formats, cross-lookups), returns `{rows: validRows}` — **does not write to the DB itself**
3. `webapp/ext/controller/<Entity>ListReportActions.js` — triggers the browser download; on upload, takes the validated rows back from the server and creates them client-side via a draft-enabled OData list binding + `draftActivate` per row
4. `webapp/ext/fragment/<Entity>UploadDialog.fragment.xml` — the FileUploader dialog
5. `utils/<entity>-template.js` — the column key/header/example/width list shared by download and upload header-matching

Errors are capped at 20 rows shown, with a rollup count beyond that, and reject the whole batch — nothing partial is ever created. **Canonical example to copy from**: `upload-approver-matrix-logic.js` is the most heavily documented of the six.

## 11. Known gotchas & hard-won lessons

**`${...}` vs `%{...}` in manifest.json / fragment expression bindings.** A manifest-declared table action's `visible`/`enabled` using `{= ${status_code} === 0 }` silently evaluated to its default (`true`) instead of reading the property — no console error. The fix, already used elsewhere in the codebase (`ObjectPageExt.controller.js` header comment) and confirmed against an official SAP sample: use `%{...}`, not `${...}`, in any expression binding inside a Fiori Elements manifest.json action or XML fragment — `${...}` gets consumed by the XML preprocessor before it reaches the control. If a condition you wrote there seems to be ignored with zero errors, check this first.

**A custom form-field fragment must render exactly one root control.** Adding a second top-level sibling control to `ReturnCategoryField.fragment.xml` (alongside the existing RadioButtonGroup) made both controls disappear with no error, for every Budget Type. Fiori Elements custom field templates expect a single control — wrap multiples in one `VBox`.

**AMS / IAS `authorization_instance_id` can look "enabled" yet not be provisioned.** `cf service virement-ias --params` can correctly show `authorization.enabled: true`, and every deploy already unbinds/rebinds the service — yet a bound app's actual credentials can still lack `authorization_instance_id`, producing "AMS bundle initialization failed." If this happens: check the credentials of the *specific* app binding in question (Cockpit → the `virement-ias` instance → Bound Applications → that app → View Credentials) for the property, rather than assuming instance-level config is the whole picture. A stale in-memory process can also hold old credentials after the binding itself becomes correct — try `cf restart virement-srv` before anything more drastic.

**AMS-generated groups in IAS ≠ XSUAA role collections.** `VR_BCM`/`VR_FUNCTIONAL`/`VR_JKEW` will never appear in BTP Cockpit's Subaccount → Security → Roles page — that page is XSUAA-only. Find them in the IAS admin console (`https://<tenant>.accounts.ondemand.com/admin`) → Applications & Resources → *virement* → Authorization Policies tab, or under Users & Authorizations → Groups as `cap - VR_<name>`.

**`ams/dcl/cap/basePolicies.dcl` is hand-maintained beyond what `@requires` annotations alone produce.** `VR_FUNCTIONAL`/`VR_JKEW`/`VR_BCM` policies exist in this file with **no corresponding `@requires` annotation anywhere in the CDS model** — they were added by hand and are preserved across rebuilds because `@sap/ams` detects manual edits and skips regeneration (confirmed by testing: renaming `dclGenerationPackage` from the default `"cap"` silently *dropped* both policies from the freshly generated file). **Never change `dclGenerationPackage`** without diffing the regenerated file against what's committed first.

**WBS S/4 service path.** Three services were tried before landing on the current one (`srv/code/utils/wbs-elements.js`): `API_WBSELEMENT_SRV/A_WBSElement` worked but has no Cost Center field at all; `API_ENTERPRISE_PROJECT_SRV/A_EnterpriseProjectElement` has `ResponsibleCostCenter` but returned a clean 200 with 0 rows for every query (the destination's technical user most likely isn't authorized for Enterprise Project data); the working path is now a **purpose-built custom value help**, `/sap/opu/odata/sap/ZFGL_GW_JV_VALUEHELP_O2/WBSElementVH` (fields `WBSElement,WBSDescription,ResponsibleCostCenter`), confirmed against a live sample response. It also has a live data-quality quirk: it occasionally returns a row with a blank `WBSElement` key alongside a real description (e.g. `{"WBSElement":"","WBSDescription":"INSTL. PAPANTANDA","ResponsibleCostCenter":""}`) — `readWBSElements` filters these out defensively, since a blank key breaks the value-help dialog's row binding.

**SAP Build's fully-qualified-path bug.** See §7 — any new unbound action/function called by a workflow needs registering in `srv/server.js`'s workaround lists, or it will silently fail from the workflow side while SAP Build's own Test tool appears to work fine.

**Debugging `ZFM_FI_FMBB_UPLOAD` (or any RFC-invoked S/4 function) — set an External Breakpoint, not a normal one.** This function is called via RFC from the `CPI` destination (see §6), not from a dialog session — a plain Session Breakpoint set in your own SAPGUI logon will never trigger for it, even though the code genuinely executes (confirmed by matching the exact `ET_RETURN` message text back to the ABAP source). In the Q (QA1) S/4 backend, set an **External Breakpoint** instead — Utilities → Breakpoints → External Breakpoints in the ABAP editor/debugger, tied to user ID `PWC_RAY` — before triggering the request submission from the app.

## 12. Build & deploy process

1. Confirm the right target: `cf target` — should show the correct org/space. If it shows an unrelated org, re-run `cf login`.
2. `mbt build` from the repo root — produces `mta_archives/virement_1.0.0.mtar`.
3. `cf deploy mta_archives/virement_1.0.0.mtar` — deploys all 7 modules; this also runs the `deploy-dcl` task, pushing any AMS policy changes to IAS.
4. To confirm the AMS policy push specifically succeeded: `cf tasks virement-ams-policies-deployer` (look for `SUCCEEDED`), or `cf logs virement-ams-policies-deployer --recent` for the "Successfully uploaded DCL bundle" line.
5. A CF session can expire mid-deploy on a long-running deploy — if you see "Authentication has expired," re-run `cf login` and simply re-run the same `cf deploy` command; the built `.mtar` is still valid.

> Compile-check any CDS change before building: `npx cds compile db/schema.cds srv/service.cds app/virement.zui_pps_virement/annotations.cds --to edmx`. One pre-existing, harmless warning always appears (`NonUpdateableProperties` on `Requests_RequestAttachments`, from the `@cap-js/attachments` library's own annotation) — anything beyond that line is a real problem.

## License

Internal — Employees Provident Fund (EPF).

---

Done by **Ray**.
