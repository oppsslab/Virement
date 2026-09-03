using ZSVC_PPS_VIREMENT as service from '../../srv/service';
using from '../../db/schema';


// =============================================================================
// Requests - Field Labels, Value Helps, Field Controls
// =============================================================================

annotate service.Requests with {
    requestNumber        @(title: '{i18n>RequestNumber}');

    /*
     * The managed aspect marks these @UI.HiddenFilter, which keeps them
     * out of the filter bar. They are wanted as filter fields here, so
     * the flag is overridden. Labels come from @sap/cds/common
     * ("Created On" / "Changed On").
     */
    createdAt            @UI.HiddenFilter: false;

    modifiedAt           @UI.HiddenFilter: false;

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

    /*
     * Return requests only. The Object Page renders this as a radio group
     * through the ReturnCategory custom field (see manifest.json); the value
     * help below is what drives the list report filter and the text
     * arrangement everywhere else.
     */
    returnCategory       @(
        title                          : '{i18n>ReturnCategory}',
        Common.Text                    : returnCategory.descr,
        Common.Text.@UI.TextArrangement: #TextOnly,
        Common.ValueListWithFixedValues: true,
        Common.ValueList               : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'ReturnCategory',
            SearchSupported: false,
            Parameters     : [{
                $Type            : 'Common.ValueListParameterInOut',
                LocalDataProperty: returnCategory_code,
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
    earmarkedFundsDocNumber @(title: '{i18n>EarmarkedFundsDocNumber}');
    postingDate          @(title: '{i18n>PostingDate}');
    postingPeriod        @(title: '{i18n>PostingPeriod}');
    reason               @(title: '{i18n>Reason}');
    transferCategory     @(title: '{i18n>TransferCategory}');
    currentApprovalLevel @(title: '{i18n>CurrentApprovalLevel}');
    approverComment      @(title: '{i18n>ApproverComment}');
    workflowInstanceId   @(title: '{i18n>WorkflowInstanceId}');
    workflowStatus       @(title: '{i18n>WorkflowStatus}');
    workflowError        @(title: '{i18n>WorkflowError}');

    /*
     * Virtual flags filled by requests-after-read-logic. They drive
     * conditional visibility, but still surface in table and filter
     * personalization, so they need readable labels.
     */
    isPendingApprover    @(title: '{i18n>IsPendingApprover}');
    isJKEW               @(title: '{i18n>IsJKEW}');
    isFunctional         @(title: '{i18n>IsFunctional}');

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
                Value: approvedBy
            },
            {
                $Type: 'UI.DataField',
                Value: aging
            },
            {
                $Type: 'UI.DataField',
                Value: reason
            },
            {
                $Type: 'UI.DataField',
                Value: createdAt
            },
            {
                $Type: 'UI.DataField',
                Value: modifiedAt
            }
        ],
        ![@UI.Criticality]: status_code
    },

    UI.CreateHidden,
    UI.DeleteHidden,

    UI.SelectionFields: [
        requestNumber,
        status_code,
        requestType_code,
        createdAt,
        modifiedAt
    ],

    /*
     * Default sort for the list reports: newest request number first.
     * Request numbers are issued in sequence, so descending order puts
     * the most recent requests at the top.
     */
    UI.PresentationVariant: {
        $Type         : 'UI.PresentationVariantType',
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : requestNumber,
            Descending: true
        }],
        Visualizations: ['@UI.LineItem']
    },

    /*
     * Drives the Pending Approvals list, via that target's
     * defaultTemplateAnnotationPath.
     *
     * isPendingApprover is a virtual field, so it cannot be filtered in
     * SQL. requests-list-scope-logic intercepts this filter and rewrites
     * it into a real ID restriction before the query reaches the
     * database. status 2 keeps drafts and decided requests off the page.
     */
    UI.SelectionVariant #PendingApprovals: {
        $Type        : 'UI.SelectionVariantType',
        SelectOptions: [
            {
                $Type       : 'UI.SelectOptionType',
                PropertyName: isPendingApprover,
                Ranges      : [{
                    $Type : 'UI.SelectionRangeType',
                    Sign  : #I,
                    Option: #EQ,
                    Low   : true
                }]
            },
            {
                $Type       : 'UI.SelectOptionType',
                PropertyName: status_code,
                Ranges      : [{
                    $Type : 'UI.SelectionRangeType',
                    Sign  : #I,
                    Option: #EQ,
                    Low   : 2
                }]
            }
        ]
    },

    UI.SelectionPresentationVariant #PendingApprovals: {
        $Type              : 'UI.SelectionPresentationVariantType',
        SelectionVariant   : ![@UI.SelectionVariant#PendingApprovals],
        PresentationVariant: ![@UI.PresentationVariant]
    },

    UI.Identification : [
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'service.calculateValues',
            Label        : '{i18n>Calculate}',
            ![@UI.Hidden]: IsActiveEntity
        },
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'service.resubmitRequest',
            Label        : '{i18n>resubmitRequest}',
            Criticality  : #Positive,
            ![@UI.Hidden]: {$edmJson: {$Or: [
                {$Ne: [
                    {$Path: 'status_code'},
                    1
                ]},
                {$Eq: [
                    {$Path: 'IsActiveEntity'},
                    false
                ]}
            ]}}
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
                    {$Path: 'isPendingApprover'},
                    false
                ]},
                {$Eq: [
                    {$Path: 'IsActiveEntity'},
                    false
                ]}
            ]}}
        },
        // {
        //     $Type        : 'UI.DataFieldForAction',
        //     Action       : 'ZSVC_PPS_VIREMENT.postToS4',
        //     Label        : '{i18n>Approve}',
        //     Criticality  : #Positive,
        //     ![@UI.Hidden]: {$edmJson: {$Or: [
        //         {$Ne: [
        //             {$Path: 'status_code'},
        //             2
        //         ]},
        //         {$Eq: [
        //             {$Path: 'isPendingApprover'},
        //             false
        //         ]},
        //         {$Eq: [
        //             {$Path: 'IsActiveEntity'},
        //             false
        //         ]}
        //     ]}}
        // },
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
            1
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
            ![@UI.Hidden]: {$edmJson: {$Ne: [
                {$Path: 'requestType_code'},
                'S'
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
            ID           : 'TransferInOutItems',
            Label        : '{i18n>TransferInOutDetails}',
            Target       : 'RequestItems/@UI.PresentationVariant#TransferInOutItems',
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
        // {
        //     $Type        : 'UI.ReferenceFacet',
        //     ID           : 'TransferOutItems',
        //     Label        : '{i18n>TransferOutDetails}',
        //     Target       : 'RequestItems/@UI.PresentationVariant#TransferOutItems',
        //     ![@UI.Hidden]: {$edmJson: {$Or: [
        //         {$Ne: [
        //             {$Path: 'requestType_code'},
        //             'T'
        //         ]},
        //         {$Ne: [
        //             {$Path: 'status_code'},
        //             2
        //         ]},
        //         {$Eq: [
        //             {$Path: 'transferCategory'},
        //             'J'
        //         ]},
        //         {$Eq: [
        //             {$Path: 'transferCategory'},
        //             'F'
        //         ]},
        //         {$And: [
        //             {$Eq: [
        //                 {$Path: 'transferCategory'},
        //                 null
        //             ]},
        //             {$Or: [
        //                 {$Eq: [
        //                     {$Path: 'isFunctional'},
        //                     true
        //                 ]},
        //                 {$Eq: [
        //                     {$Path: 'isJKEW'},
        //                     true
        //                 ]}
        //             ]}
        //         ]}
        //     ]}}
        // },
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
            $Type : 'UI.ReferenceFacet',
            ID    : 'RequestApprovers',
            Label : '{i18n>Approvers}',
            Target: 'RequestApprovers/@UI.PresentationVariant#Approvers'
        },
        {
            $Type        : 'UI.ReferenceFacet',
            Label        : '{i18n>History}',
            ID           : 'History',
            Target       : 'RequestHistory/@UI.PresentationVariant#History',
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
                // Shown for Supplement and Return outright, and for Transfer
                // only when the category is not driven by a JKEW/Functional
                // role (those derive the budget type themselves).
                ![@UI.Hidden]: {$edmJson: {$And: [
                    {$Ne: [
                        {$Path: 'requestType_code'},
                        'S'
                    ]},
                    {$Ne: [
                        {$Path: 'requestType_code'},
                        'R'
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
                Value        : earmarkedFundsDocNumber,
                // Shown for Virement requests that move budget out, which
                // reserve funds in S/4 at submit time. A Virement with no
                // transfer-out amount reserves nothing, so it has no document
                // to show. Unlike the posting document numbers below, this
                // exists from submission onwards, so it is not gated on an
                // approved status.
                ![@UI.Hidden]: {$edmJson: {$Or: [
                    {$Ne: [
                        {$Path: 'requestType_code'},
                        'T'
                    ]},
                    {$Le: [
                        {$Path: 'transferOutAmount'},
                        0
                    ]}
                ]}}
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

// Header amounts are recalculated server-side whenever the item collection
// changes (after-CREATE / after-UPDATE on RequestItems.drafts), so refresh
// them alongside the items themselves. Without TargetProperties the table
// refreshes but the header keeps showing stale totals.
annotate service.Requests with @Common.SideEffects #RefreshItemsAfterItemChange: {
    SourceEntities  : [RequestItems],
    TargetEntities  : [RequestItems],
    TargetProperties: [
        'supplementAmount',
        'returnAmount',
        'transferInAmount',
        'transferOutAmount'
    ]
};

// When a line item amount changes, the after-UPDATE handler on
// RequestItems.drafts recalculates the parent header amounts. Declare the
// header fields as side-effect targets so the object page refetches them
// instead of showing stale totals until Calculate is pressed.
annotate service.RequestItems with @Common.SideEffects #RecalcHeaderOnAmountChange: {
    SourceProperties: [
        supplementAmount,
        returnAmount,
        transferInAmount,
        transferOutAmount
    ],
    TargetProperties: [
        'request/supplementAmount',
        'request/returnAmount',
        'request/transferInAmount',
        'request/transferOutAmount'
    ]
};

annotate service.Requests actions {
    approveRequest @(Common.SideEffects: {
        TargetProperties: [
            'in/status_code',
            'in/supplementDocNumber',
            'in/returnDocNumber',
            'in/transferInDocNumber',
            'in/transferOutDocNumber'
        ],
        TargetEntities  : [
            RequestApprovers,
            RequestHistory
        ]
    })
};

annotate service.Requests actions {
    rejectRequest @(Common.SideEffects: {
        TargetProperties: [
            'in/status_code',
            'in/supplementDocNumber',
            'in/returnDocNumber',
            'in/transferInDocNumber',
            'in/transferOutDocNumber'
        ],
        TargetEntities  : [
            RequestApprovers,
            RequestHistory
        ]
    })
};

annotate service.Requests actions {
    resubmitRequest @(Common.SideEffects: {
        TargetProperties: [
            'in/status_code',
            'in/supplementDocNumber',
            'in/returnDocNumber',
            'in/transferInDocNumber',
            'in/transferOutDocNumber'
        ],
        TargetEntities  : [
            RequestApprovers,
            RequestHistory
        ]
    })
};

// =============================================================================
// RequestItems - Field Labels, Value Helps, Field Controls
// =============================================================================

annotate service.RequestItems with {
    srNo              @(
        title              : '{i18n>SRNo}',
        Common.FieldControl: #ReadOnly
    );
    costCentre        @(
        title                : '{i18n>CostCentre}',
        Common.FieldControl  : #Mandatory,

        /*
         * Live search help against S/4, served by the CostCenters
         * entity. Not a fixed-value list: the entity queries S/4 on
         * every keystroke, so the dropdown must stay searchable.
         */
        Common.ValueList     : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'CostCenters',
            SearchSupported: true,
            Parameters     : [
                {
                    $Type            : 'Common.ValueListParameterInOut',
                    LocalDataProperty: costCentre,
                    ValueListProperty: 'costCentre'
                },
                {
                    $Type            : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty: 'costCentreName'
                },
                {
                    $Type            : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty: 'controllingArea'
                }
            ]
        }
    );
    glAccount         @(
        title                : '{i18n>GL}',
        Common.FieldControl  : #Mandatory,

        /*
         * Live search help against S/4, served by the GLAccounts
         * entity. Searchable rather than a fixed list: the entity
         * queries S/4 on each search.
         */
        Common.ValueList     : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'GLAccounts',
            SearchSupported: true,
            Parameters     : [
                {
                    $Type            : 'Common.ValueListParameterInOut',
                    LocalDataProperty: glAccount,
                    ValueListProperty: 'glAccount'
                },
                {
                    $Type            : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty: 'glAccountName'
                },
                {
                    $Type            : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty: 'companyCode'
                }
            ]
        }
    );
    material          @(
        title                : '{i18n>Material}',
        Common.FieldControl  : #Mandatory,

        /*
         * Live search help against S/4, served by the MaterialGroups
         * entity.
         */
        Common.ValueList     : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'MaterialGroups',
            SearchSupported: true,
            Parameters     : [
                {
                    $Type            : 'Common.ValueListParameterInOut',
                    LocalDataProperty: material,
                    ValueListProperty: 'materialGroup'
                },
                {
                    $Type            : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty: 'materialGroupDescription'
                }
            ]
        }
    );
    wbs               @(
        title           : '{i18n>WBS}',

        /*
         * Live search help against S/4, served by the WBSElements
         * entity. That service filters with startswith rather than a
         * search parameter.
         */
        Common.ValueList: {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'WBSElements',
            SearchSupported: true,
            Parameters     : [
                {
                    $Type            : 'Common.ValueListParameterInOut',
                    LocalDataProperty: wbs,
                    ValueListProperty: 'wbsElement'
                },
                {
                    $Type            : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty: 'wbsElementInternalID'
                }
            ]
        }
    );
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
        Common.Label: '{i18n>TransferInAmount}'
    );
    transferOutAmount @(
        title       : '{i18n>TransferOutAmount}',
        Common.Label: '{i18n>TransferOutAmount}'
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
            $Type        : 'UI.DataField',
            Value        : wbs,
            // WBS elements only exist for Project budgets, so the column
            // is hidden for Non Project requests. budgetType lives on the
            // parent, hence the path across the request association.
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'request/budgetType_code'},
                'N'
            ]}}
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
            $Type        : 'UI.DataField',
            Value        : wbs,
            // WBS elements only exist for Project budgets, so the column
            // is hidden for Non Project requests. budgetType lives on the
            // parent, hence the path across the request association.
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'request/budgetType_code'},
                'N'
            ]}}
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
    UI.LineItem #TransferInOutItems              : [
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
            $Type        : 'UI.DataField',
            Value        : wbs,
            // WBS elements only exist for Project budgets, so the column
            // is hidden for Non Project requests. budgetType lives on the
            // parent, hence the path across the request association.
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'request/budgetType_code'},
                'N'
            ]}}
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
            Value: transferOutAmount
        },
        {
            $Type: 'UI.DataField',
            Value: description
        }
    ],

    UI.PresentationVariant #TransferInOutItems   : {
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : srNo,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem#TransferInOutItems']
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
            $Type        : 'UI.DataField',
            Value        : wbs,
            // WBS elements only exist for Project budgets, so the column
            // is hidden for Non Project requests. budgetType lives on the
            // parent, hence the path across the request association.
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'request/budgetType_code'},
                'N'
            ]}}
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
            $Type        : 'UI.DataField',
            Value        : wbs,
            // WBS elements only exist for Project budgets, so the column
            // is hidden for Non Project requests. budgetType lives on the
            // parent, hence the path across the request association.
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'request/budgetType_code'},
                'N'
            ]}}
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
    // UI.LineItem #TransferOutItems             : [
    //     {
    //         $Type: 'UI.DataField',
    //         Value: srNo
    //     },
    //     {
    //         $Type: 'UI.DataField',
    //         Value: costCentre
    //     },
    //     {
    //         $Type: 'UI.DataField',
    //         Value: glAccount
    //     },
    //     {
    //         $Type: 'UI.DataField',
    //         Value: material
    //     },
    //     {
    //         $Type: 'UI.DataField',
    //         Value: wbs
    //     },
    //     {
    //         $Type: 'UI.DataField',
    //         Value: assetStatus_code
    //     },
    //     {
    //         $Type: 'UI.DataField',
    //         Value: transferInAmount
    //     },
    //     {
    //         $Type: 'UI.DataField',
    //         Value: description
    //     }
    // ],

    // UI.PresentationVariant #TransferOutItems  : {
    //     SortOrder     : [{
    //         $Type     : 'Common.SortOrderType',
    //         Property  : srNo,
    //         Descending: false
    //     }],
    //     Visualizations: ['@UI.LineItem#TransferOutItems']
    // },

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
    UI.DeleteHidden,
    UI.PresentationVariant #History: {
        SortOrder     : [{
            Property  : 'createdAt',
            Descending: true
        }],
        Visualizations: ['@UI.LineItem#History']
    }
);


