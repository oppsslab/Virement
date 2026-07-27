using ZSVC_PPS_VIREMENT as service from '../../srv/service';
using from '../../db/schema';


// =============================================================================
// Requests - Field Labels, Value Helps, Field Controls
// =============================================================================

annotate service.Requests with {
    requestNumber        @(title: '{i18n>RequestNumber}');

    requestType          @(
        title                          : '{i18n>RequestType}',
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

    budgetType           @(
        title                          : '{i18n>BudgetType}',
        Common.Text                    : budgetType.descr,
        Common.Text.@UI.TextArrangement: #TextOnly,
        Common.ValueListWithFixedValues: true,
        Common.ValueList               : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'BudgetType',
            SearchSupported: false,
            Parameters     : [{
                $Type            : 'Common.ValueListParameterInOut',
                LocalDataProperty: budgetType_code,
                ValueListProperty: 'code'
            }]
        }
    );

    status               @(
        title                          : '{i18n>Status}',
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

    fiscalYear           @(title: '{i18n>FiscalYear}');
    submissionPeriod     @(title: '{i18n>SubmissionPeriod}');
    submissionDate       @(title: '{i18n>SubmissionDate}');
    requestor            @(
        title              : '{i18n>Requestor}',
        Common.FieldControl: #ReadOnly
    );
    pendingApprover      @(
        title              : '{i18n>PendingApprover}',
        Common.FieldControl: #ReadOnly
    );
    approvedBy           @(
        title              : '{i18n>ApprovedBy}',
        Common.FieldControl: #ReadOnly
    );
    supplementAmount     @(title: '{i18n>SupplementAmount}');
    returnAmount         @(title: '{i18n>ReturnAmount}');
    transferInAmount     @(title: '{i18n>TransferInAmount}');
    transferOutAmount    @(title: '{i18n>TransferOutAmount}');
    aging                @(title: '{i18n>Aging}');
    supplementDocNumber  @(title: '{i18n>SupplementDocNumber}');
    returnDocNumber      @(title: '{i18n>ReturnDocNumber}');
    transferInDocNumber  @(title: '{i18n>TransferInDocNumber}');
    transferOutDocNumber @(title: '{i18n>TransferOutDocNumber}');
    postingDate          @(title: '{i18n>PostingDate}');
    postingPeriod        @(title: '{i18n>PostingPeriod}');
    reason               @(title: '{i18n>Reason}');
    requestLink          @UI.Hidden;
};


// =============================================================================
// Requests - List Report
// =============================================================================

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
                Value: pendingApprover
            },
            {
                $Type: 'UI.DataField',
                Value: approvedBy
            },
            {
                $Type: 'UI.DataField',
                Value: aging
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
        // {
        //     $Type        : 'UI.DataFieldForAction',
        //     Action       : 'service.approveRequest',
        //     Label        : '{i18n>Approve}',
        //     Criticality  : #Positive,
        //     ![@UI.Hidden]: {$edmJson: {$Or: [
        //         {$Ne: [
        //             {$Path: 'status_code'},
        //             2
        //         ]},
        //         {$Eq: [
        //             {$Path: 'hideApprovalBtn'},
        //             true
        //         ]},
        //         {$Eq: [
        //             {$Path: 'IsActiveEntity'},
        //             false
        //         ]}
        //     ]}}
        // },
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'ZSVC_PPS_VIREMENT.postToS4',
            Label        : '{i18n>Approve}',
            Criticality  : #Positive,
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Ne: [
                    {$Path: 'status_code'},
                    2
                ]},
                {$Eq: [
                    {$Path: 'isPendingApprover'},
                    false
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
                    {$Path: 'isPendingApprover'},
                    false
                ]},
                {$Eq: [
                    {$Path: 'IsActiveEntity'},
                    false
                ]}
            ]}}
        },
    ],
    UI.UpdateHidden   : {$edmJson: {$And: [
        {$Ne: [
            {$Path: 'status_code'},
            2
        ]},
        {$Ne: [
            {$Path: 'status_code'},
            0
        ]},
    ]}}
);


// =============================================================================
// Requests - Object Page Header
// =============================================================================

