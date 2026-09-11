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

## Project structure

```
db/schema.cds          Data model — Requests, RequestItems, approval &
                        master-data ("Grouping") entities
srv/                    CAP service layer
  service.cds           OData service definition, roles, actions
  code/                 Business-logic handlers (validation, approval
                        routing, S/4 posting, workflow integration)
  code/utils/           Shared lookups, approval-plan resolution,
                        S/4/value-help clients
app/virement.zui_pps_virement/
                        Fiori Elements app (annotations, custom
                        controllers, fragments)
ams/dcl/                Authorization Management (AMS) policy
                        definitions
docs/                   Technical reference documentation
```

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

Deployment provisions the CAP service, the Fiori app, the HANA database, and pushes the AMS authorization policies (`ams/dcl/`) to the bound Identity Authentication tenant. See `docs/` for the full technical reference, including the approval-routing engine, S/4 integration, and authorization model.

## License

Internal — Employees Provident Fund (EPF).

---

Done by **Ray**.