// =============================================================================
// Request Attachments
// =============================================================================

annotate service.Requests.RequestAttachments with @(Capabilities.SearchRestrictions: {Searchable: false});

// =============================================================================
// RequestApprovers - List Report
// =============================================================================

annotate service.RequestApprovers with @(
    UI.LineItem #Approvers         : [
        {
            $Type: 'UI.DataField',
            Value: emailAddress,
            Label: 'Email'
        },
        {
            $Type: 'UI.DataField',
            Value: level,
            Label: 'Level'
        },
        {
            $Type: 'UI.DataField',
            Value: status.descr,
            Label: '{i18n>Status}'
        },
        {
            $Type: 'UI.DataField',
            Value: actionDate,
            Label: '{i18n>Date}'
        },
        {
            $Type: 'UI.DataField',
            Value: comment,
            Label: 'Comment'
        }
    ],
    Capabilities.SearchRestrictions: {Searchable: false},
    Capabilities.UpdateRestrictions: {Updatable: false},
    UI.CreateHidden,
    UI.DeleteHidden,
    UI.PresentationVariant #Approvers: {
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : level,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem#Approvers']
    }
);

// =============================================================================
// Pending Approval Requests
//
// Backs the Pending Approvals list report. This is a separate entity from
// service.Requests, so none of the annotations above apply to it and the
// list report needs its own set. Kept deliberately lean: the list is a
// worklist, and anything more detailed belongs on the object page the row
// navigates to.
// =============================================================================

