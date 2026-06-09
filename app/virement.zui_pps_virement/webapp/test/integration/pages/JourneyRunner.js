sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"virement/zuippsvirement/test/integration/pages/RequestsMain"
], function (JourneyRunner, RequestsMain) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('virement/zuippsvirement') + '/test/flpSandbox.html#virementzuippsvirement-tile',
        pages: {
			onTheRequestsMain: RequestsMain
        },
        async: true
    });

    return runner;
});

