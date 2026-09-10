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
        },
        // Once the request is Pending Approval, only Reason (and, on
        // items, Asset Status) may still be edited - everything else
        // that was writable in Draft locks to read-only.
        Common.FieldControl             : {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'status_code'},
                2
            ]},
            1,
            3
        ]}}
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
    submissionTime       @(title: '{i18n>SubmissionTime}');
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
    isMyRequest          @(title: '{i18n>IsMyRequest}');
    earmarkedFundsIsCompleted @(title: '{i18n>EarmarkedFundsIsCompleted}');

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
                $Type                     : 'UI.DataField',
                Value                     : status.descr,
                // RequestStatusCode's numeric values already line up with
                // OData's own Criticality enum (0 Neutral/Draft, 1
                // Negative/Rejected, 2 Critical/Pending Approval, 3
                // Positive/Completed), so status_code can drive it directly.
                Criticality               : status_code,
                CriticalityRepresentation : #WithIcon
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
     * Default sort for the list reports: latest Created On first.
     * submissionDate/submissionTime were dropped from the LineItem
     * above - they duplicated createdAt (managed aspect), which
     * already captures the same moment.
     */
    UI.PresentationVariant: {
        $Type         : 'UI.PresentationVariantType',
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : createdAt,
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

    /*
     * Drives the My Requests list, via that target's
     * defaultTemplateAnnotationPath. isMyRequest is virtual, same
     * reasoning as isPendingApprover above: requests-list-scope-logic
     * rewrites this into a real requestor restriction before the query
     * reaches the database. Every status is shown - the whole point is
     * to track your own request regardless of where it stands.
     */
    UI.SelectionVariant #MyRequests: {
        $Type        : 'UI.SelectionVariantType',
        SelectOptions: [{
            $Type       : 'UI.SelectOptionType',
            PropertyName: isMyRequest,
            Ranges      : [{
                $Type : 'UI.SelectionRangeType',
                Sign  : #I,
                Option: #EQ,
                Low   : true
            }]
        }]
    },

    UI.SelectionPresentationVariant #MyRequests: {
        $Type              : 'UI.SelectionPresentationVariantType',
        SelectionVariant   : ![@UI.SelectionVariant#MyRequests],
        PresentationVariant: ![@UI.PresentationVariant]
    },

    UI.Identification : [
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'service.calculateValues',
            Label        : '{i18n>Calculate}',
            ![@UI.Hidden]: true
        },
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'service.resubmitRequest',
            Label        : '{i18n>resubmitRequest}',
            Criticality  : #Positive,
            ![@UI.Hidden]: true
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
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'service.delegateApproval',
            Label        : '{i18n>Delegate}',
            // Not in use for now - unconditionally hidden. Restore the
            // condition below (status_code/isPendingApprover/
            // IsActiveEntity) to bring the button back.
            // ![@UI.Hidden]: {$edmJson: {$Or: [
            //     {$Ne: [
            //         {$Path: 'status_code'},
            //         2
            //     ]},
            //     {$Eq: [
            //         {$Path: 'isPendingApprover'},
            //         false
            //     ]},
            //     {$Eq: [
            //         {$Path: 'IsActiveEntity'},
            //         false
            //     ]}
            // ]}}
            ![@UI.Hidden]: true
        },
        /*
         * Manual fallback for the best-effort Earmarked Funds
         * completion attempted at approval time (see
         * approve-reject-request.js) - shown only once there is
         * something to retry: a Transfer with an Earmarked Funds
         * document that S/4 still reports as not completed.
         *
         * Not in use for now - unconditionally hidden. Restore the
         * condition below (requestType_code/earmarkedFundsDocNumber/
         * earmarkedFundsIsCompleted/IsActiveEntity) to bring the
         * button back.
         */
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'service.retryEarmarkedFundsCompletion',
            Label        : '{i18n>RetryEarmarkedFundsCompletion}',
            // ![@UI.Hidden]: {$edmJson: {$Or: [
            //     {$Ne: [
            //         {$Path: 'requestType_code'},
            //         'T'
            //     ]},
            //     {$Eq: [
            //         {$Path: 'earmarkedFundsDocNumber'},
            //         null
            //     ]},
            //     {$Eq: [
            //         {$Path: 'earmarkedFundsIsCompleted'},
            //         true
            //     ]},
            //     {$Eq: [
            //         {$Path: 'IsActiveEntity'},
            //         false
            //     ]}
            // ]}}
            ![@UI.Hidden]: true
        },
    ],
    // Edit is only ever shown for Draft(0) or Pending Approval(2).
    // Rejected(1) uses the Resubmit action's own copy-to-new-request
    // flow instead (now hidden too, see resubmitRequest above), and
    // Completed(3) is already posted to S/4 - neither is meant to be
    // reopened for editing.
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

    /*
     * The workflowInstanceId field itself is rendered via a custom
     * fragment (see manifest.json controlConfiguration for this
     * FieldGroup), so it can open the SAP Build monitoring page in a
     * new tab - a plain UI.DataFieldWithUrl has no way to express
     * target="_blank". It is injected positioned Before the
     * workflowStatus DataField below, so no annotation entry for it
     * is declared here.
     */
    UI.FieldGroup #WorkflowInfo    : {
        $Type: 'UI.FieldGroupType',
        Data : [{
            $Type: 'UI.DataField',
            Value: workflowStatus,
            Label: '{i18n>Status}'
        }]
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
            ![@UI.Hidden]: {$edmJson: {$Ne: [
                {$Path: 'requestType_code'},
                'T'
            ]}}
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'WorkflowInfoHeaderFacet',
            Label        : '{i18n>Workflow}',
            Target       : '@UI.FieldGroup#WorkflowInfo',
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'workflowInstanceId'},
                null
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
        },
        {
            $Type        : 'UI.ReferenceFacet',
            Label        : '{i18n>WorkflowLog}',
            ID           : 'WorkflowLog',
            Target       : 'WorkflowLogs/@UI.LineItem',
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'workflowInstanceId'},
                null
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
                // Also referenced by EarmarkedFundsDocNumberField.fragment.xml's
                // icon (the tick shown next to the Document Number above) -
                // a genuine UI.DataField for it is needed here regardless,
                // so Fiori Elements includes it in $select (a property never
                // referenced by any annotation is silently left out,
                // confirmed with workflowError earlier in this file).
                // Shown here too, as its own icon-coded status (green tick/
                // red cross) rather than plain "Yes"/"No" text.
                $Type        : 'UI.DataField',
                Value        : earmarkedFundsIsCompleted,
                Criticality  : {$edmJson: {$If: [
                    {$Eq: [
                        {$Path: 'earmarkedFundsIsCompleted'},
                        true
                    ]},
                    3,
                    1
                ]}},
                CriticalityRepresentation: #WithIcon,
                // Hidden per request - the field/label is not shown, but
                // the DataField record itself must stay (see the comment
                // above) so earmarkedFundsIsCompleted remains in $select
                // for EarmarkedFundsDocNumberField.fragment.xml's icon.
                // Original conditional visibility kept here, commented
                // out, in case this needs to be restored later:
                // ![@UI.Hidden]: {$edmJson: {$Or: [
                //     {$Ne: [
                //         {$Path: 'requestType_code'},
                //         'T'
                //     ]},
                //     {$Le: [
                //         {$Path: 'transferOutAmount'},
                //         0
                //     ]}
                // ]}}
                ![@UI.Hidden]: true
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
                Label        : '{i18n>TransferOutInDocNumber}',
                // transferOutDocNumber and transferInDocNumber are now
                // always the same value - post-to-s4-logic.js posts one
                // combined FMBB document per Transfer (see IT_ITEM built
                // from both directions) - so only one is shown here.
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
    calculateValues @(Common.SideEffects: {
        TargetProperties: [
            'in/supplementAmount',
            'in/returnAmount',
            'in/transferInAmount',
            'in/transferOutAmount'
        ],
        // Calculate may resolve and persist a CAP-owned approver preview
        // (see apply-approver-plan.js) - refresh the Approvers facet so the
        // requestor sees it immediately, without needing to navigate away
        // and back.
        TargetEntities  : [RequestApprovers]
    })
};

