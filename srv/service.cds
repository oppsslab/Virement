using {ZDB_PPS_VIREMENT as my} from '../db/schema.cds';

@path: '/service/ZSVC_PPS_VIREMENT'
service ZSVC_PPS_VIREMENT {
    entity Requests as projection on my.Requests;
}
