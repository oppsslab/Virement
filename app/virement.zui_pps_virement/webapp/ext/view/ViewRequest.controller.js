sap.ui.define(
    [
        'sap/fe/core/PageController'
    ],
    function(PageController) {
        'use strict';

        return PageController.extend('virement.zuippsvirement.ext.view.ViewRequest', {
            /**
             * Called when a controller is instantiated and its View controls (if available) are already created.
             * Can be used to modify the View before it is displayed, to bind event handlers and do other one-time initialization.
             * @memberOf virement.zuippsvirement.ext.view.ViewRequest
             */
            //  onInit: function () {
            //      PageController.prototype.onInit.apply(this, arguments); // needs to be called to properly initialize the page controller
            //  },

            /**
             * Similar to onAfterRendering, but this hook is invoked before the controller's View is re-rendered
             * (NOT before the first rendering! onInit() is used for that one!).
             * @memberOf virement.zuippsvirement.ext.view.ViewRequest
             */
            //  onBeforeRendering: function() {
            //
            //  },

            /**
             * Called when the View has been rendered (so its HTML is part of the document). Post-rendering manipulations of the HTML could be done here.
             * This hook is the same one that SAPUI5 controls get after being rendered.
             * @memberOf virement.zuippsvirement.ext.view.ViewRequest
             */
            //  onAfterRendering: function() {
            //
            //  },

            /**
             * Called when the Controller is destroyed. Use this one to free resources and finalize activities.
             * @memberOf virement.zuippsvirement.ext.view.ViewRequest
             */
            //  onExit: function() {
            //
            //  }

            onPressEdit: function() {
                this._oUIModel = this.getModel("ui");
                this._oUIModel.setProperty("/isEditable", true);
            },

            onPressCancel: function() {
                this._oRouter = this.getAppComponent().getRouter();
                this._oRouter.navTo("RequestsMain");
            },
        });
    }
);
