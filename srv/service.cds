using {ZDB_PPS_VIREMENT as my} from '../db/schema.cds';

using {Attachments} from '@cap-js/sdm';

extend my.Requests {
    RequestAttachments : Composition of many Attachments
                         @Validation.MaxItems: 5;
}

@path: '/service/ZSVC_PPS_VIREMENT'
service ZSVC_PPS_VIREMENT @(requires: 'authenticated-user') {
    @(restrict: [
        /*
         * Every authenticated user can read every request, whoever
         * raised it. This backs the View All Requests tile.
         *
         * Reading is all this grants. Editing, approving and rejecting
         * stay bound by the rules below, so seeing someone else's
         * request does not confer any right to act on it. Drafts are
         * unaffected: CAP keeps an in-progress draft visible only to
         * the user who owns it.
         */
        {grant: 'READ'},

        /*
         * Users can create requests.
         */
        {grant: 'CREATE'},

        /*
         * Users can update their own requests.
         */
        {
            grant: 'UPDATE',
            where: 'createdBy = $user'
        },

        /*
         * Assigned approvers can update requests pending approval.
         */
        {
            grant: 'UPDATE',
            to   : 'REQUEST_APPROVE',
            where: 'status_code = 2 and exists RequestApprovers[emailAddress = $user]'
        },

        /*
         * Generic request actions.
         */
        {
            grant: [
                'resubmitRequest'
            ],
            where: 'createdBy = $user and status_code = 1'
        },

        /*
         * Generic request actions.
         */
        {grant: [
            'calculateValues',
            'uploadItems',
            'downloadItemsTemplate'
        ]},

        /*
         * Only the assigned approver can approve/reject a pending approval request.
         */
        {
            grant: [
                'approveRequest',
                'rejectRequest',
                'postToS4'
            ],
            to   : 'REQUEST_APPROVE',
            where: 'status_code = 2 and exists RequestApprovers[emailAddress = $user]'
        },
    ])
    @odata.draft.enabled
    entity Requests             as
        projection on my.Requests {
            *,
            virtual isPendingApprover : Boolean default false,
            virtual isJKEW            : Boolean,
            virtual isFunctional      : Boolean
        }
        actions {
            action calculateValues()                 returns Requests;

            action resubmitRequest()                  returns Requests;

            @requires: ['REQUEST_APPROVE']
            action approveRequest()                  returns Requests;

            @requires: ['REQUEST_APPROVE']
            action rejectRequest(
                                 @title: 'Reason'
                                 comment: String)    returns Requests;

            action uploadItems(content: LargeString) returns Requests;

            action downloadItemsTemplate()           returns TemplateFile;
        };

    entity RequestItems         as projection on my.RequestItems;

    @readonly
    entity RequestHistory       as projection on my.RequestHistory;

    @readonly
    entity RequestApprovers     as projection on my.RequestApprovers;

    type TemplateFile {
        fileName : String;
        content  : LargeString;
        mimeType : String;
    }

    type S4Message {
        type      : String(1);
        id        : String(20);
        number    : String(10);
        message   : String(500);
        messageV1 : String(100);
        messageV2 : String(100);
        messageV3 : String(100);
        messageV4 : String(100);
        parameter : String(100);
        row       : String(10);
        field     : String(100);
    }

    type S4PostingResult {
        success        : Boolean;
        simulated      : Boolean;
        requestId      : UUID;
        documentNumber : String(20);
        statusCode     : Integer;
        postingDate    : Date;
        postingPeriod  : Integer;
        messages       : many S4Message;
        errors         : many S4Message;
    }

    @readonly
    @cds.persistence.skip
    entity RecentRequests {
        key ID            : UUID;
            requestNumber : String;
            requestType   : String;
            status        : String;
    }

    /*
     * Number of requests waiting for the CURRENT user's approval.
     * Filled by the ON READ handler, which matches the user against
     * the pending RequestApprovers rows.
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity PendingApprovalCount {
        key pendingCount : Integer;
    }

    /*
     * Cost centre search help, served live from S/4 through the
     * DV1-230-S4HANA destination. Not persisted: every read is a call
     * to S/4, filtered by whatever the user has typed.
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity CostCenters {
        key costCentre      : String(10);
            costCentreName  : String(100);
            controllingArea : String(4);
    }

    /*
     * GL account search help, served live from S/4 through the
     * DV1-230-S4HANA destination. Not persisted: every read is a call
     * to S/4, filtered by whatever the user has typed.
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity GLAccounts {
        key glAccount         : String(10);
            glAccountName     : String(100);
            glAccountLongName : String(200);
            companyCode       : String(4);
            isExpenseAccount  : Boolean;
    }

    /*
     * Material group search help, served live from S/4 through the
     * DV1-230-S4HANA destination.
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity MaterialGroups {
        key materialGroup            : String(20);
            materialGroupDescription : String(200);
    }

    /*
     * WBS element search help, served live from S/4 through the
     * DV1-230-S4HANA destination.
     */
    @readonly
    @cds.persistence.skip
    @cds.redirection.target: false
    entity WBSElements {
        key wbsElement           : String(24);
            wbsElementInternalID : String(20);
            isBillingElement     : Boolean;
    }

    @readonly
    entity UserDetails {
        key emailAddress : String(255);
            fullName     : String(200);
    }

    action assignApprovers(requestId: UUID,
                           level: String,
                           approvers: array of {
        Email : String;
    }) returns Boolean;
}
