using ZSVC_PPS_VIREMENT as service from '../../srv/service';
using from '../../db/schema';

annotate service.Requests with {
    requestType @(
        title                          : 'Request Type',
        Common.ValueListWithFixedValues: true,
        Common.Text                    : requestType.descr,
        Common.ValueList               : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'RequestType',
            SearchSupported: false,
            Parameters     : [
                {
                    $Type            : 'Common.ValueListParameterOut',
                    LocalDataProperty: requestType_code,
                    ValueListProperty: 'code'
                },
                {
                    $Type            : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty: 'descr'  //
                }
            ]
        }
    );
    createdBy           @(title: 'Budget Officer');
    fiscalYear          @(title: 'Fiscal Year');
    reason              @(title: 'Reason');
    requestNumber       @(title: 'Request Number');
    requestorCostCentre @(title: 'Cost Centre');
    submissionPeriod    @(title: 'Submission Period');
    totalAmount         @(title: 'Total Amount');
    postingPeriod       @(title: 'Posting Period');
    postingDate         @(title: 'Posting Date');
    aging               @(title: 'Aging');
    docNumber           @(title: 'Document Number');
    submissionPeriod    @Core.Immutable;
    requestNumber       @Core.Immutable;
    status              @Core.Immutable;
}

annotate service.RequestStatus with {
    descr @title: 'Status';
};

annotate service.Requests with @(
    UI: {
        HeaderInfo                     : {
            TypeName      : 'Request',
            TypeNamePlural: 'Requests'
        },
        LineItem #Overview             : [
            {
                $Type: 'UI.DataField',
                Value: requestNumber,
            },
            {
                $Type: 'UI.DataField',
                Value: requestType.descr,
            },
            {
                $Type: 'UI.DataField',
                Value: status.descr,
            },
            {
                $Type: 'UI.DataField',
                Value: fiscalYear,
            },
            {
                $Type: 'UI.DataField',
                Value: requestorCostCentre,
            },
            {
                $Type: 'UI.DataField',
                Value: submissionPeriod,
            },
            {
                $Type: 'UI.DataField',
                Value: totalAmount,
            },
            {
                $Type: 'UI.DataField',
                Value: reason,
            },
            {
                $Type: 'UI.DataField',
                Value: postingPeriod,
            },
            {
                $Type: 'UI.DataField',
                Value: postingDate,
            },
            {
                $Type: 'UI.DataField',
                Value: createdAt,
            },
            {
                $Type: 'UI.DataField',
                Value: createdBy,
            },
            {
                $Type: 'UI.DataField',
                Value: aging,
            },
            {
                $Type: 'UI.DataField',
                Value: approvedBy,
            },
            {
                $Type: 'UI.DataField',
                Value: docNumber,
            },
        ],
        FieldGroup #CreateRequestHeader: {Data: [
            {Value: requestNumber},
            {Value: status.descr},
            {Value: reason},
            {Value: submissionPeriod},
            {Value: createdBy},
            {Value: fiscalYear},
        ]},
    }
);

annotate service.RequestItems with @(
    UI.LineItem #tableMacro : [
        {
            $Type : 'UI.DataField',
            Value : srNo,
        },
        {
            $Type : 'UI.DataField',
            Value : costCentre,
        },
        {
            $Type : 'UI.DataField',
            Value : glAccount,
        },
        {
            $Type : 'UI.DataField',
            Value : material,
        },
        {
            $Type : 'UI.DataField',
            Value : wbs,
        },
        {
            $Type : 'UI.DataField',
            Value : assetStatus.descr,
        },
        {
            $Type : 'UI.DataField',
            Value : amount,
        },
    ]
);


annotate service.AssetStatus with {
    descr @title: 'Assest Status';
};

annotate service.RequestItems with {
    srNo                @title: 'Sr No';
    costCentre          @title: 'Cost Center';
    glAccount           @title: 'GL';
    material            @title: 'Material';
    wbs                 @title: 'WBS';
    amount              @title: 'Amount';
};

annotate service.RequestApprover with @(
    UI.LineItem #tableMacro : [
        {
            $Type : 'UI.DataField',
            Value : ID,
            Label : 'ID',
        },
    ]
);

annotate service.RequestHistory with @(
    UI.LineItem #tableMacro : [
        {
            $Type : 'UI.DataField',
            Value : date,
        },
        {
            $Type : 'UI.DataField',
            Value : time,
        },
        {
            $Type : 'UI.DataField',
            Value : changedBy,
        },
        {
            $Type : 'UI.DataField',
            Value : changedBy,
        },
        {
            $Type : 'UI.DataField',
            Value : changes,
        },
    ]
);

annotate service.RequestHistory with {
    date                @title: 'Date';
    time                @title: 'Time';
    changedBy           @title: 'Name';
    changes             @title: 'Changes';
};