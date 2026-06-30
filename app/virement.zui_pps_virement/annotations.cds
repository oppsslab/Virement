using ZSVC_PPS_VIREMENT as service from '../../srv/service';
using from '../../db/schema';


// -----------------------------------------------------------------------------
// Requests - Field Labels, Value Helps, Field Controls
// -----------------------------------------------------------------------------

annotate service.Requests with {
    requestNumber       @(title: 'Request Number');

    requestType         @(
        title                          : 'Request Type',
        Common.Text                    : requestType.descr,
        Common.Text.@UI.TextArrangement: #TextOnly,
        Common.ValueListWithFixedValues: true,
        Common.ValueList               : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'RequestType',
            SearchSupported: false,
            Parameters     : [{
                $Type            : 'Common.ValueListParameterInOut',
                LocalDataProperty: requestType_code,
                ValueListProperty: 'code'
            }]
        },
        Common.FieldControl            : #Mandatory
    );

    status              @(
        title                          : 'Status',
        Common.Text                    : status.descr,
        Common.Text.@UI.TextArrangement: #TextOnly,
        Common.ValueListWithFixedValues: true,
        Common.ValueList               : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'RequestStatus',
            SearchSupported: false,
            Parameters     : [{
                $Type            : 'Common.ValueListParameterInOut',
                LocalDataProperty: status_code,
                ValueListProperty: 'code'
            }]
        }
    );

    fiscalYear          @(title: 'Fiscal Year');

    submissionPeriod    @(title: 'Submission Period');

    submissionDate      @(title: 'Submission Date');

    requestor           @(
        title              : 'Requestor',
        Common.FieldControl: #ReadOnly
    );

    requestorCostCentre @(title: 'Requestor Cost Centre');

    approvedBy          @(title: 'Approved By');

    totalAmount         @(title: 'Amount');

    aging               @(title: 'Aging(Days)');

    docNumber           @(title: 'Doc Number');

    postingDate         @(title: 'Posting Date');

    postingPeriod       @(title: 'Posting Period');

    reason              @(title: 'Reason');

    requestLink         @UI.Hidden;
};


// -----------------------------------------------------------------------------
// Requests - List Report
// -----------------------------------------------------------------------------

annotate service.Requests with @(
    UI.LineItem       : {
        $value            : [
            {
                $Type: 'UI.DataField',
                Value: requestNumber
            },
            {
                $Type: 'UI.DataField',
                Value: requestType.descr
            },
            {
                $Type: 'UI.DataField',
                Value: status.descr
            },
            {
                $Type: 'UI.DataField',
                Value: fiscalYear
            },
            {
                $Type: 'UI.DataField',
                Value: submissionPeriod
            },
            {
                $Type: 'UI.DataField',
                Value: submissionDate
            },
            {
                $Type: 'UI.DataField',
                Value: requestor
            },
            {
                $Type: 'UI.DataField',
                Value: requestorCostCentre
            },
            {
                $Type: 'UI.DataField',
                Value: approvedBy
            },
            {
                $Type: 'UI.DataField',
                Value: totalAmount
            },
            {
                $Type: 'UI.DataField',
                Value: aging
            },
            {
                $Type: 'UI.DataField',
                Value: docNumber
            },
            {
                $Type: 'UI.DataField',
                Value: postingDate
            },
            {
                $Type: 'UI.DataField',
                Value: postingPeriod
            },
            {
                $Type: 'UI.DataField',
                Value: reason
            }
        ],

        ![@UI.Criticality]: status_code
    },

    UI.CreateHidden,
    UI.DeleteHidden,

    UI.SelectionFields: [
        requestNumber,
        status_code,
        requestType_code
    ],
    UI.Identification : [
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'service.calculateValues',
            Label        : '{i18n>Calculate}',
            ![@UI.Hidden]: IsActiveEntity
        },
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'service.approveRequest',
            Label        : '{i18n>Approve}',
            Criticality  : #Positive,
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Ne: [
                    {$Path: 'status_code'},
                    2
                ]},
                {$Eq: [
                    {$Path: 'hideApprovalBtn'},
                    true
                ]},
                {$Eq: [
                    {$Path: 'IsActiveEntity'},
                    false
                ]}
            ]}}
        },
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'service.rejectRequest',
            Label        : '{i18n>Reject}',
            Criticality  : #Negative,
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Ne: [
                    {$Path: 'status_code'},
                    2
                ]},
                {$Eq: [
                    {$Path: 'hideApprovalBtn'},
                    true
                ]},
                {$Eq: [
                    {$Path: 'IsActiveEntity'},
                    false
                ]}
            ]}}
        },
    ],
);


