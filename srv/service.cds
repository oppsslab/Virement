using {ZDB_PPS_VIREMENT as my} from '../db/schema.cds';

@path: '/service/ZSVC_PPS_VIREMENT'
service ZSVC_PPS_VIREMENT {
    entity Requests as projection on my.Requests;
    // extend Requests with actions {
    //     action approve() returns String;
    //     action saveAsDraft() returns String;
    // };
    entity RequestItems as projection on my.RequestItems;
    @Capabilities.DeleteRestrictions: { Deletable: false }
    entity RequestApprover as projection on my.RequestApprover;
    @Capabilities.DeleteRestrictions: { Deletable: false }
    entity RequestHistory as projection on my.RequestHistory;

}
