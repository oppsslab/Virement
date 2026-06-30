sap.ui.define(["sap/fe/core/PageController"], function (PageController) {
  "use strict";

  return PageController.extend(
    "virement.zuippsvirement.ext.view.RequestsCreate",
    {
      /**
       * Called when the RequestsCreate controller is initialized.
       *
       * This controller acts as a lightweight route handler for creating
       * a new Virement Request. It does not render a custom create form.
       *
       * Instead, it waits for the "RequestsCreate" route and then starts
       * the standard Fiori Elements create flow.
       *
       * @returns {void}
       */
      onInit: function () {
        // Always call the base PageController onInit to properly initialize
        // Fiori Elements behavior and controller extension APIs.
        PageController.prototype.onInit.apply(this, arguments);

        // Attach a handler to the RequestsCreate route.
        // Whenever this route is matched, a new draft request will be created.
        this.getAppComponent()
          .getRouter()
          .getRoute("RequestsCreate")
          .attachPatternMatched(this._onCreateMatched, this);
      },

      /**
       * Handles the RequestsCreate route match.
       *
       * Creates a new draft entry under the Requests entity set and opens
       * the standard Fiori Elements Object Page in create mode.
       *
       * This intentionally does not use singleDraftForCreate because users
       * should be allowed to create multiple draft requests.
       *
       * @returns {void}
       */
      _onCreateMatched: function () {
        // Get the default OData V4 model configured in manifest.json.
        const oModel = this.getAppComponent().getModel();

        // Create a list binding for the Requests entity set.
        // This binding is required by editFlow.createDocument().
        const oListBinding = oModel.bindList("/Requests");

        // Trigger the standard Fiori Elements create flow.
        // creationMode "NewPage" opens the newly created draft in an Object Page.
        //
        // Do not add singleDraftForCreate here because the requirement is to
        // allow users to create multiple separate drafts.
        this.editFlow.createDocument(oListBinding, {
          creationMode: "NewPage",
        });
      },
    },
  );
});
