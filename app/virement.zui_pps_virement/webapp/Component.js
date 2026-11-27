sap.ui.define(
    ["sap/fe/core/AppComponent", "sap/ui/model/json/JSONModel"],
    function (Component, JSONModel) {
        "use strict";

        return Component.extend("virement.zuippsvirement.Component", {
            metadata: {
                manifest: "json"
            },

            init: function () {
                Component.prototype.init.apply(this, arguments);

                // Which BTP subaccount this app is running under (dev
                // vs prd) - always the first label of the Work Zone/
                // launchpad hostname (e.g. "epf-ent-cf-ap11-prd" from
                // "epf-ent-cf-ap11-prd.launchpad.cfapps.ap11.hana.ondemand.com"),
                // which is also the subdomain SAP Build's own
                // monitoring site uses. Exposed as a model property
                // (read via a plain expression binding, same proven
                // mechanism WorkflowInstanceIdLink.fragment.xml already
                // used when this was a hardcoded "epf-ent-cf-ap11-dev"
                // literal) rather than a formatter, since formatter/
                // expression bindings on a custom-field-template's
                // properties have already been found to silently fail
                // to evaluate in this app (see WorkflowStatusField's
                // own icon/active formatters and their comments).
                const sSubdomain = window.location.hostname.split(".")[0];

                this.setModel(
                    new JSONModel({ subdomain: sSubdomain }),
                    "env"
                );

                // BCM-only Return Categories (Budget Zerorise / Half
                // Yearly) are hidden in ReturnCategoryField.fragment.xml
                // unless this flag is true. Defaults to false (hidden) until
                // UserDetails answers.
                const oUserRoles = new JSONModel({ isBCM: false, isAdmin: false });

                this.setModel(oUserRoles, "userRoles");

                const oMainModel = this.getModel();

                oMainModel
                    .getMetaModel()
                    .requestObject("/")
                    .then(function () {
                        return oMainModel
                            .bindList("/UserDetails", null, null, null, {
                                $select: "isBCM,isAdmin"
                            })
                            .requestContexts(0, 1);
                    })
                    .then(function (aContexts) {
                        oUserRoles.setProperty(
                            "/isAdmin",
                            Boolean(
                                aContexts.length &&
                                    aContexts[0].getProperty("isAdmin")
                            )
                        );
                        oUserRoles.setProperty(
                            "/isBCM",
                            Boolean(
                                aContexts.length &&
                                    aContexts[0].getProperty("isBCM")
                            )
                        );
                    })
                    .catch(function (oError) {
                        console.error("Failed to load BCM role flag:", oError);
                    });
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