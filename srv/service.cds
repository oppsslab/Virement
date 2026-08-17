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
         * Users can read their own requests.
         */
        {
            grant: 'READ',
            where: 'createdBy = $user'
        },

        /*
         * Assigned approvers can read requests pending approval.
         */
        {
            grant: 'READ',
            to   : 'REQUEST_APPROVE',
            where: 'status_code = 2 and exists RequestApprovers[emailAddress = $user]'
        },

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

    @readonly
    @cds.redirection.target: false
    entity PendingApprovalCount as
        select from my.Requests {
            key count( * ) as pendingCount : Integer
        }
        where
            status.code = 2;

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