// Header amounts are recalculated server-side whenever the item collection
// changes (after-CREATE / after-UPDATE on RequestItems.drafts), so refresh
// them alongside the items themselves. Without TargetProperties the table
// refreshes but the header keeps showing stale totals.
//
// The same handlers also refresh the CAP-owned approver preview (see
// utils/apply-approver-plan.js) using the new totals, so the Approvers
// facet is a target too - the requestor sees the resolved approver as
// soon as an item is added, without needing to press Calculate.
annotate service.Requests with @Common.SideEffects #RefreshItemsAfterItemChange: {
    SourceEntities  : [RequestItems],
    TargetEntities  : [RequestItems, RequestApprovers],
    TargetProperties: [
        'supplementAmount',
        'returnAmount',
        'transferInAmount',
        'transferOutAmount'
    ]
};

// When a line item amount changes, the after-UPDATE handler on
// RequestItems.drafts recalculates the parent header amounts and refreshes
// the CAP-owned approver preview. Declare the header fields and the
// Approvers facet as side-effect targets so the object page refetches them
// instead of showing stale data until Calculate is pressed.
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
    ],
    TargetEntities  : ['request/RequestApprovers']
};

// Changing Request Type or Budget Type directly on the header (e.g.
// correcting it after items already exist) re-resolves the CAP-owned
// approver preview server-side (requests-drafts-after-update-logic.js) -
// refresh the Approvers facet to match.
annotate service.Requests with @Common.SideEffects #RefreshApproversOnTypeChange: {
    SourceProperties: [
        requestType_code,
        budgetType_code
    ],
    TargetEntities  : [RequestApprovers]
};

annotate service.Requests actions {
    approveRequest @(Common.SideEffects: {
        TargetProperties: [
            'in/status_code',
            'in/supplementDocNumber',
            'in/returnDocNumber',
            'in/transferInDocNumber',
            'in/transferOutDocNumber',
            // approve-reject-request.js sets the final workflowStatus
            // (COMPLETED/RUNNING) in the very same transaction as the
            // approval itself - refetch it so the Workflow facet stops
            // showing the stale value it had before this action ran.
            'in/workflowStatus'
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
            'in/transferOutDocNumber',
            // See approveRequest above - rejectRequest sets
            // workflowStatus to REJECTED in the same transaction.
            'in/workflowStatus'
        ],
        TargetEntities  : [
            RequestApprovers,
            RequestHistory
        ]
    })
};

annotate service.Requests actions {
    delegateApproval @(Common.SideEffects: {
        TargetProperties: [
            'in/status_code'
        ],
        TargetEntities  : [
            RequestApprovers,
            RequestHistory
        ]
    })
};