annotate service.Requests with @(
    UI.HeaderInfo                  : {
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

    UI.DataPoint #Status           : {
        Title      : '{i18n>Status}',
        Value      : status.descr,
        Criticality: status_code
    },

    UI.DataPoint #SupplementAmount : {
        Title: '{i18n>SupplementAmount}',
        Value: supplementAmount
    },

    UI.DataPoint #ReturnAmount     : {
        Title: '{i18n>ReturnAmount}',
        Value: returnAmount
    },

    UI.DataPoint #TransferInAmount : {
        Title: '{i18n>TransferInAmount}',
        Value: transferInAmount
    },

    UI.DataPoint #TransferOutAmount: {
        Title: '{i18n>TransferOutAmount}',
        Value: transferOutAmount
    },

    UI.DataPoint #Requestor        : {
        Title: '{i18n>Requestor}',
        Value: requestor
    },

    UI.DataPoint #FiscalYear       : {
        Title: '{i18n>FiscalYear}',
        Value: fiscalYear
    },

    UI.HeaderFacets                : [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'StatusHeaderFacet',
            Label : '{i18n>Status}',
            Target: '@UI.DataPoint#Status'
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'SupplementAmountHeaderFacet',
            Label        : '{i18n>SupplementAmount}',
            Target       : '@UI.DataPoint#SupplementAmount',
            ![@UI.Hidden]: {$edmJson: {$And: [
                {$Ne: [
                    {$Path: 'requestType_code'},
                    'S'
                ]},
                {$Or: [
                    {$Ne: [
                        {$Path: 'requestType_code'},
                        'T'
                    ]},
                    {$And: [
                        {$Ne: [
                            {$Path: 'transferCategory'},
                            'J'
                        ]},
                        {$Or: [
                            {$Ne: [
                                {$Path: 'transferCategory'},
                                null
                            ]},
                            {$Ne: [
                                {$Path: 'isJKEW'},
                                true
                            ]}
                        ]}
                    ]}
                ]}
            ]}}
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'ReturnAmountHeaderFacet',
            Label        : '{i18n>ReturnAmount}',
            Target       : '@UI.DataPoint#ReturnAmount',
            ![@UI.Hidden]: {$edmJson: {$And: [
                {$Ne: [
                    {$Path: 'requestType_code'},
                    'R'
                ]},
                {$Or: [
                    {$Ne: [
                        {$Path: 'requestType_code'},
                        'T'
                    ]},
                    {$And: [
                        {$Ne: [
                            {$Path: 'transferCategory'},
                            'J'
                        ]},
                        {$Or: [
                            {$Ne: [
                                {$Path: 'transferCategory'},
                                null
                            ]},
                            {$Ne: [
                                {$Path: 'isJKEW'},
                                true
                            ]}
                        ]}
                    ]}
                ]}
            ]}}
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'TransferInAmountHeaderFacet',
            Label        : '{i18n>TransferInAmount}',
            Target       : '@UI.DataPoint#TransferInAmount',
            ![@UI.Hidden]: {$edmJson: {$Ne: [
                {$Path: 'requestType_code'},
                'T'
            ]}}
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'TransferOutAmountHeaderFacet',
            Label        : '{i18n>TransferOutAmount}',
            Target       : '@UI.DataPoint#TransferOutAmount',
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Ne: [
                    {$Path: 'requestType_code'},
                    'T'
                ]},
                {$And: [
                    {$Ne: [
                        {$Path: 'transferCategory'},
                        'J'
                    ]},
                    {$Ne: [
                        {$Path: 'transferCategory'},
                        'F'
                    ]},
                    {$Or: [
                        {$Ne: [
                            {$Path: 'transferCategory'},
                            null
                        ]},
                        {$And: [
                            {$Ne: [
                                {$Path: 'isFunctional'},
                                true
                            ]},
                            {$Ne: [
                                {$Path: 'isJKEW'},
                                true
                            ]}
                        ]}
                    ]}
                ]}
            ]}}
        }
    ],

    UI.Facets                      : [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'RequestHeader',
            Label : '{i18n>RequestHeader}',
            Target: '@UI.FieldGroup#RequestHeader'
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'SupplementRequestItems',
            Label        : '{i18n>RequestDetails}',
            Target       : 'RequestItems/@UI.PresentationVariant#SupplementItems',
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Ne: [
                    {$Path: 'requestType_code'},
                    'S'
                ]},
                {$Eq: [
                    {$Path: 'status_code'},
                    0
                ]}
            ]}}
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'ReturnRequestItems',
            Label        : '{i18n>RequestDetails}',
            Target       : 'RequestItems/@UI.PresentationVariant#ReturnItems',
            ![@UI.Hidden]: {$edmJson: {$Ne: [
                {$Path: 'requestType_code'},
                'R'
            ]}}
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'TransferInItems',
            Label        : '{i18n>TransferInDetails}',
            Target       : 'RequestItems/@UI.PresentationVariant#TransferInItems',
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Ne: [
                    {$Path: 'requestType_code'},
                    'T'
                ]},
                {$Eq: [
                    {$Path: 'transferCategory'},
                    'J'
                ]},
                {$Eq: [
                    {$Path: 'transferCategory'},
                    'F'
                ]},
                {$And: [
                    {$Eq: [
                        {$Path: 'transferCategory'},
                        null
                    ]},
                    {$Or: [
                        {$Eq: [
                            {$Path: 'isFunctional'},
                            true
                        ]},
                        {$Eq: [
                            {$Path: 'isJKEW'},
                            true
                        ]}
                    ]}
                ]}
            ]}}
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'TransferOutItems',
            Label        : '{i18n>TransferOutDetails}',
            Target       : 'RequestItems/@UI.PresentationVariant#TransferOutItems',
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Ne: [
                    {$Path: 'requestType_code'},
                    'T'
                ]},
                {$Ne: [
                    {$Path: 'status_code'},
                    2
                ]},
                {$Eq: [
                    {$Path: 'transferCategory'},
                    'J'
                ]},
                {$Eq: [
                    {$Path: 'transferCategory'},
                    'F'
                ]},
                {$And: [
                    {$Eq: [
                        {$Path: 'transferCategory'},
                        null
                    ]},
                    {$Or: [
                        {$Eq: [
                            {$Path: 'isFunctional'},
                            true
                        ]},
                        {$Eq: [
                            {$Path: 'isJKEW'},
                            true
                        ]}
                    ]}
                ]}
            ]}}
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'TransferFunctional',
            Label        : '{i18n>RequestDetails}',
            Target       : 'RequestItems/@UI.PresentationVariant#TransferFunctional',
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Ne: [
                    {$Path: 'requestType_code'},
                    'T'
                ]},
                {$And: [
                    {$Ne: [
                        {$Path: 'transferCategory'},
                        'F'
                    ]},
                    {$Or: [
                        {$Ne: [
                            {$Path: 'transferCategory'},
                            null
                        ]},
                        {$Ne: [
                            {$Path: 'isFunctional'},
                            true
                        ]},
                        {$Eq: [
                            {$Path: 'isJKEW'},
                            true
                        ]}
                    ]}
                ]}
            ]}}
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'TransferJKEW',
            Label        : '{i18n>RequestDetails}',
            Target       : 'RequestItems/@UI.PresentationVariant#TransferJKEW',
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Ne: [
                    {$Path: 'requestType_code'},
                    'T'
                ]},
                {$And: [
                    {$Ne: [
                        {$Path: 'transferCategory'},
                        'J'
                    ]},
                    {$Or: [
                        {$Ne: [
                            {$Path: 'transferCategory'},
                            null
                        ]},
                        {$Ne: [
                            {$Path: 'isJKEW'},
                            true
                        ]}
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

    UI.FieldGroup #RequestHeader   : {
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
                $Type        : 'UI.DataField',
                Value        : budgetType_code,
                ![@UI.Hidden]: {$edmJson: {$And: [
                    {$Ne: [
                        {$Path: 'requestType_code'},
                        'S'
                    ]},
                    {$Or: [
                        {$Ne: [
                            {$Path: 'requestType_code'},
                            'T'
                        ]},
                        {$Eq: [
                            {$Path: 'transferCategory'},
                            'J'
                        ]},
                        {$Eq: [
                            {$Path: 'transferCategory'},
                            'F'
                        ]},
                        {$And: [
                            {$Eq: [
                                {$Path: 'transferCategory'},
                                null
                            ]},
                            {$Or: [
                                {$Eq: [
                                    {$Path: 'isFunctional'},
                                    true
                                ]},
                                {$Eq: [
                                    {$Path: 'isJKEW'},
                                    true
                                ]}
                            ]}
                        ]}
                    ]}
                ]}}
            },
            {
                $Type: 'UI.DataField',
                Value: reason
            },
            {
                $Type        : 'UI.DataField',
                Value        : supplementDocNumber,
                ![@UI.Hidden]: {$edmJson: {$Or: [
                    {$Ne: [
                        {$Path: 'status_code'},
                        3
                    ]},
                    {$Ne: [
                        {$Path: 'requestType_code'},
                        'S'
                    ]}
                ]}}
            },
            {
                $Type        : 'UI.DataField',
                Value        : returnDocNumber,
                ![@UI.Hidden]: {$edmJson: {$Or: [
                    {$Ne: [
                        {$Path: 'status_code'},
                        3
                    ]},
                    {$Ne: [
                        {$Path: 'requestType_code'},
                        'R'
                    ]}
                ]}}
            },
            {
                $Type        : 'UI.DataField',
                Value        : transferInDocNumber,
                ![@UI.Hidden]: {$edmJson: {$Or: [
                    {$Ne: [
                        {$Path: 'status_code'},
                        3
                    ]},
                    {$Ne: [
                        {$Path: 'requestType_code'},
                        'T'
                    ]}
                ]}}
            },
            {
                $Type        : 'UI.DataField',
                Value        : transferOutDocNumber,
                ![@UI.Hidden]: {$edmJson: {$Or: [
                    {$Ne: [
                        {$Path: 'status_code'},
                        3
                    ]},
                    {$Ne: [
                        {$Path: 'requestType_code'},
                        'T'
                    ]}
                ]}}
            }
        ]
    }
);