// -----------------------------------------------------------------------------
// Requests - Object Page
// -----------------------------------------------------------------------------

annotate service.Requests with @(
    UI.HeaderInfo               : {
        TypeName      : '{i18n>VirementRequest}',
        TypeNamePlural: '{i18n>VirementRequests}',
        Title         : {
            $Type: 'UI.DataField',
            Value: requestNumber
        },
        Description   : {
            $Type: 'UI.DataField',
            Value: requestType.descr
        }
    },

    UI.DataPoint #Status        : {
        Title      : '{i18n>Status}',
        Value      : status.descr,
        Criticality: status_code
    },

    UI.DataPoint #TotalAmount   : {
        Title: '{i18n>TotalAmount}',
        Value: totalAmount
    },

    UI.DataPoint #Requestor     : {
        Title: '{i18n>Requestor}',
        Value: requestor
    },

    UI.DataPoint #FiscalYear    : {
        Title: '{i18n>FiscalYear}',
        Value: fiscalYear
    },

    UI.HeaderFacets             : [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'StatusHeaderFacet',
            Label : '{i18n>Status}',
            Target: '@UI.DataPoint#Status'
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'TotalAmountHeaderFacet',
            Label : '{i18n>TotalAmount}',
            Target: '@UI.DataPoint#TotalAmount'
        }
    ],

    UI.Facets                   : [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'RequestHeader',
            Label : '{i18n>RequestHeader}',
            Target: '@UI.FieldGroup#RequestHeader'
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'RequestDetails',
            Label        : '{i18n>RequestDetails}',
            Target       : 'RequestItems/@UI.PresentationVariant#RequestDetails',
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Eq: [
                    {$Path: 'requestType_code'},
                    'N'
                ]},
                {$And: [
                    {$Eq: [
                        {$Path: 'requestType_code'},
                        'S'
                    ]},
                    {$Ne: [
                        {$Path: 'status_code'},
                        2
                    ]}
                ]}
            ]}}
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'RequestDetails',
            Label        : '{i18n>RequestDetails}',
            Target       : 'RequestItems/@UI.PresentationVariant#RequestDetails',
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Eq: [
                    {$Path: 'requestType_code'},
                    'N'
                ]},
                {$And: [
                    {$Eq: [
                        {$Path: 'requestType_code'},
                        'S'
                    ]},
                    {$Ne: [
                        {$Path: 'status_code'},
                        2
                    ]}
                ]}
            ]}}
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'RequestAttachments',
            Label : '{i18n>Attachments}',
            Target: 'RequestAttachments/@UI.LineItem'
        },
        {
            $Type        : 'UI.ReferenceFacet',
            Label        : '{i18n>History}',
            ID           : 'History',
            Target       : 'RequestHistory/@UI.LineItem#History',
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'status_code'},
                0
            ]}}
        }
    ],

    UI.FieldGroup #RequestHeader: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                $Type: 'UI.DataField',
                Value: requestor
            },
            {
                $Type: 'UI.DataField',
                Value: fiscalYear
            },
            {
                $Type: 'UI.DataField',
                Value: reason
            }
        ]
    }
);


// -----------------------------------------------------------------------------
// Requests - Side Effects
// -----------------------------------------------------------------------------

// annotate service.Requests with @(Common.SideEffects #RequestTypeChanged: {
//     SourceProperties: [
//         requestType_code,
//         status_code
//     ],
//     TargetProperties: ['hideRequestDetailsSection']
// });

annotate service.Requests actions {
    calculateValues @(Common.SideEffects: {TargetProperties: ['in/totalAmount']})
};