annotate service.Requests actions {
    retryEarmarkedFundsCompletion @(Common.SideEffects: {
        TargetProperties: [
            'in/earmarkedFundsIsCompleted'
        ],
        TargetEntities  : [
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
        // Once the parent request is Pending Approval, only Asset
        // Status stays editable on items - this locks read-only at
        // that point (request/status_code, since status lives on the
        // parent), otherwise stays Mandatory as before.
        Common.FieldControl  : {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'request/status_code'},
                2
            ]},
            1,
            7
        ]}},

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
                    // DisplayOnly, not InOut: costCentreDescription is
                    // @readonly (Core.Computed) and server-resolved in
                    // requestitems-drafts-before-create/update-logic.js
                    // (utils/cost-centre-description-lookup.js) - this
                    // only shows the Name as an extra column in the
                    // value help dialog for context while searching.
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
    /*
     * Read-only, system-derived from the Cost Centre search help
     * (S/4) whenever costCentre is set/changed - never user-settable.
     */
    costCentreDescription @(
        title              : 'Cost Centre Description',
        Common.FieldControl: #ReadOnly
    );
    /*
     * System-derived from Department Grouping master data whenever
     * costCentre is set/changed (requestitems-drafts-before-create/
     * update-logic.js) - never user-settable. Plain scalar field, no
     * association: same reasoning as glGroup below.
     */
    department        @(
        title              : 'Department',
        Common.FieldControl: #ReadOnly
    );
    /*
     * System-derived from Region & Branch Grouping master data
     * whenever costCentre is set/changed - never user-settable. Same
     * plain-scalar-field reasoning as department above.
     */
    region            @(
        title              : 'Region',
        Common.FieldControl: #ReadOnly
    );
    branch            @(
        title              : 'Branch',
        Common.FieldControl: #ReadOnly
    );
    glAccount         @(
        title                : '{i18n>GLAccountLabel}',
        // See costCentre above: read-only once Pending Approval.
        Common.FieldControl  : {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'request/status_code'},
                2
            ]},
            1,
            7
        ]}},

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
                    // DisplayOnly, not InOut: glAccountName is
                    // @readonly (Core.Computed) and server-resolved in
                    // requestitems-drafts-before-create/update-logic.js
                    // (utils/gl-account-name-lookup.js) - this only
                    // shows the Name as an extra column in the value
                    // help dialog for context while searching.
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
    /*
     * Read-only, system-derived from the GL Account search help (S/4)
     * whenever glAccount is set/changed - never user-settable.
     */
    glAccountName     @(
        title              : 'GL Account Name',
        Common.FieldControl: #ReadOnly
    );
    /*
     * System-derived from GL Grouping master data whenever glAccount
     * is set/changed (requestitems-drafts-before-create/update-logic.js)
     * - never user-settable. Plain scalar field, no association: kept
     * deliberately simple after RequestApprovers.status showed that
     * binding a table column to an assoc/property navigation makes
     * Fiori Elements try to edit the ASSOCIATED entity on user input.
     */
    glGroup           @(
        title              : 'GL Group',
        Common.FieldControl: #ReadOnly
    );
    /*
     * System-derived from GL Grouping master data whenever glAccount
     * is set/changed - never user-settable. Drives whether Asset
     * Status is shown/editable on this item (see assetStatus below
     * and the UI.Hidden condition on each LineItem's assetStatus_code
     * DataField).
     */
    assetType         @(
        title              : 'Asset Type',
        Common.FieldControl: #ReadOnly
    );
    /*
     * System-derived from Functional Department Grouping master data
     * whenever glAccount is set/changed - never user-settable. Same
     * plain-scalar-field reasoning as glGroup above.
     */
    functionalDepartment @(
        title              : 'Functional Department',
        Common.FieldControl: #ReadOnly
    );
    /*
     * System-derived from Building Grouping master data whenever
     * costCentre is set/changed - never user-settable. Same
     * plain-scalar-field reasoning as department above.
     */
    buildingName      @(
        title              : 'Building Name',
        Common.FieldControl: #ReadOnly
    );
    material          @(
        title                : '{i18n>Material}',
        // See costCentre above: read-only once Pending Approval.
        Common.FieldControl  : {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'request/status_code'},
                2
            ]},
            1,
            7
        ]}},

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
                    // DisplayOnly, not InOut: materialGroupDescription
                    // is @readonly (Core.Computed) and server-resolved
                    // in requestitems-drafts-before-create/update-logic.js
                    // (utils/material-group-description-lookup.js) -
                    // this only shows the Description as an extra
                    // column in the value help dialog for context
                    // while searching.
                    $Type            : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty: 'materialGroupDescription'
                }
            ]
        }
    );
    /*
     * Read-only, system-derived from the Material Group search help
     * (S/4) whenever material is set/changed - never user-settable.
     */
    materialGroupDescription @(
        title              : 'Material Group Description',
        Common.FieldControl: #ReadOnly
    );
    wbs               @(
        title           : '{i18n>WBS}',
        // See costCentre above: read-only once Pending Approval.
        Common.FieldControl: {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'request/status_code'},
                2
            ]},
            1,
            3
        ]}},

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
        // Not editable once the item's GL Account resolves to a
        // Non-Asset GL Group row (see assetType above) - it doesn't
        // apply, and each LineItem below also hides the column
        // entirely for the same rows (see the DataField's UI.Hidden).
        Common.FieldControl            : {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'assetType'},
                'NON ASSET'
            ]},
            1,
            3
        ]}},
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
    // See costCentre above: all four amounts, and Description, lock
    // to read-only once Pending Approval - only Asset Status (and,
    // on the header, Reason) stay editable at that point.
    supplementAmount  @(
        title       : '{i18n>SupplementAmount}',
        Common.Label: '{i18n>Amount}',
        Common.FieldControl: {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'request/status_code'},
                2
            ]},
            1,
            3
        ]}}
    );
    returnAmount      @(
        title       : '{i18n>ReturnAmount}',
        Common.Label: '{i18n>Amount}',
        Common.FieldControl: {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'request/status_code'},
                2
            ]},
            1,
            3
        ]}}
    );
    transferInAmount  @(
        title       : '{i18n>TransferInAmount}',
        Common.Label: '{i18n>TransferInAmount}',
        Common.FieldControl: {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'request/status_code'},
                2
            ]},
            1,
            3
        ]}}
    );
    transferOutAmount @(
        title       : '{i18n>TransferOutAmount}',
        Common.Label: '{i18n>TransferOutAmount}',
        Common.FieldControl: {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'request/status_code'},
                2
            ]},
            1,
            3
        ]}}
    );
    description       @(
        title              : '{i18n>Description}',
        Common.FieldControl: {$edmJson: {$If: [
            {$Eq: [
                {$Path: 'request/status_code'},
                2
            ]},
            1,
            3
        ]}}
    );
};


// =============================================================================
// RequestItems - Object Page Tables (Three Separate Tables by Type)
// =============================================================================