// =============================================================================
// Requests - Side Effects
// =============================================================================

annotate service.Requests actions {
    calculateValues @(Common.SideEffects: {TargetProperties: [
        'in/supplementAmount',
        'in/returnAmount',
        'in/transferInAmount',
        'in/transferOutAmount'
    ]})
};

annotate service.Requests with @Common.SideEffects #RefreshItemsAfterItemChange: {
    SourceEntities: [RequestItems],
    TargetEntities: [RequestItems]
};

annotate service.Requests actions {
    postToS4 @(Common.SideEffects: {TargetProperties: [
        'in/status_code',
        'in/supplementDocNumber',
        'in/returnDocNumber',
        'in/transferInDocNumber',
        'in/transferOutDocNumber'
    ]})
};


// =============================================================================
// RequestItems - Field Labels, Value Helps, Field Controls
// =============================================================================

annotate service.RequestItems with {
    srNo              @(
        title              : '{i18n>SRNo}',
        Common.FieldControl: #ReadOnly
    );
    costCentre        @(title: '{i18n>CostCentre}');
    glAccount         @(title: '{i18n>GL}');
    material          @(title: '{i18n>Material}');
    wbs               @(title: '{i18n>WBS}');
    assetStatus       @(
        title                          : '{i18n>AssetStatus}',
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
    supplementAmount  @(
        title       : '{i18n>SupplementAmount}',
        Common.Label: '{i18n>Amount}'
    );
    returnAmount      @(
        title       : '{i18n>ReturnAmount}',
        Common.Label: '{i18n>Amount}'
    );
    transferInAmount  @(
        title       : '{i18n>TransferInAmount}',
        Common.Label: '{i18n>Amount}'
    );
    transferOutAmount @(
        title       : '{i18n>TransferOutAmount}',
        Common.Label: '{i18n>Amount}'
    );
    description       @(title: '{i18n>Description}');
};


// =============================================================================
// RequestItems - Object Page Tables (Three Separate Tables by Type)
// =============================================================================

annotate service.RequestItems with @(
    // =========================================================================
    // Supplement Items Table (Type S)
    // =========================================================================
    UI.LineItem #SupplementItems              : [
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
            Value: supplementAmount
        },
        {
            $Type: 'UI.DataField',
            Value: description
        }
    ],

    UI.PresentationVariant #SupplementItems   : {
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : srNo,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem#SupplementItems']
    },

    // =========================================================================
    // Return Items Table (Type R)
    // =========================================================================
    UI.LineItem #ReturnItems                  : [
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
            Value: returnAmount
        },
        {
            $Type: 'UI.DataField',
            Value: description
        }
    ],

    UI.PresentationVariant #ReturnItems       : {
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : srNo,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem#ReturnItems']
    },

    // =========================================================================
    // Transfer In Items Table (Type T)
    // =========================================================================
    UI.LineItem #TransferInItems              : [
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
            Value: transferInAmount
        },
        {
            $Type: 'UI.DataField',
            Value: description
        }
    ],

    UI.PresentationVariant #TransferInItems   : {
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : srNo,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem#TransferInItems']
    },

    // =========================================================================
    // Transfer Functional
    // =========================================================================
    UI.LineItem #TransferFunctional           : [
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
            Value: transferInAmount,
            Label: '{i18n>TransferInAmount}',
        },
        {
            $Type: 'UI.DataField',
            Value: transferOutAmount,
            Label: '{i18n>TransferOutAmount}',
        },
        {
            $Type: 'UI.DataField',
            Value: description
        }
    ],

    UI.PresentationVariant #TransferFunctional: {
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : srNo,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem#TransferFunctional']
    },


    // =========================================================================
    // Transfer JKEW
    // =========================================================================
    UI.LineItem #TransferJKEW                 : [
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
            Value: supplementAmount,
            Label: '{i18n>SupplementAmount}',
        },
        {
            $Type: 'UI.DataField',
            Value: returnAmount,
            Label: '{i18n>ReturnAmount}',
        },
        {
            $Type: 'UI.DataField',
            Value: transferInAmount,
            Label: '{i18n>TransferInAmount}',
        },
        {
            $Type: 'UI.DataField',
            Value: transferOutAmount,
            Label: '{i18n>TransferOutAmount}',
        },
        {
            $Type: 'UI.DataField',
            Value: description
        }
    ],

    UI.PresentationVariant #TransferJKEW      : {
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : srNo,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem#TransferJKEW']
    },

    // =========================================================================
    // Transfer Out Items Table (Type T)
    // =========================================================================
    UI.LineItem #TransferOutItems             : [
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
            Value: transferInAmount
        },
        {
            $Type: 'UI.DataField',
            Value: description
        }
    ],

    UI.PresentationVariant #TransferOutItems  : {
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : srNo,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem#TransferOutItems']
    },

    Capabilities.SearchRestrictions           : {Searchable: false}
);


