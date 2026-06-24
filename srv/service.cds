using {ZDB_PPS_VIREMENT as my} from '../db/schema.cds';
using {Attachments} from '@cap-js/sdm';

@path: '/service/ZSVC_PPS_VIREMENT'
service ZSVC_PPS_VIREMENT @(requires: 'authenticated-user') {

    // -------------------------------------------------------------------------
    // Requests (draft-enabled root entity)
    // -------------------------------------------------------------------------
    @odata.draft.enabled
    entity Requests       as
        projection on my.Requests {
            *,

            // Virtual UI-only flag — computed in a READ/after handler to control
            // visibility of Approve/Reject buttons (e.g. based on current user).
            // Not persisted in the database.
            virtual hideApprovalBtn : Boolean
        }
        actions {
            // Recalculates the request's total amount from its items.
            action calculateValues()                                returns Requests;

            @(requires: 'REQUEST_APPROVE')
            // Approves the request.
            action approveRequest()                                 returns Requests;

            @(requires: 'REQUEST_APPROVE')
            // Rejects the request (status → Rejected) with a mandatory reason.
            action rejectRequest( @title: 'Reason' comment: String) returns Requests;

            // Upload Excel items into this request's RequestItems (draft only).
            // `content` is the base64-encoded xlsx file.
            action uploadItems(content: LargeString)                returns Requests;
        };

    extend my.Requests with {
        // Attachments via SAP Document Management (SDM).
        @Validation.MaxItems: 5
        RequestAttachments : Composition of many Attachments;
    };

    // -------------------------------------------------------------------------
    // Request Items (reached via Requests composition; exposed for value help)
    // -------------------------------------------------------------------------
    entity RequestItems   as projection on my.RequestItems;

    // -------------------------------------------------------------------------
    // Request History (audit log — read-only; exposed so cds.entities resolves it
    // reliably for the insert-request-history helper)
    // -------------------------------------------------------------------------
    @readonly
    entity RequestHistory as projection on my.RequestHistory;

    // Unbound action (service level) to download the template.
    // Returns base64 xlsx content + filename.
    type TemplateFile {
        fileName : String;
        content  : LargeString; // base64
        mimeType : String;
    }

    function downloadItemsTemplate() returns TemplateFile;
}