annotate service.RequestItems with @(
    // =========================================================================
    // Supplement Items Table (Type S)
    // =========================================================================
    UI.LineItem #SupplementItems              : [
        // Editable fields first, then read-only/system-derived
        // display fields.
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
            Value: costCentreDescription
        },
        {
            $Type: 'UI.DataField',
            Value: glAccount
        },
        {
            $Type: 'UI.DataField',
            Value: glAccountName
        },
        {
            $Type: 'UI.DataField',
            Value: material
        },
        {
            $Type: 'UI.DataField',
            Value: materialGroupDescription
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
            $Type        : 'UI.DataField',
            Value        : assetStatus_code,
            // Hidden entirely (not just read-only) once the item's GL
            // Account resolves to a Non-Asset GL Group row - see
            // assetType above.
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'assetType'},
                'NON ASSET'
            ]}}
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
        // Editable fields first, then read-only/system-derived
        // display fields.
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
            Value: costCentreDescription
        },
        {
            $Type: 'UI.DataField',
            Value: glAccount
        },
        {
            $Type: 'UI.DataField',
            Value: glAccountName
        },
        {
            $Type: 'UI.DataField',
            Value: material
        },
        {
            $Type: 'UI.DataField',
            Value: materialGroupDescription
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
            $Type        : 'UI.DataField',
            Value        : assetStatus_code,
            // Hidden entirely (not just read-only) once the item's GL
            // Account resolves to a Non-Asset GL Group row - see
            // assetType above.
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'assetType'},
                'NON ASSET'
            ]}}
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
        // Editable fields first, then read-only/system-derived
        // display fields.
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
            Value: costCentreDescription
        },
        {
            $Type: 'UI.DataField',
            Value: glAccount
        },
        {
            $Type: 'UI.DataField',
            Value: glAccountName
        },
        {
            $Type: 'UI.DataField',
            Value: material
        },
        {
            $Type: 'UI.DataField',
            Value: materialGroupDescription
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
            $Type        : 'UI.DataField',
            Value        : assetStatus_code,
            // Hidden entirely (not just read-only) once the item's GL
            // Account resolves to a Non-Asset GL Group row - see
            // assetType above.
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'assetType'},
                'NON ASSET'
            ]}}
        },
        {
            $Type: 'UI.DataField',
            Value: transferOutAmount
        },
        {
            $Type: 'UI.DataField',
            Value: transferInAmount
        },
        {
            $Type: 'UI.DataField',
            Value: description
        },
        {
            $Type: 'UI.DataField',
            Value: isDepartment,
            Label: 'Is Department',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: department,
            Label: 'Department',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: isRegionAndBranch,
            Label: 'Is Region & Branch',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: region,
            Label: 'Region',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: branch,
            Label: 'Branch',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: glGroup,
            Label: 'GL Group',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: functionalDepartment,
            Label: 'Functional Department',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: isBuilding,
            Label: 'Is Building',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: buildingName,
            Label: 'Building Name',
            ![@UI.Importance]: #Low
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
        // Editable fields first, then read-only/system-derived
        // display fields.
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
            Value: costCentreDescription
        },
        {
            $Type: 'UI.DataField',
            Value: glAccount
        },
        {
            $Type: 'UI.DataField',
            Value: glAccountName
        },
        {
            $Type: 'UI.DataField',
            Value: material
        },
        {
            $Type: 'UI.DataField',
            Value: materialGroupDescription
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
            $Type        : 'UI.DataField',
            Value        : assetStatus_code,
            // Hidden entirely (not just read-only) once the item's GL
            // Account resolves to a Non-Asset GL Group row - see
            // assetType above.
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'assetType'},
                'NON ASSET'
            ]}}
        },
        {
            $Type: 'UI.DataField',
            Value: transferOutAmount,
            Label: '{i18n>TransferOutAmount}',
        },
        {
            $Type: 'UI.DataField',
            Value: transferInAmount,
            Label: '{i18n>TransferInAmount}',
        },
        {
            $Type: 'UI.DataField',
            Value: description
        },
        {
            $Type: 'UI.DataField',
            Value: isDepartment,
            Label: 'Is Department',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: department,
            Label: 'Department',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: isRegionAndBranch,
            Label: 'Is Region & Branch',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: region,
            Label: 'Region',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: branch,
            Label: 'Branch',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: glGroup,
            Label: 'GL Group',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: functionalDepartment,
            Label: 'Functional Department',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: isBuilding,
            Label: 'Is Building',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: buildingName,
            Label: 'Building Name',
            ![@UI.Importance]: #Low
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
        // Editable fields first, then read-only/system-derived
        // display fields.
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
            Value: costCentreDescription
        },
        {
            $Type: 'UI.DataField',
            Value: glAccount
        },
        {
            $Type: 'UI.DataField',
            Value: glAccountName
        },
        {
            $Type: 'UI.DataField',
            Value: material
        },
        {
            $Type: 'UI.DataField',
            Value: materialGroupDescription
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
            $Type        : 'UI.DataField',
            Value        : assetStatus_code,
            // Hidden entirely (not just read-only) once the item's GL
            // Account resolves to a Non-Asset GL Group row - see
            // assetType above.
            ![@UI.Hidden]: {$edmJson: {$Eq: [
                {$Path: 'assetType'},
                'NON ASSET'
            ]}}
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
            Value: transferOutAmount,
            Label: '{i18n>TransferOutAmount}',
        },
        {
            $Type: 'UI.DataField',
            Value: transferInAmount,
            Label: '{i18n>TransferInAmount}',
        },
        {
            $Type: 'UI.DataField',
            Value: description
        },
        {
            $Type: 'UI.DataField',
            Value: isDepartment,
            Label: 'Is Department',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: department,
            Label: 'Department',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: isRegionAndBranch,
            Label: 'Is Region & Branch',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: region,
            Label: 'Region',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: branch,
            Label: 'Branch',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: glGroup,
            Label: 'GL Group',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: functionalDepartment,
            Label: 'Functional Department',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: isBuilding,
            Label: 'Is Building',
            ![@UI.Importance]: #Low
        },
        {
            $Type: 'UI.DataField',
            Value: buildingName,
            Label: 'Building Name',
            ![@UI.Importance]: #Low
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

    Capabilities.SearchRestrictions           : {Searchable: false},
    // Add/Delete are only for a request that has never been
    // submitted (Draft, status_code 0). Once a request has gone
    // through submit at least once (Rejected/Pending Approval/
    // Completed) and is reopened for edit, the item SET is locked -
    // only individual field values may still change, matching the
    // Upload/Download Template buttons' visibility in manifest.json
    // (grep "status_code} === 0" there).
    Capabilities.InsertRestrictions.Insertable: {$edmJson: {$Eq: [
        {$Path: 'request/status_code'},
        0
    ]}},
    Capabilities.DeleteRestrictions.Deletable : {$edmJson: {$Eq: [
        {$Path: 'request/status_code'},
        0
    ]}}
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
// Workflow Log - read live from SAP Build Process Automation
// =============================================================================

annotate service.WorkflowLogs with @(
    UI.LineItem                    : [
        {
            $Type: 'UI.DataField',
            Value: timestamp,
            Label: '{i18n>Timestamp}'
        },
        {
            $Type: 'UI.DataField',
            Value: type,
            Label: '{i18n>Type}'
        },
        {
            $Type: 'UI.DataField',
            Value: activityName,
            Label: '{i18n>Activity}'
        },
        {
            $Type: 'UI.DataField',
            Value: message,
            Label: '{i18n>Message}'
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

// Upload/Delete are only for a request that has never been submitted
// (Draft, status_code 0) - same rule and reasoning as RequestItems'
// Insert/DeleteRestrictions above. up_ is the auto-generated
// composition-parent navigation back to Requests (no explicit
// association is declared on the reusable @cap-js/attachments
// Attachments aspect this entity extends).
annotate service.Requests.RequestAttachments with @(
    Capabilities.SearchRestrictions           : {Searchable: false},
    Capabilities.InsertRestrictions.Insertable: {$edmJson: {$Eq: [
        {$Path: 'up_/status_code'},
        0
    ]}},
    Capabilities.DeleteRestrictions.Deletable : {$edmJson: {$Eq: [
        {$Path: 'up_/status_code'},
        0
    ]}}
);

// =============================================================================
// RequestApprovers - List Report
// =============================================================================

// Approvers is entirely system-assigned (CAP-owned routing plus the
// existing SAP Build / assignApprovers path) - Status is never something
// a user picks, so render it as plain text rather than an editable-looking
// control, on top of the entity already being read-only at the protocol
// level (Capabilities.UpdateRestrictions below).
//
// The LineItem below binds Value: status_code (the local, genuinely
// read-only property), NOT status.descr - binding directly to a navigated
// property on the associated ApproverStatus entity made the generated UI
// try to PATCH ApproverStatus itself on edit (rejected with "Entity
// ApproverStatus is explicitly exposed as readonly"), since descr
// physically lives there, not on RequestApprovers. Common.Text below
// makes status_code display as its descr text automatically.
//
// ApproverStatus's built-in CodeList aspect also turns on
// @cds.odata.valuelist for every association pointing to it, which alone
// would still render status_code as a value-help-enabled input regardless
// of FieldControl - disabled here since RequestApprovers is the only
// place this codelist is used, and status there is entirely system-assigned.
annotate service.ApproverStatus with @cds.odata.valuelist: false;

annotate service.RequestApprovers with {
    status   @readonly @(
        Common.Text                    : status.descr,
        Common.Text.@UI.TextArrangement: #TextOnly,
        Common.FieldControl            : #ReadOnly
    );
    userRole @readonly @(Common.FieldControl: #ReadOnly);
};

annotate service.RequestApprovers with @(
    UI.LineItem #Approvers         : [
        {
            $Type: 'UI.DataField',
            Value: emailAddress,
            Label: 'Email'
        },
        {
            $Type: 'UI.DataField',
            Value: userRole,
            Label: '{i18n>UserRoleName}'
        },
        {
            $Type: 'UI.DataField',
            Value: level,
            Label: 'Level'
        },
        {
            $Type: 'UI.DataField',
            Value: status_code,
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

// =============================================================================
// Code Lists - User Roles
// =============================================================================

annotate service.UserRoles with {
    code  @(
        Common.Text                    : descr,
        Common.Text.@UI.TextArrangement: #TextFirst
    );
    descr @(title: '{i18n>UserRoleName}');
};

// =============================================================================
// Approver Matrix - maintain workflow approver reference data
// =============================================================================
annotate service.ApproverMatrix with {
    /*
     * The value-help/text-display setup has to live on the userRole
     * association itself, not the generated userRole_code field:
     * compiling it directly on userRole_code silently drops title,
     * Common.Text and TextArrangement in this CDS version (confirmed
     * - requestType/budgetType elsewhere in this file use the same
     * association-level pattern and compile fine; moving the exact
     * same annotations onto ApproverMatrix.userRole_code made them
     * vanish from the compiled output).
     *
     * No "title" here, though, unlike requestType/budgetType: giving
     * the association its own label is what caused it to also be
     * offered as a second, identically-labelled column in the
     * table's column settings, alongside the explicit LineItem entry
     * below (which already carries its own Label). The LineItem's
     * Label is enough - the association doesn't need one of its own.
     */
    userRole         @(
        Common.Text                    : userRole.descr,
        Common.Text.@UI.TextArrangement: #TextOnly,
        Common.ValueListWithFixedValues: true,
        Common.ValueList               : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'UserRoles',
            SearchSupported: false,
            Parameters     : [{
                $Type            : 'Common.ValueListParameterInOut',
                LocalDataProperty: userRole_code,
                ValueListProperty: 'code'
            }]
        },
        Common.FieldControl            : #Mandatory
    );

    departmentBranch @(title: '{i18n>DepartmentBranch}');

    emailAddress     @(
        title               : '{i18n>ApproverEmailAddress}',
        Common.FieldControl : #Mandatory
    );

    name             @(
        title               : '{i18n>ApproverName}',
        Common.FieldControl : #Mandatory
    );

    isActive         @(title: '{i18n>Active}');
    startDate        @(title: '{i18n>StartDate}');
    endDate          @(title: '{i18n>EndDate}');
};

annotate service.ApproverMatrix with @(
    /*
     * Standard List Report + Object Page, the same pattern already
     * used for Requests: Create navigates to a new draft's Object
     * Page, a row click navigates to that row's Object Page, and
     * editing there uses the regular Edit/Save flow. The List
     * Report's inline-edit/no-navigation route (SAPUI5 1.136's
     * inline edit feature, or InlineCreationRows for the table)
     * turned out fragile here - a blank dialog, an unusable Create
     * row, then a non-functional Save - so this reverts to the
     * pattern already proven working elsewhere in this app.
     */
    UI.LineItem: [
        {
            $Type: 'UI.DataField',
            Value: userRole.descr,
            Label: '{i18n>UserRoleName}'
        },
        {
            $Type: 'UI.DataField',
            Value: departmentBranch,
            Label: '{i18n>DepartmentBranch}'
        },
        {
            $Type: 'UI.DataField',
            Value: emailAddress,
            Label: '{i18n>ApproverEmailAddress}'
        },
        {
            $Type: 'UI.DataField',
            Value: name,
            Label: '{i18n>ApproverName}'
        },
        {
            $Type: 'UI.DataField',
            Value: isActive,
            Label: '{i18n>Active}'
        },
        {
            $Type: 'UI.DataField',
            Value: startDate,
            Label: '{i18n>StartDate}'
        },
        {
            $Type: 'UI.DataField',
            Value: endDate,
            Label: '{i18n>EndDate}'
        }
    ],

    /*
     * Default sort: User Role Name ascending.
     */
    UI.PresentationVariant: {
        $Type         : 'UI.PresentationVariantType',
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : userRole.descr,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem']
    },

    UI.HeaderInfo: {
        TypeName      : '{i18n>ApproverMatrixEntry}',
        TypeNamePlural: '{i18n>ApproverMatrixTitle}',
        Title         : {Value: name}
    },

    UI.SelectionFields: [
        userRole_code,
        emailAddress,
        isActive
    ],

    /*
     * Object Page: the main form, plus a Delegations sub-table so an
     * approver's future cover (see db/schema.cds ApproverDelegation)
     * can be scheduled directly on their own Approver Matrix row.
     */
    UI.Facets: [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'ApproverMatrixDetails',
            Label : '{i18n>ApproverMatrixEntry}',
            Target: '@UI.FieldGroup#Details'
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'Delegations',
            Label : 'Delegations',
            Target: 'Delegations/@UI.LineItem'
        }
    ],

    UI.FieldGroup #Details: {
        $Type: 'UI.FieldGroupType',
        Data : [
            /*
             * userRole_code carries no title of its own (see the
             * comment above the userRole association annotation) -
             * an explicit Label here, same technique as the LineItem
             * column, is what supplies the field's label on the form.
             */
            {$Type: 'UI.DataField', Value: userRole_code, Label: '{i18n>UserRoleName}'},
            {$Type: 'UI.DataField', Value: departmentBranch},
            {$Type: 'UI.DataField', Value: emailAddress},
            {$Type: 'UI.DataField', Value: name},
            {$Type: 'UI.DataField', Value: isActive},
            {$Type: 'UI.DataField', Value: startDate},
            {$Type: 'UI.DataField', Value: endDate}
        ]
    },

    Capabilities.InsertRestrictions.Insertable: true,
    Capabilities.UpdateRestrictions.Updatable : true,
    Capabilities.DeleteRestrictions.Deletable : true
);

// =============================================================================
// Approver Delegation - schedule an approver's cover for a date range,
// maintained as a sub-table on their own Approver Matrix row
// =============================================================================
annotate service.ApproverDelegation with {
    delegateEmail @(
        title              : 'Delegate Email',
        Common.FieldControl: #Mandatory
    );
    delegateName  @(title: 'Delegate Name');
    startDate     @(
        title              : 'Start Date',
        Common.FieldControl: #Mandatory
    );
    endDate       @(
        title              : 'End Date',
        Common.FieldControl: #Mandatory
    );
};

annotate service.ApproverDelegation with @(
    UI.LineItem: [
        {
            $Type: 'UI.DataField',
            Value: delegateEmail,
            Label: 'Delegate Email'
        },
        {
            $Type: 'UI.DataField',
            Value: delegateName,
            Label: 'Delegate Name'
        },
        {
            $Type: 'UI.DataField',
            Value: startDate,
            Label: 'Start Date'
        },
        {
            $Type: 'UI.DataField',
            Value: endDate,
            Label: 'End Date'
        }
    ],

    UI.HeaderInfo: {
        TypeName      : 'Delegation',
        TypeNamePlural: 'Delegations',
        Title         : {Value: delegateEmail}
    },

    Capabilities.InsertRestrictions.Insertable: true,
    Capabilities.UpdateRestrictions.Updatable : true,
    Capabilities.DeleteRestrictions.Deletable : true
);

// =============================================================================
// GL Grouping - maintain GL Account to GL Group mapping for Virement
// approval routing
// =============================================================================
annotate service.GLGrouping with {
    expenditureGroup     @(
        title              : 'Expenditure Group',
        Common.FieldControl: #Mandatory
    );
    glGroup              @(
        title              : 'GL Group',
        Common.FieldControl: #Mandatory
    );
    glAccount            @(
        title              : 'GL Account',
        Common.FieldControl: #Mandatory
    );
    glAccountDescription @(title: 'GL Account Description');
    assetType            @(title: 'Asset Type');
    functional           @(title: 'Functional');
};

annotate service.GLGrouping with @(
    UI.LineItem: [
        {
            $Type: 'UI.DataField',
            Value: expenditureGroup,
            Label: 'Expenditure Group'
        },
        {
            $Type: 'UI.DataField',
            Value: glGroup,
            Label: 'GL Group'
        },
        {
            $Type: 'UI.DataField',
            Value: glAccount,
            Label: 'GL Account'
        },
        {
            $Type: 'UI.DataField',
            Value: glAccountDescription,
            Label: 'GL Account Description'
        },
        {
            $Type: 'UI.DataField',
            Value: assetType,
            Label: 'Asset Type'
        },
        {
            $Type: 'UI.DataField',
            Value: functional,
            Label: 'Functional'
        }
    ],

    /*
     * Default sort: Expenditure Group, then GL Group, both ascending.
     */
    UI.PresentationVariant: {
        $Type         : 'UI.PresentationVariantType',
        SortOrder     : [
            {
                $Type     : 'Common.SortOrderType',
                Property  : expenditureGroup,
                Descending: false
            },
            {
                $Type     : 'Common.SortOrderType',
                Property  : glGroup,
                Descending: false
            }
        ],
        Visualizations: ['@UI.LineItem']
    },

    UI.HeaderInfo: {
        TypeName      : 'GL Grouping Entry',
        TypeNamePlural: 'GL Grouping',
        Title         : {Value: glAccount}
    },

    UI.SelectionFields: [
        expenditureGroup,
        glGroup,
        glAccount
    ],

    UI.Facets: [{
        $Type : 'UI.ReferenceFacet',
        ID    : 'GLGroupingDetails',
        Label : 'GL Grouping Entry',
        Target: '@UI.FieldGroup#Details'
    }],

    UI.FieldGroup #Details: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {$Type: 'UI.DataField', Value: expenditureGroup},
            {$Type: 'UI.DataField', Value: glGroup},
            {$Type: 'UI.DataField', Value: glAccount},
            {$Type: 'UI.DataField', Value: glAccountDescription},
            {$Type: 'UI.DataField', Value: assetType},
            {$Type: 'UI.DataField', Value: functional}
        ]
    },

    Capabilities.InsertRestrictions.Insertable: true,
    Capabilities.UpdateRestrictions.Updatable : true,
    Capabilities.DeleteRestrictions.Deletable : true
);

// =============================================================================
// Department Grouping - maintain Cost Centre to Department mapping for
// Virement approval routing
// =============================================================================
annotate service.DepartmentGrouping with {
    department            @(
        title              : 'Department',
        Common.FieldControl: #Mandatory
    );
    costCentre            @(
        title              : 'Cost Centre',
        Common.FieldControl: #Mandatory
    );
    costCentreDescription @(title: 'Cost Centre Description');
};

annotate service.DepartmentGrouping with @(
    UI.LineItem: [
        {
            $Type: 'UI.DataField',
            Value: department,
            Label: 'Department'
        },
        {
            $Type: 'UI.DataField',
            Value: costCentre,
            Label: 'Cost Centre'
        },
        {
            $Type: 'UI.DataField',
            Value: costCentreDescription,
            Label: 'Cost Centre Description'
        }
    ],

    /*
     * Default sort: Department ascending.
     */
    UI.PresentationVariant: {
        $Type         : 'UI.PresentationVariantType',
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : department,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem']
    },

    UI.HeaderInfo: {
        TypeName      : 'Department Grouping Entry',
        TypeNamePlural: 'Department Grouping',
        Title         : {Value: costCentre}
    },

    UI.SelectionFields: [
        department,
        costCentre
    ],

    UI.Facets: [{
        $Type : 'UI.ReferenceFacet',
        ID    : 'DepartmentGroupingDetails',
        Label : 'Department Grouping Entry',
        Target: '@UI.FieldGroup#Details'
    }],

    UI.FieldGroup #Details: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {$Type: 'UI.DataField', Value: department},
            {$Type: 'UI.DataField', Value: costCentre},
            {$Type: 'UI.DataField', Value: costCentreDescription}
        ]
    },

    Capabilities.InsertRestrictions.Insertable: true,
    Capabilities.UpdateRestrictions.Updatable : true,
    Capabilities.DeleteRestrictions.Deletable : true
);

