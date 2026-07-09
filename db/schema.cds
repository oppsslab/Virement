namespace ZDB_PPS_VIREMENT;

using {
    cuid,
    managed,
    sap.common.CodeList
} from '@sap/cds/common';


type FiscalYear        : String(4) @assert.format: '^[0-9]{4}$';

entity Requests : cuid, managed {
    @assert.unique
    requestNumber       : String(10)                 @readonly;
    requestType         : Association to RequestType @Core.Immutable;
    budgetType          : Association to BudgetType default 'N';
    transferCategory    : String(1);
    status              : Association to RequestStatus default 0;
    fiscalYear          : FiscalYear                 @readonly;
    submissionPeriod    : Integer; // Month of submission date (1-12)
    submissionDate      : Date;
    requestor           : String(100)                @readonly;
    requestorCostCentre : String(20);
    approvedBy          : String(100); // Last approver (summary)
    supplementAmount    : Decimal(15, 2) default 0   @readonly;
    returnAmount        : Decimal(15, 2) default 0   @readonly;
    transferInAmount    : Decimal(15, 2) default 0   @readonly;
    transferOutAmount   : Decimal(15, 2) default 0   @readonly;
    aging               : Integer default 0          @readonly;
    docNumber           : String(20);
    postingDate         : Date;
    postingPeriod       : Integer; // Month posted to IFAMS (1-12)
    reason              : String(500);
    approverComment     : String(1000);
    requestLink         : String(500);
    RequestItems        : Composition of many RequestItems
                              on RequestItems.request = $self;
    RequestApprovers    : Composition of many RequestApprover
                              on RequestApprovers.request = $self;
    RequestHistory      : Composition of many RequestHistory
                              on RequestHistory.request = $self;
}

entity RequestItems : cuid, managed {
    request           : Association to Requests;
    srNo              : String(3);
    costCentre        : String(20);
    glAccount         : String(20);
    material          : String(40);
    wbs               : String(40);
    assetStatus       : Association to AssetStatus;
    supplementAmount  : Decimal(15, 2) default 0;
    returnAmount      : Decimal(15, 2) default 0;
    transferInAmount  : Decimal(15, 2) default 0;
    transferOutAmount : Decimal(15, 2) default 0;
    description       : String(255);
}

entity RequestHistory : cuid, managed {
    request   : Association to Requests;
    date      : Date;
    time      : Time;
    changedBy : String(100);
    changes   : String(500);
}

// ------------------------------------------------------------------
// PLACEHOLDER — approver workflow pending FSD finalization.
// Keep minimal so compositions compile; extend once the approver
// table/flow is confirmed (approver link, sequence, status, etc.).
// ------------------------------------------------------------------
entity RequestApprover : cuid, managed {
    request : Association to Requests;
// TODO: approver : Association to Approvers;
// TODO: sequence, status, actionDate, actionTime, comment
}

entity Approvers : cuid, managed {
    emailAddress : String(255);
    name         : String(100);
    role         : String(50);
    category     : String(50);
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

type AssetStatusCode   : String(1) enum {
    New = 'N';
    Addition = 'A';
    Replacement = 'R';
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
