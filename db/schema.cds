namespace ZDB_PPS_VIREMENT;

using {
    cuid,
    managed,
    sap.common.CodeList
} from '@sap/cds/common';


type FiscalYear        : String(4) @assert.format: '^[0-9]{4}$';

entity Requests : cuid, managed {
    @assert.unique
    requestNumber        : String(10)                 @readonly;
    requestType          : Association to RequestType @Core.Immutable;
    budgetType           : Association to BudgetType default 'N';
    // Return requests only: whether the released budget is zerorised or
    // handed back to the central fund. The two are mutually exclusive, so
    // they are modelled as one code instead of two flags, and surfaced as a
    // radio group in the request header. Null for every other request type.
    returnCategory       : Association to ReturnCategory;
    transferCategory     : String(1);
    status               : Association to RequestStatus default 0;
    currentApprovalLevel : Integer;
    fiscalYear           : FiscalYear                 @readonly;
    submissionPeriod     : Integer; // Month of submission date (1-12)
    submissionDate       : Date;
    requestor            : String                     @readonly;
    approvedBy           : String; // Last approver (summary)
    supplementAmount     : Decimal(15, 2) default 0   @readonly;
    returnAmount         : Decimal(15, 2) default 0   @readonly;
    transferInAmount     : Decimal(15, 2) default 0   @readonly;
    transferOutAmount    : Decimal(15, 2) default 0   @readonly;
    aging                : Integer default 0          @readonly;
    supplementDocNumber  : String                     @readonly;
    returnDocNumber      : String                     @readonly;
    transferInDocNumber  : String                     @readonly;
    transferOutDocNumber : String                     @readonly;
    // Earmarked Funds (S/4 fund reservation) document number, created at
    // submit time for Virement requests carrying a transfer-out amount.
    // Kept separate from supplementDocNumber, which holds the FMBB posting
    // document written after approval by post-to-s4-logic.
    earmarkedFundsDocNumber : String                  @readonly;
    postingDate          : Date;
    postingPeriod        : Integer; // Month posted to IFAMS (1-12)
    reason               : String(500);
    approverComment      : String(500);
    requestLink          : String(1000);
    workflowInstanceId   : String;
    workflowStatus       : String;
    workflowError        : LargeString;
    RequestItems         : Composition of many RequestItems
                               on RequestItems.request = $self;
    RequestApprovers     : Composition of many RequestApprovers
                               on RequestApprovers.request = $self;
    RequestHistory       : Composition of many RequestHistory
                               on RequestHistory.request = $self;
}

entity RequestItems : cuid, managed {
    request           : Association to Requests;
    srNo              : String(3);
    costCentre        : String(10);
    /*
     * Read-only, system-derived from Department Grouping master data
     * (see DepartmentGrouping below) whenever costCentre is set/
     * changed - never client-writable. Used for Virement approval
     * routing (Same/Different Department).
     */
    department        : String(150) @readonly;
    /*
     * Read-only, system-derived from Region & Branch Grouping master
     * data (see RegionBranchGrouping below) whenever costCentre is
     * set/changed - never client-writable. Used for Virement approval
     * routing (Same/Different Region, Same/Different Branch).
     */
    region            : String(150) @readonly;
    branch            : String(150) @readonly;
    glAccount         : String;
    /*
     * Read-only, system-derived from GL Grouping master data (see
     * GLGrouping below) whenever glAccount is set/changed - never
     * client-writable. Used for Virement approval routing (Same/
     * Different GL Group).
     */
    glGroup           : String(100) @readonly;
    /*
     * Read-only, system-derived from Functional Department Grouping
     * master data (see FunctionalDepartmentGrouping below) whenever
     * glAccount is set/changed - never client-writable. Matches
     * glAccount against each row's (multi-value) glAccounts list.
     * Used for Virement approval routing ("authorized functional
     * department" scenario).
     */
    functionalDepartment : String(200) @readonly;
    material          : String;
    wbs               : String;
    assetStatus       : Association to AssetStatus;
    supplementAmount  : Decimal(15, 2) default 0;
    returnAmount      : Decimal(15, 2) default 0;
    transferInAmount  : Decimal(15, 2) default 0;
    transferOutAmount : Decimal(15, 2) default 0;
    description       : String(500);
}

entity RequestHistory : cuid, managed {
    request   : Association to Requests;
    date      : Date;
    time      : Time;
    changedBy : String;
    changes   : String(500);
}

entity RequestApprovers : cuid, managed {
    request      : Association to Requests;
    emailAddress : String;
    userRole     : String;
    level        : String;
    status       : Association to ApproverStatus default 0;
    taskId       : String;
    actionDate   : DateTime;
    comment      : String(500);
}

//
//  Code Lists
//

type RequestTypeCode   : String(1) enum {
    SUPPL = 'S';
    RETN = 'R';
    TRAN = 'T';
};

entity RequestType : CodeList {
    key code : RequestTypeCode
};

type RequestStatusCode : Integer enum {
    Draft = 0;
    Rejected = 1;
    PendingApproval = 2;
    Completed = 3;
};

entity RequestStatus : CodeList {
    key code : RequestStatusCode
};