// =============================================================================
// Functional Department Grouping - maintain functional department to GL
// Accounts / Fund Centre scope mapping for Virement approval routing
// =============================================================================
annotate service.FunctionalDepartmentGrouping with {
    functionalDepartment @(
        title              : 'Functional Department',
        Common.FieldControl: #Mandatory
    );
    itemType             @(title: 'Item Type');
    glAccounts           @(title: 'GL Accounts');
    isBuildingGrouping   @(title: 'Building Grouping');
    isDepartment         @(title: 'Department');
    isRegionAndBranch    @(title: 'Region & Branch');
    remarks              @(title: 'Remarks');
};

annotate service.FunctionalDepartmentGrouping with @(
    UI.LineItem: [
        {
            $Type: 'UI.DataField',
            Value: functionalDepartment,
            Label: 'Functional Department'
        },
        {
            $Type: 'UI.DataField',
            Value: itemType,
            Label: 'Item Type'
        },
        {
            $Type: 'UI.DataField',
            Value: glAccounts,
            Label: 'GL Accounts'
        },
        {
            $Type: 'UI.DataField',
            Value: isBuildingGrouping,
            Label: 'Building Grouping'
        },
        {
            $Type: 'UI.DataField',
            Value: isDepartment,
            Label: 'Department'
        },
        {
            $Type: 'UI.DataField',
            Value: isRegionAndBranch,
            Label: 'Region & Branch'
        },
        {
            $Type: 'UI.DataField',
            Value: remarks,
            Label: 'Remarks'
        }
    ],

    /*
     * Default sort: Functional Department ascending.
     */
    UI.PresentationVariant: {
        $Type         : 'UI.PresentationVariantType',
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : functionalDepartment,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem']
    },

    UI.HeaderInfo: {
        TypeName      : 'Functional Department Grouping Entry',
        TypeNamePlural: 'Functional Department Grouping',
        Title         : {Value: functionalDepartment}
    },

    UI.SelectionFields: [
        functionalDepartment
    ],

    UI.Facets: [{
        $Type : 'UI.ReferenceFacet',
        ID    : 'FunctionalDepartmentGroupingDetails',
        Label : 'Functional Department Grouping Entry',
        Target: '@UI.FieldGroup#Details'
    }],

    UI.FieldGroup #Details: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {$Type: 'UI.DataField', Value: functionalDepartment},
            {$Type: 'UI.DataField', Value: itemType},
            {$Type: 'UI.DataField', Value: glAccounts},
            {$Type: 'UI.DataField', Value: isBuildingGrouping},
            {$Type: 'UI.DataField', Value: isDepartment},
            {$Type: 'UI.DataField', Value: isRegionAndBranch},
            {$Type: 'UI.DataField', Value: remarks}
        ]
    },

    Capabilities.InsertRestrictions.Insertable: true,
    Capabilities.UpdateRestrictions.Updatable : true,
    Capabilities.DeleteRestrictions.Deletable : true
);

