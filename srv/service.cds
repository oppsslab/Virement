using {ZDB_PPS_VIREMENT as my} from '../db/schema.cds';

using {Attachments} from '@cap-js/sdm';

extend my.Requests {
    RequestAttachments : Composition of many Attachments
                         @Validation.MaxItems: 5;
}

@path: '/service/ZSVC_PPS_VIREMENT'
service ZSVC_PPS_VIREMENT {
    @odata.draft.enabled
    entity Requests       as
        projection on my.Requests {
            *,
            virtual hideApprovalBtn : Boolean
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
        };

    entity RequestItems   as projection on my.RequestItems;

    @readonly
    entity RequestHistory as projection on my.RequestHistory;

    type TemplateFile {
        fileName : String;
        content  : LargeString;
        mimeType : String;
    }

    function downloadItemsTemplate() returns TemplateFile;

    action   postToS4(requestId: UUID, // ID of the Request to post
                      testMode: String // optional: 'X' = simulate, '' = actual post
    )                                returns {
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
}