// =============================================================================
// Code Lists - Request Type
// =============================================================================

annotate service.RequestType with {
    code  @(
        Common.Text                    : descr,
        Common.Text.@UI.TextArrangement: #TextOnly
    );
    descr @(title: '{i18n>RequestType}');
};


// =============================================================================
// Code Lists - Request Status
// =============================================================================

annotate service.RequestStatus with {
    code  @(
        Common.Text                    : descr,
        Common.Text.@UI.TextArrangement: #TextOnly
    );
    descr @(title: '{i18n>Status}');
};


// =============================================================================
// Code Lists - Asset Status
// =============================================================================

annotate service.AssetStatus with {
    code  @(
        Common.Text                    : descr,
        Common.Text.@UI.TextArrangement: #TextOnly
    );
    descr @(title: '{i18n>AssetStatus}');
};


// =============================================================================
// Code Lists - Budget Type
// =============================================================================

annotate service.BudgetType with {
    code  @(
        Common.Text                    : descr,
        Common.Text.@UI.TextArrangement: #TextOnly
    );
    descr @(title: '{i18n>BudgetType}');
};


// =============================================================================
// RequestHistory - List Report
// =============================================================================

annotate service.RequestHistory with @(
    UI.LineItem #History           : [
        {
            $Type: 'UI.DataField',
            Value: date,
            Label: '{i18n>Date}'
        },
        {
            $Type: 'UI.DataField',
            Value: time,
            Label: '{i18n>Time}'
        },
        {
            $Type: 'UI.DataField',
            Value: changedBy,
            Label: '{i18n>ChangedBy}'
        },
        {
            $Type: 'UI.DataField',
            Value: changes,
            Label: '{i18n>Changes}'
        }
    ],
    Capabilities.SearchRestrictions: {Searchable: false},
    Capabilities.UpdateRestrictions: {Updatable: false},
    UI.CreateHidden,
    UI.DeleteHidden
);


// =============================================================================
// Request Attachments
// =============================================================================

annotate service.Requests.RequestAttachments with @(Capabilities.SearchRestrictions: {Searchable: false});