type ApproverStatusCode : Integer enum {
    Inactive = 0;
    Rejected = 1;
    PendingApproval = 2;
    Completed = 3;
};

entity ApproverStatus : CodeList {
    key code : ApproverStatusCode
};

type AssetStatusCode   : String(3) enum {
    New = '001';
    Addition = '002';
    Replacement = '003';
};

entity AssetStatus : CodeList {
    key code : AssetStatusCode
};

type BudgetTypeCode    : String(1) enum {
    PROJECT = 'P';
    NONPROJ = 'N';
};

entity BudgetType : CodeList {
    key code : BudgetTypeCode
};

type ReturnCategoryCode : String(1) enum {
    ZERORISE = 'Z';
    CENTRALFUND = 'C';
};

entity ReturnCategory : CodeList {
    key code : ReturnCategoryCode
};

/*
 * User roles eligible to be assigned in the Approver Matrix. Modelled
 * as a plain CodeList rather than an enum, since these are full role
 * names (e.g. "Head of Department") rather than short technical codes.
 */
entity UserRoles : CodeList {
    key code : String(60);
};

/*
 * Approver Matrix - reference data maintained by admins recording who
 * currently holds each approval-related role, for which department or
 * branch, and for what period. This is master data only: it does not
 * itself drive the BPA approval workflow or RequestApprovers.
 */
entity ApproverMatrix : cuid, managed {
    userRole         : Association to UserRoles @mandatory;
    departmentBranch : String(100);
    emailAddress     : String(100) @mandatory;
    name             : String(100) @mandatory;
    isActive         : Boolean default true;
    startDate        : Date;
    endDate          : Date;
    Delegations      : Composition of many ApproverDelegation
                            on Delegations.approverMatrix = $self;
};

/*
 * Approver Delegation - lets an approver (an Approver Matrix row)
 * schedule ahead of time who covers for them, and for which date
 * range. Whenever getApprovers/resolveApprovers resolves this row and
 * today falls within an active delegation's start/end date, the
 * delegate's email/name is returned instead of the row's own
 * emailAddress/name - so any request routed to this approver during
 * that window is assigned straight to the delegate.
 *
 * This only affects approvers assigned FROM this point forward (a
 * fresh Calculate/Submit, or SAP Build's own getApprovers). It does
 * NOT retroactively reassign a request that was already Pending
 * Approval before the delegation started - use the per-request
 * "Delegate Approval" action for that (delegate-approval-logic.js).
 */
entity ApproverDelegation : cuid, managed {
    approverMatrix : Association to ApproverMatrix;
    delegateEmail  : String(100) @mandatory;
    delegateName   : String(100);
    startDate      : Date        @mandatory;
    endDate        : Date        @mandatory;
};

/*
 * GL Grouping - reference data maintained by admins mapping each GL
 * Account to its GL Group (and the wider Expenditure Group above
 * that). Used to determine "Same GL Group" vs "Different GL Group"
 * for Virement approval routing. Master data only: maintained here,
 * not sourced from S/4.
 */
entity GLGrouping : cuid, managed {
    expenditureGroup     : String(100) @mandatory;
    glGroup              : String(100) @mandatory;
    glAccount            : String(10)  @mandatory;
    glAccountDescription : String(200);
    assetType            : String(10);
    functional           : String(20);
};

/*
 * Department Grouping - reference data maintained by admins mapping
 * each Cost Centre to its Department. Used to determine "Same/
 * Different Department" for Virement approval routing. Master data
 * only: maintained here, not sourced from S/4.
 */
entity DepartmentGrouping : cuid, managed {
    department            : String(150) @mandatory;
    costCentre            : String(10)  @mandatory;
    costCentreDescription : String(200);
};

/*
 * Functional Department Grouping - reference data maintained by
 * admins listing each functional department, the GL Accounts it
 * covers for Virement, and the Fund Centre scope it can transfer
 * into. Used for the "authorized functional department" Virement
 * approval routing scenario. Master data only: maintained here, not
 * sourced from S/4.
 */
entity FunctionalDepartmentGrouping : cuid, managed {
    functionalDepartment : String(200)  @mandatory;
    itemType             : String(500);
    glAccounts           : String(2000);
    fundCentreScope      : String(200);
    remarks              : String(1000);
};

/*
 * Building Grouping - reference data maintained by admins mapping
 * each Cost Centre to its State (building/property location). Used
 * to determine "Same/Different Region" for Virement approval
 * routing. Master data only: maintained here, not sourced from S/4.
 */
entity BuildingGrouping : cuid, managed {
    state                 : String(50)  @mandatory;
    costCentre            : String(10)  @mandatory;
    costCentreDescription : String(200);
};

/*
 * Region & Branch Grouping - reference data maintained by admins
 * mapping each Cost Centre to its Region, State, and Branch. Used to
 * determine "Same/Different Region" and "Same/Different Branch" for
 * Virement approval routing. Master data only: maintained here, not
 * sourced from S/4.
 */
entity RegionBranchGrouping : cuid, managed {
    region                : String(150) @mandatory;
    state                 : String(50);
    branch                : String(150) @mandatory;
    costCentre            : String(10)  @mandatory;
    costCentreDescription : String(200);
};