// =============================================================================
// Building Grouping - maintain Cost Centre to State (building/property
// location) mapping for Virement approval routing
// =============================================================================
annotate service.BuildingGrouping with {
    state                 @(
        title              : 'State',
        Common.FieldControl: #Mandatory
    );
    costCentre            @(
        title              : 'Cost Centre',
        Common.FieldControl: #Mandatory
    );
    costCentreDescription @(title: 'Cost Centre Description');
};

annotate service.BuildingGrouping with @(
    UI.LineItem: [
        {
            $Type: 'UI.DataField',
            Value: state,
            Label: 'State'
        },
        {
            $Type: 'UI.DataField',
            Value: costCentre,
            Label: 'Cost Centre'
        },
        {
            $Type: 'UI.DataField',
            Value: costCentreDescription,
            Label: 'Cost Centre Description'
        }
    ],

    /*
     * Default sort: State ascending.
     */
    UI.PresentationVariant: {
        $Type         : 'UI.PresentationVariantType',
        SortOrder     : [{
            $Type     : 'Common.SortOrderType',
            Property  : state,
            Descending: false
        }],
        Visualizations: ['@UI.LineItem']
    },

    UI.HeaderInfo: {
        TypeName      : 'Building Grouping Entry',
        TypeNamePlural: 'Building Grouping',
        Title         : {Value: costCentre}
    },

    UI.SelectionFields: [
        state,
        costCentre
    ],

    UI.Facets: [{
        $Type : 'UI.ReferenceFacet',
        ID    : 'BuildingGroupingDetails',
        Label : 'Building Grouping Entry',
        Target: '@UI.FieldGroup#Details'
    }],

    UI.FieldGroup #Details: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {$Type: 'UI.DataField', Value: state},
            {$Type: 'UI.DataField', Value: costCentre},
            {$Type: 'UI.DataField', Value: costCentreDescription}
        ]
    },

    Capabilities.InsertRestrictions.Insertable: true,
    Capabilities.UpdateRestrictions.Updatable : true,
    Capabilities.DeleteRestrictions.Deletable : true
);

