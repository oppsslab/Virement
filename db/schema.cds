namespace ZDB_PPS_VIREMENT;

using {
    cuid,
    managed,
    sap.common.CodeList
} from '@sap/cds/common';

type FiscalYear          : String(4) @assert.format: '^[0-9]{4}$';

entity Requests : cuid, managed {
    @assert.unique
    requestNumber       : String(10);
    requestType         : Association to RequestType;
    status              : Association to RequestStatus;
    fiscalYear          : FiscalYear;
    submissionPeriod    : String;
    requestorCostCentre : String;
    submissionDate      : Date;
    requestor           : String;
    approvedBy          : String;
    totalAmount         : Decimal(15, 2);
    aging               : Integer;
    docNumber           : String;
    postingDate         : Date;
    postingPeriod       : Integer;
    reason              : String;
    approverComment     : String;
    RequestItems        : Composition of many RequestItems
                              on RequestItems.request = $self;
    RequestApprovers    : Composition of many RequestApprover
                              on RequestApprovers.request = $self;
    RequestHistory      : Composition of many RequestHistory
                              on RequestHistory.request = $self;
    RequestAttachments  : Composition of many RequestAttachment
                              on RequestAttachments.request = $self;
}

entity RequestItems : cuid, managed {
    @assert.unique
    request     : Association to Requests;
    srNo        : String(3);
    costCentre  : String;
    glAccount   : Date;
    material    : String;
    wbs         : String;
    assetStatus : Association to AssetStatus;
    type        : Association to RequestItemType;
    amount      : Decimal(15, 2);
    description : Integer;
}

entity RequestHistory : cuid, managed {
    request   : Association to Requests;
    date      : Date;
    time      : Time;
    changedBy : String;
    changes   : String;
}

entity RequestApprover : cuid, managed {
    request : Association to Requests;
}

entity RequestAttachment : cuid, managed {
    request  : Association to Requests;
    objectId : String;
    fileName : String;
    mimeType : String;
}

//
//  Code Lists
//

type RequestTypeCode     : String(1) enum {
    Supplement = 'S';
    Return = 'R';
    Project = 'P';
    NonProject = 'N';
    Functional = 'F';
    JKEW = 'J';
};

entity RequestType : CodeList {
    key code : RequestTypeCode
};

type RequestItemTypeCode : String(1) enum {
    Supplement = 'S';
    Return = 'R';
    TransferIn = 'I';
    TransferOut = 'O';
};

entity RequestItemType : CodeList {
    key code : RequestItemTypeCode
};

type RequestStatusCode   : String(1) enum {
    Draft = 'D';
    PendingApprovalL1 = '1';
    PendingApprovalL2 = '2';
    Completed = 'C';
};

entity RequestStatus : CodeList {
    key code : RequestStatusCode
};

type AssetStatusCode     : String(1) enum {
    New = 'N';
    Addition = 'A';
    Replacement = 'R';
};

entity AssetStatus : CodeList {
    key code : AssetStatusCode
};