// =============================================================================
// Cost Centre Search Help
// =============================================================================
annotate service.CostCenters with {
    costCentre      @(title: '{i18n>CostCentre}');
    costCentreName  @(title: '{i18n>CostCentreName}');
    controllingArea @(title: '{i18n>ControllingArea}');
};

// =============================================================================
// GL Account Search Help
// =============================================================================
annotate service.GLAccounts with {
    glAccount         @(title: '{i18n>GL}');
    glAccountName     @(title: '{i18n>GLAccountName}');
    glAccountLongName @(title: '{i18n>GLAccountLongName}');
    companyCode       @(title: '{i18n>CompanyCode}');
    isExpenseAccount  @(title: '{i18n>IsExpenseAccount}');
};

// =============================================================================
// Material Group Search Help
// =============================================================================
annotate service.MaterialGroups with {
    materialGroup            @(title: '{i18n>Material}');
    materialGroupDescription @(title: '{i18n>MaterialGroupDescription}');
};

// =============================================================================
// WBS Element Search Help
// =============================================================================
annotate service.WBSElements with {
    wbsElement           @(title: '{i18n>WBS}');
    wbsElementInternalID @(title: '{i18n>WBSInternalID}');
    isBillingElement     @(title: '{i18n>IsBillingElement}');
};
