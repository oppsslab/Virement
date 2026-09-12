using {ZDB_PPS_VIREMENT as my} from '../db/schema.cds';

using {Attachments} from '@cap-js/sdm';

extend my.Requests {
    RequestAttachments : Composition of many Attachments
                         @Validation.MaxItems: 5;
}

@path: '/service/ZSVC_PPS_VIREMENT'
service ZSVC_PPS_VIREMENT @(requires: 'authenticated-user') {
    @(restrict: [
        /*
         * Every authenticated user can read every request, whoever
         * raised it. This backs the View All Requests tile.
         *
         * Reading is all this grants. Editing, approving and rejecting
         * stay bound by the rules below, so seeing someone else's
         * request does not confer any right to act on it. Drafts are
         * unaffected: CAP keeps an in-progress draft visible only to
         * the user who owns it.
         */
        {grant: 'READ'},

        /*
         * Users can create requests.
         */
        {grant: 'CREATE'},

        /*
         * Users can update their own requests.
         */
        {
            grant: 'UPDATE',
            where: 'createdBy = $user'
        },

        /*
         * Assigned approvers can update requests pending approval.
         */
        {
            grant: 'UPDATE',
            to   : 'REQUEST_APPROVE',
            where: 'status_code = 2 and exists RequestApprovers[emailAddress = $user]'
        },

        /*
         * Generic request actions.
         */
        {
            grant: [
                'resubmitRequest'
            ],
            where: 'createdBy = $user and status_code = 1'
        },

        /*
         * Generic request actions.
         */
        {grant: [
            'calculateValues',
            'uploadItems',
            'downloadItemsTemplate'
        ]},

        /*
         * Only the assigned approver can approve/reject/delegate a pending approval request.
         */
        {
            grant: [
                'approveRequest',
                'rejectRequest',
                'postToS4',
                'delegateApproval'
            ],
            to   : 'REQUEST_APPROVE',
            where: 'status_code = 2 and exists RequestApprovers[emailAddress = $user]'
        },

        /*
         * Marking an Earmarked Funds document complete is best-effort
         * at approval time (see approve-reject-request.js) and never
         * retried automatically if S/4 rejects it. Any of this
         * request's approvers can retry it afterwards, regardless of
         * the request's current status, since the underlying S/4
         * document lives on independently of this app once the
         * transfer is posted.
         */
        {
            grant: ['retryEarmarkedFundsCompletion'],
            to   : 'REQUEST_APPROVE',
            where: 'exists RequestApprovers[emailAddress = $user]'
        },
    ])
    @odata.draft.enabled
    entity Requests             as
        projection on my.Requests {
            *,
            virtual isPendingApprover : Boolean default false,
            virtual isJKEW            : Boolean,
            virtual isFunctional      : Boolean,
            /*
             * True when the current user holds the ADMIN role -
             * computed in requests-after-read-logic.js. Drives the
             * Admin-only Delegate button on the Object Page, which
             * (unlike the self-service Delegate button, gated on
             * isPendingApprover) lets an admin delegate ANY request's
             * pending approval(s), not just their own.
             */
            virtual isAdmin           : Boolean default false,
            /*
             * True when the current user is this request's own
             * requestor. Filter-only, like isPendingApprover above:
             * requests-list-scope-logic.js rewrites an "isMyRequest eq
             * true" filter into a real WHERE on the requestor column
             * before it reaches the database.
             */
            virtual isMyRequest       : Boolean default false,
            /*
             * Live-checked against S/4 on every Object Page read (see
             * requests-after-read-logic.js) - never persisted, since
             * the Earmarked Funds document's completion status can
             * change in S/4 independently of this app (e.g. once the
             * FMBB posting references it as its predecessor).
             */
            virtual earmarkedFundsIsCompleted : Boolean default false,
            /*
             * Live workflow execution log, read straight from SAP Build
             * Process Automation (see WorkflowLogs below) rather than
             * stored - this is an unmanaged association purely so the
             * Object Page can show it as a facet; workflow-logs-read-logic.js
             * resolves the actual rows for whichever workflowInstanceId
             * this filters on.
             */
            WorkflowLogs              : Association to many WorkflowLogs
                                             on WorkflowLogs.workflowInstanceId = workflowInstanceId
        }
        actions {
            action calculateValues()                 returns Requests;

            action resubmitRequest()                  returns Requests;

            @requires: ['REQUEST_APPROVE']
            action approveRequest()                  returns Requests;

            @requires: ['REQUEST_APPROVE']
            action rejectRequest(
                                 @title: 'Reason'
                                 comment: String)    returns Requests;

            @requires: ['REQUEST_APPROVE']
            action delegateApproval(
                                 @title: 'Delegate To'
                                 delegateEmail: String) returns Requests;

            /*
             * Admin-only counterpart to delegateApproval above,
             * exposed as a Delegate button on the Requests Object
             * Page itself - lets an ADMIN delegate every currently
             * pending approval on this request without being an
             * approver themselves. See
             * delegate-approval-as-admin-logic.js.
             */
            @requires: ['ADMIN']
            action delegateApprovalAsAdmin(
                                 @title: 'Delegate To'
                                 delegateEmail: String) returns Requests;

            /*
             * Manually retries completing this request's Earmarked
             * Funds document in S/4, for when the best-effort attempt
             * at approval time (approve-reject-request.js) failed
             * silently. See utils/earmarked-funds.js.
             */
            @requires: ['REQUEST_APPROVE']
            action retryEarmarkedFundsCompletion() returns Requests;

            action uploadItems(content: LargeString) returns Requests;

            action downloadItemsTemplate()           returns TemplateFile;
        };

    entity RequestItems         as
        projection on my.RequestItems {
            *,
            /*
             * Display-only helpers for the Virement approval-routing
             * scenario (see utils/virement-scenario.js) - "Yes" once
             * the corresponding auto-derived field(s) are populated,
             * so a tester can see at a glance which scenario an item
             * lines up with, without inspecting the raw
             * department/region/branch values themselves.
             */
            case
                when department is not null and department <> '' then 'Yes'
                else 'No'
            end as isDepartment       : String(3),
            case
                when region is not null and region <> ''
                    and branch is not null and branch <> '' then 'Yes'
                else 'No'
            end as isRegionAndBranch  : String(3),
            case
                when buildingName is not null and buildingName <> '' then 'Yes'
                else 'No'
            end as isBuilding         : String(3)
        };

    @readonly
    entity RequestHistory       as projection on my.RequestHistory;

    @readonly
    entity RequestApprovers     as
        projection on my.RequestApprovers
        actions {
            /*
             * Admin-triggered bulk delegation, invoked from the Approver
             * Matrix Object Page's Pending Approvals facet (an admin
             * selects one or more rows there and reassigns them without
             * being a pending approver themselves - contrast with
             * delegateApproval above, which only the current pending
             * approver can call on their own request). Bound to
             * RequestApprovers (not Requests) so each call unambiguously
             * targets exactly the one pending assignment the admin
             * selected. See delegate-pending-approval-logic.js.
             */
            @requires: ['ADMIN']
            action delegatePendingApproval(
                                 @title: 'Delegate To'
                                 delegateEmail: String) returns RequestApprovers;
        };

    type TemplateFile {
        fileName : String;
        content  : LargeString;
        mimeType : String;
    }

    type S4Message {
        type      : String(1);
        id        : String(20);
        number    : String(10);
        message   : String(500);
        messageV1 : String(100);
        messageV2 : String(100);
        messageV3 : String(100);
        messageV4 : String(100);
        parameter : String(100);
        row       : String(10);
        field     : String(100);
    }

    type S4PostingResult {
        success        : Boolean;
        simulated      : Boolean;
        requestId      : UUID;
        documentNumber : String(20);
        statusCode     : Integer;
        postingDate    : Date;
        postingPeriod  : Integer;
        messages       : many S4Message;
        errors         : many S4Message;
    }

    @readonly
    @cds.persistence.skip
    entity RecentRequests {
        key ID            : UUID;
            requestNumber : String;
            requestType   : String;
            status        : String;
    }

    /*
     * Number of requests waiting for the CURRENT user's approval.
     * Filled by the ON READ handler, which matches the user against
     * the pending RequestApprovers rows.
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity PendingApprovalCount {
        key pendingCount : Integer;
    }

    /*
     * Cost centre search help, served live from S/4 through the
     * QA1-800-S4HANA destination. Not persisted: every read is a call
     * to S/4, filtered by whatever the user has typed.
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity CostCenters {
        key costCentre      : String(10);
            costCentreName  : String(100);
            controllingArea : String(4);
    }

    /*
     * GL account search help, served live from S/4 through the
     * QA1-800-S4HANA destination. Not persisted: every read is a call
     * to S/4, filtered by whatever the user has typed.
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity GLAccounts {
        key glAccount         : String(10);
            glAccountName     : String(100);
            glAccountLongName : String(200);
            companyCode       : String(4);
            isExpenseAccount  : Boolean;
    }

    /*
     * Material group search help, served live from S/4 through the
     * QA1-800-S4HANA destination.
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity MaterialGroups {
        key materialGroup            : String(20);
            materialGroupDescription : String(200);
    }

    /*
     * WBS element search help, served live from S/4 through the
     * QA1-800-S4HANA destination.
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity WBSElements {
        key wbsElement            : String(24);
            wbsDescription        : String(40);
            responsibleCostCenter : String(10);
    }

    @readonly
    entity UserDetails {
        key emailAddress : String(255);
            fullName     : String(200);
    }

    /*
     * Workflow execution log, read live from SAP Build Process
     * Automation's GET /workflow-instances/{id}/execution-logs, for
     * display as an Object Page facet on Requests (see the
     * WorkflowLogs association there). Not persisted: every read is
     * a call to SAP Build, scoped to whichever workflowInstanceId
     * the incoming request filters on (workflow-logs-read-logic.js).
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity WorkflowLogs {
        key logId              : String(50);
            workflowInstanceId : String(36);
            // Timestamp (not DateTime): SAP Build's execution log
            // entries carry millisecond precision ("...046Z"), which
            // DateTime's second-only precision cannot round-trip.
            timestamp          : Timestamp;
            type               : String(100);
            activityName       : String(200);
            message            : String(1000);
    }

    action assignApprovers(requestId: UUID,
                           level: String,
                           approvers: array of {
        Email : String;
    }) returns Boolean;

    /*
     * One-time admin maintenance action: backfills costCentreDescription/
     * glAccountName/materialGroupDescription on existing RequestItems
     * rows that predate those fields (see
     * code/backfill-item-descriptions-logic.js). Only ever fills a
     * currently-empty field.
     */
    @requires: ['ADMIN']
    action backfillItemDescriptions() returns {
        scanned : Integer;
        updated : Integer;
        failed  : Integer;
        errors  : array of String;
    };

    /*
     * Approver Matrix - reference data maintained by admins. Reading
     * is open to any authenticated user, same as the rest of this
     * service; maintaining it (create/update/delete) is restricted to
     * ADMIN below.
     *
     * Draft-enabled so the List Report table supports inline edit of
     * existing rows - that Fiori Elements feature requires a draft
     * service, not just Capabilities.UpdateRestrictions.
     */
    @(restrict: [
        {grant: 'READ'},
        {
            grant: ['CREATE', 'UPDATE', 'DELETE'],
            to   : 'ADMIN'
        },
    ])
    @odata.draft.enabled
    entity ApproverMatrix as projection on my.ApproverMatrix;

    /*
     * Access follows the parent ApproverMatrix row (same pattern as
     * RequestItems under Requests): no separate restrict block here.
     */
    entity ApproverDelegation as projection on my.ApproverDelegation;

    /*
     * Without an ETag, the SAPUI5 OData V4 model has no reliable way
     * to tell a row changed after editing it on the Object Page and
     * navigating back, so the List Report table kept showing the
     * pre-edit values until a manual browser refresh. modifiedAt (from
     * the managed aspect) already updates on every save, so it doubles
     * as the concurrency-control property.
     */
    annotate ApproverMatrix with {
        modifiedAt @odata.etag;
    };

    @requires: ['ADMIN']
    action downloadApproverMatrixTemplate() returns TemplateFile;

    @requires: ['ADMIN']
    action uploadApproverMatrix(content: LargeString) returns {
        rows : array of {
            userRole_code    : String;
            departmentBranch : String;
            emailAddress     : String;
            name             : String;
            isActive         : Boolean;
            startDate        : Date;
            endDate          : Date;
        };
    };

    /*
     * GL Grouping - reference data maintained by admins mapping each
     * GL Account to its GL Group, for Virement approval routing.
     * Reading is open to any authenticated user; maintaining it
     * (create/update/delete) is restricted to ADMIN, same as the
     * Approver Matrix above.
     */
    @(restrict: [
        {grant: 'READ'},
        {
            grant: ['CREATE', 'UPDATE', 'DELETE'],
            to   : 'ADMIN'
        },
    ])
    @odata.draft.enabled
    entity GLGrouping as projection on my.GLGrouping;

    @requires: ['ADMIN']
    action downloadGLGroupingTemplate() returns TemplateFile;

    @requires: ['ADMIN']
    action uploadGLGrouping(content: LargeString) returns {
        rows : array of {
            expenditureGroup     : String;
            glGroup              : String;
            glAccount            : String;
            glAccountDescription : String;
            assetType            : String;
            functional           : String;
        };
    };

    /*
     * Department Grouping - reference data maintained by admins
     * mapping each Cost Centre to its Department, for Virement
     * approval routing. Reading is open to any authenticated user;
     * maintaining it (create/update/delete) is restricted to
     * ADMIN, same as the Approver Matrix / GL Grouping above.
     */
    @(restrict: [
        {grant: 'READ'},
        {
            grant: ['CREATE', 'UPDATE', 'DELETE'],
            to   : 'ADMIN'
        },
    ])
    @odata.draft.enabled
    entity DepartmentGrouping as projection on my.DepartmentGrouping;

    @requires: ['ADMIN']
    action downloadDepartmentGroupingTemplate() returns TemplateFile;

    @requires: ['ADMIN']
    action uploadDepartmentGrouping(content: LargeString) returns {
        rows : array of {
            department            : String;
            costCentre            : String;
            costCentreDescription : String;
        };
    };

    /*
     * Functional Department Grouping - reference data maintained by
     * admins listing each functional department, the GL Accounts it
     * covers, and its Fund Centre scope, for Virement approval
     * routing. Reading is open to any authenticated user; maintaining
     * it (create/update/delete) is restricted to ADMIN, same as
     * the Approver Matrix / GL Grouping / Department Grouping above.
     */
    @(restrict: [
        {grant: 'READ'},
        {
            grant: ['CREATE', 'UPDATE', 'DELETE'],
            to   : 'ADMIN'
        },
    ])
    @odata.draft.enabled
    entity FunctionalDepartmentGrouping as projection on my.FunctionalDepartmentGrouping;

    @requires: ['ADMIN']
    action downloadFunctionalDepartmentGroupingTemplate() returns TemplateFile;

    @requires: ['ADMIN']
    action uploadFunctionalDepartmentGrouping(content: LargeString) returns {
        rows : array of {
            functionalDepartment : String;
            itemType             : String;
            glAccounts           : String;
            isBuildingGrouping   : Boolean;
            isDepartment         : Boolean;
            isRegionAndBranch    : Boolean;
            remarks              : String;
        };
    };

    /*
     * Building Grouping - reference data maintained by admins mapping
     * each Cost Centre to its State, for Virement approval routing.
     * Reading is open to any authenticated user; maintaining it
     * (create/update/delete) is restricted to ADMIN, same as the
     * other grouping tables above.
     */
    @(restrict: [
        {grant: 'READ'},
        {
            grant: ['CREATE', 'UPDATE', 'DELETE'],
            to   : 'ADMIN'
        },
    ])
    @odata.draft.enabled
    entity BuildingGrouping as projection on my.BuildingGrouping;

    @requires: ['ADMIN']
    action downloadBuildingGroupingTemplate() returns TemplateFile;

    @requires: ['ADMIN']
    action uploadBuildingGrouping(content: LargeString) returns {
        rows : array of {
            state                 : String;
            costCentre            : String;
            costCentreDescription : String;
        };
    };

    /*
     * Region & Branch Grouping - reference data maintained by admins
     * mapping each Cost Centre to its Region, State, and Branch, for
     * Virement approval routing. Reading is open to any authenticated
     * user; maintaining it (create/update/delete) is restricted to
     * ADMIN, same as the other grouping tables above.
     */
    @(restrict: [
        {grant: 'READ'},
        {
            grant: ['CREATE', 'UPDATE', 'DELETE'],
            to   : 'ADMIN'
        },
    ])
    @odata.draft.enabled
    entity RegionBranchGrouping as projection on my.RegionBranchGrouping;

    @requires: ['ADMIN']
    action downloadRegionBranchGroupingTemplate() returns TemplateFile;

    @requires: ['ADMIN']
    action uploadRegionBranchGrouping(content: LargeString) returns {
        rows : array of {
            region                : String;
            state                 : String;
            branch                : String;
            costCentre            : String;
            costCentreDescription : String;
        };
    };

    /*
     * For SAP Build Process Automation: resolves the current, valid
     * approver(s) for a given Approver Matrix role. "Valid" means the
     * matching row is Active and today falls within its Start/End
     * Date (an unset End Date means no expiry). departmentBranch is
     * optional - omit it for roles that aren't department/branch
     * specific (Regional Director, CFO, CEO, ...).
     *
     * userRole accepts either the role's code (e.g. "HOD") or its
     * full display name (e.g. "Head of Department").
     *
     * A GET-style function rather than an action, since this only
     * reads data and has no side effects.
     */
    function getApprovers(
        userRole         : String,
        departmentBranch : String
    ) returns array of {
        emailAddress     : String;
        name             : String;
        userRole         : String;
        departmentBranch : String;
    };

    /*
     * For SAP Build Process Automation: reads back the approver
     * email address(es) CAP has already assigned to a request at a
     * given level, instead of the workflow deciding them itself via
     * its own decision table. Used for (requestType, budgetType)
     * combinations already migrated into CAP (see
     * srv/code/utils/approver-routing.js) - e.g. Supplement + Non
     * Project, where CAP assigns the Level 1 approver before the
     * workflow even starts, so the requestor can see it before
     * submitting.
     */
    function getRequestApprovers(
        requestId : UUID,
        level     : String
    ) returns array of {
        emailAddress : String;
    };
}
