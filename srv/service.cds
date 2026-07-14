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
            where: 'status_code = 2 and approvedBy = $user'
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
            where: 'status_code = 2 and approvedBy = $user'
        },

        /*
         * Optional:
         * Users can delete their own requests only.
         * Remove this if delete should not be allowed.
         */
        {
            grant: 'DELETE',
            where: 'createdBy = $user'
        },

        /*
         * Generic request actions.
         * If these should be available to users who can access the request,
         * keep them without createdBy restriction.
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
                'rejectRequest'
            ],
            to   : 'REQUEST_APPROVE',
            where: 'status_code = 2 and approvedBy = $user'
        }
    ])
    @odata.draft.enabled
    entity Requests             as
        projection on my.Requests {
            *,
            virtual hideApprovalBtn : Boolean,
            virtual isJKEW          : Boolean,
            virtual isFunctional    : Boolean
        }
        actions {
            action calculateValues()                 returns Requests;

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

    type TemplateFile {
        fileName : String;
        content  : LargeString;
        mimeType : String;
    }

    action postToS4(requestId: UUID, // ID of the Request to post
                    testMode: String // optional: 'X' = simulate, '' = actual post
    ) returns {
        success  : Boolean; // true if no errors
        messages : array of {
            type    : String; // E, W, I, S, A
            id      : String;
            number  : String;
            message : String;
        };
        errors   : array of {
            type    : String;
            id      : String;
            number  : String;
            message : String;
        };
    };

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
}
