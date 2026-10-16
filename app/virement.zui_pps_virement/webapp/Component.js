sap.ui.define(
    ["sap/fe/core/AppComponent"],
    function (Component) {
        "use strict";

        return Component.extend("virement.zuippsvirement.Component", {
            metadata: {
                manifest: "json"
            },

            // The custom root view (ext/view/Main.view.xml) wraps
            // everything in a sap.tnt.ToolPage for the Virement
            // Portal's own nav bar, with the actual Fiori Elements
            // pages nested inside a plain sap.m.App (id "appContent").
            // sap.fe calls getRootContainer().getCurrentPage() after
            // every action to find where to show the result message -
            // left at its default, that resolves to the ToolPage,
            // which has no getCurrentPage, and the call throws
            // (silently, since it's inside a promise chain), so no
            // message is ever shown for ANY action that returns one.
            // sap.m.App extends NavContainer and does have
            // getCurrentPage, so point there instead.
            getRootContainer: function () {
                return this.getRootControl().byId("appContent");
            }
        });
    }
);