// =============================================================================
// Region & Branch Grouping - maintain Cost Centre to Region / State /
// Branch mapping for Virement approval routing
// =============================================================================
annotate service.RegionBranchGrouping with {
    region                @(
        title              : 'Region',
        Common.FieldControl: #Mandatory
    );
    state                 @(title: 'State');
    branch                @(
        title              : 'Branch',
        Common.FieldControl: #Mandatory
    );
    costCentre            @(
        title              : 'Cost Centre',
        Common.FieldControl: #Mandatory
    );
    costCentreDescription @(title: 'Cost Centre Description');
};

annotate service.RegionBranchGrouping with @(
    UI.LineItem: [
        {
            $Type: 'UI.DataField',
            Value: region,
            Label: 'Region'
        },
        {
            $Type: 'UI.DataField',
            Value: state,
            Label: 'State'
        },
        {
            $Type: 'UI.DataField',
            Value: branch,
            Label: 'Branch'
        },
        {
            $Type: 'UI.DataField',
            Value: costCentre,
            Label: 'Cost Centre'
        },
        {
            $Type: 'UI.DataField',
            Value: costCentreDescription,
            Label: 'Cost Centre Description'
        }
    ],

    /*
     * Default sort: Region ascending, then Branch ascending.
     */
    UI.PresentationVariant: {
        $Type         : 'UI.PresentationVariantType',
        SortOrder     : [
            {
                $Type     : 'Common.SortOrderType',
                Property  : region,
                Descending: false
            },
            {
                $Type     : 'Common.SortOrderType',
                Property  : branch,
                Descending: false
            }
        ],
        Visualizations: ['@UI.LineItem']
    },

    UI.HeaderInfo: {
        TypeName      : 'Region & Branch Grouping Entry',
        TypeNamePlural: 'Region & Branch Grouping',
        Title         : {Value: costCentre}
    },

    UI.SelectionFields: [
        region,
        branch,
        costCentre
    ],

    UI.Facets: [{
        $Type : 'UI.ReferenceFacet',
        ID    : 'RegionBranchGroupingDetails',
        Label : 'Region & Branch Grouping Entry',
        Target: '@UI.FieldGroup#Details'
    }],

    UI.FieldGroup #Details: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {$Type: 'UI.DataField', Value: region},
            {$Type: 'UI.DataField', Value: state},
            {$Type: 'UI.DataField', Value: branch},
            {$Type: 'UI.DataField', Value: costCentre},
            {$Type: 'UI.DataField', Value: costCentreDescription}
        ]
    },

    Capabilities.InsertRestrictions.Insertable: true,
    Capabilities.UpdateRestrictions.Updatable : true,
    Capabilities.DeleteRestrictions.Deletable : true
);
