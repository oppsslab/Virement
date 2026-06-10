using ZSVC_PPS_VIREMENT as service from '../../srv/service';

annotate service.Requests with {
    requestType @(
        title                          : 'Request Type',
        Common.ValueListWithFixedValues: true,
        Common.ValueList               : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'RequestType',
            SearchSupported: false,
            Parameters     : [{
                $Type            : 'Common.ValueListParameterInOut',
                LocalDataProperty: requestType_code,
                ValueListProperty: 'descr'
            }]
        }
    );
    createdBy   @(title: 'Budget Officer');
    fiscalYear  @(title: 'Fiscal Year');
    reason      @(title: 'Reason');
}

annotate service.Requests with @UI: {
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
        {Value: createdBy},
        {Value: fiscalYear},
        {Value: reason}
    ]},
};