annotate service.Requests with @Common.SideEffects #RefreshItemsAfterItemChange: {
    SourceEntities: [RequestItems],
    TargetEntities: [RequestItems]
};


// -----------------------------------------------------------------------------
// RequestItems - Field Labels, Value Helps, Field Controls
// -----------------------------------------------------------------------------

annotate service.RequestItems with {
    srNo        @(
        title              : 'SR No',
        Common.FieldControl: #ReadOnly
    );

    costCentre  @(title: 'Cost Centre');

    glAccount   @(title: 'GL');

    material    @(title: 'Material');

    wbs         @(title: 'WBS');

    assetStatus @(
        title                          : 'Asset Status',
        Common.Text                    : assetStatus.descr,
        Common.Text.@UI.TextArrangement: #TextOnly,
        Common.ValueListWithFixedValues: true,
        Common.ValueList               : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'AssetStatus',
            SearchSupported: false,
            Parameters     : [{
                $Type            : 'Common.ValueListParameterInOut',
                LocalDataProperty: assetStatus_code,
                ValueListProperty: 'code'
            }]
        }
    );

    amount      @(
        title       : 'Amount',
        Common.Label: '{i18n>Amount}',
    );

    description @(title: 'Description');
};


// -----------------------------------------------------------------------------
// RequestItems - Object Page Table
// -----------------------------------------------------------------------------

annotate service.RequestItems with @(
    UI.LineItem #RequestDetails           : [
        {
            $Type: 'UI.DataField',
            Value: srNo
        },
        {
            $Type: 'UI.DataField',
            Value: costCentre
        },
        {
            $Type: 'UI.DataField',
            Value: glAccount
        },
        {
            $Type: 'UI.DataField',
            Value: material
        },
        {
            $Type: 'UI.DataField',
            Value: wbs
        },
        {
            $Type: 'UI.DataField',
            Value: assetStatus_code
        },
        {
            $Type: 'UI.DataField',
            Value: amount
        },
        {
            $Type: 'UI.DataField',
            Value: description
        }
    ],

    UI.PresentationVariant #RequestDetails: {
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : srNo,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem#RequestDetails'],
    },

    Capabilities.SearchRestrictions       : {Searchable: false}
);


// -----------------------------------------------------------------------------
// Code Lists - Request Type
// -----------------------------------------------------------------------------

annotate service.RequestType with {
    code  @(
        Common.Text                    : descr,
        Common.Text.@UI.TextArrangement: #TextOnly
    );

    descr @(title: 'Type');
};


// -----------------------------------------------------------------------------
// Code Lists - Request Status
// -----------------------------------------------------------------------------

annotate service.RequestStatus with {
    code  @(
        Common.Text                    : descr,
        Common.Text.@UI.TextArrangement: #TextOnly
    );

    descr @(title: 'Status');
};


// -----------------------------------------------------------------------------
// Code Lists - Asset Status
// -----------------------------------------------------------------------------

annotate service.AssetStatus with {
    code  @(
        Common.Text                    : descr,
        Common.Text.@UI.TextArrangement: #TextOnly
    );

    descr @(title: 'Asset Status');
};


// -----------------------------------------------------------------------------
// RequestHistory - List Report
// -----------------------------------------------------------------------------

annotate service.RequestHistory with @(
    UI.LineItem #History           : [
        {
            $Type: 'UI.DataField',
            Value: date,
            Label: 'Date',
        },
        {
            $Type: 'UI.DataField',
            Value: time,
            Label: 'Time',
        },
        {
            $Type: 'UI.DataField',
            Value: changedBy,
            Label: 'Name',
        },
        {
            $Type: 'UI.DataField',
            Value: changes,
            Label: 'Changes',
        },
    ],
    Capabilities.SearchRestrictions: {Searchable: false},
    Capabilities.UpdateRestrictions: {Updatable: false},
    UI.CreateHidden,
    UI.DeleteHidden
);


// -----------------------------------------------------------------------------
// Request Attachments
// -----------------------------------------------------------------------------

annotate service.Requests.RequestAttachments with @(Capabilities.SearchRestrictions: {Searchable: false}, );
