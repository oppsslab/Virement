using ZSVC_PPS_VIREMENT as service from '../../srv/service';

annotate service.Requests with @(UI.LineItem #Overview: [
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
]);
