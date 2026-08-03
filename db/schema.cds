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
    RequestApprovers     : Composition of many RequestApprover
                               on RequestApprovers.request = $self;
    RequestHistory       : Composition of many RequestHistory
                               on RequestHistory.request = $self;
}

entity RequestItems : cuid, managed {
    request           : Association to Requests;
    srNo              : String(3);
    costCentre        : String(10);
    glAccount         : String;
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

entity RequestApprover : cuid, managed {
    request      : Association to Requests;
    emailAddress : String;
    level        : Integer;
    status       : Association to RequestStatus default 2;
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
