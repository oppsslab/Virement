sap.ui.define(["sap/fe/core/PageController"], function (PageController) {
  "use strict";

  const ROUTE_CREATE_REQUEST = "RequestsCreate";
  const ROUTE_VIEW_REQUESTS = "VirementRequests";

  const CREATE_FLOW_ACTIVE_FLAG = "virement.zuippsvirement.createFlowActive";

  return PageController.extend(
    "virement.zuippsvirement.ext.view.RequestsCreate",
    {
      /**
       * Called when the RequestsCreate controller is initialized.
       *
       * This page acts as a launcher for the standard
       * Fiori elements create flow.
       *
       * @returns {void}
       */
      onInit: function () {
        PageController.prototype.onInit.apply(this, arguments);

        this._bCreateStarted = false;

        this._oRouter = this.getAppComponent().getRouter();

        this._oCreateRoute = this._oRouter.getRoute(ROUTE_CREATE_REQUEST);

        if (this._oCreateRoute) {
          this._oCreateRoute.attachPatternMatched(this._onCreateMatched, this);
        }
      },

      /**
       * Called when the controller is destroyed.
       *
       * @returns {void}
       */
      onExit: function () {
        if (this._oCreateRoute) {
          this._oCreateRoute.detachPatternMatched(this._onCreateMatched, this);

          this._oCreateRoute = null;
        }

        this._oRouter = null;
        this._bCreateStarted = false;
      },

      /**
       * Starts the create flow when RequestsCreate is matched.
       *
       * Do not navigate to the list page first. Let the Fiori
       * elements edit flow create the draft and navigate to the
       * configured Object Page.
       *
       * @returns {void}
       */
      _onCreateMatched: function () {
        if (this._bCreateStarted) {
          return;
        }

        this._bCreateStarted = true;
        this._markCreateFlowActive();

        this._startCreateFlow();
      },

      /**
       * Starts the standard Fiori elements create flow.
       *
       * @returns {Promise<void>}
       */
      _startCreateFlow: async function () {
        const oModel = this.getAppComponent().getModel();

        if (!oModel) {
          console.error("The default OData model is unavailable.");

          this._bCreateStarted = false;
          this._clearCreateFlowActive();
          this._navigateToViewRequests();

          return;
        }

        try {
          const oListBinding = oModel.bindList("/Requests");

          await this.editFlow.createDocument(oListBinding, {
            creationMode: "NewPage",
          });
        } catch (oError) {
          console.error("Failed to start the request create flow:", oError);

          this._clearCreateFlowActive();
          this._navigateToViewRequests();
        } finally {
          this._bCreateStarted = false;
        }
      },

      /**
       * Navigates to View Requests after create-flow startup
       * failure.
       *
       * This method is not called while Fiori elements is
       * cancelling or deleting an existing draft.
       *
       * @returns {void}
       */
      _navigateToViewRequests: function () {
        if (!this._oRouter) {
          return;
        }

        this._oRouter.navTo(
          ROUTE_VIEW_REQUESTS,
          {
            query: {
              refreshTs: Date.now().toString(),
            },
          },
          true,
        );
      },

      /**
       * Marks the create flow as active.
       *
       * @returns {void}
       */
      _markCreateFlowActive: function () {
        try {
          window.sessionStorage.setItem(CREATE_FLOW_ACTIVE_FLAG, "true");
        } catch (oError) {
          // Ignore sessionStorage errors.
        }
      },

      /**
       * Clears the create-flow active flag.
       *
       * @returns {void}
       */
      _clearCreateFlowActive: function () {
        try {
          window.sessionStorage.removeItem(CREATE_FLOW_ACTIVE_FLAG);
        } catch (oError) {
          // Ignore sessionStorage errors.
        }
      },
    },
  );
});
