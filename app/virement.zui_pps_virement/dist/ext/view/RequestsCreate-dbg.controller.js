sap.ui.define(["sap/fe/core/PageController"], function (PageController) {
  "use strict";

  const ROUTE_CREATE_REQUEST = "RequestsCreate";
  const ROUTE_VIEW_REQUESTS = "RequestsView";

  const CREATE_FLOW_ACTIVE_FLAG = "virement.zuippsvirement.createFlowActive";

  return PageController.extend(
    "virement.zuippsvirement.ext.view.RequestsCreate",
    {
      /**
       * Called when the RequestsCreate controller is initialized.
       *
       * This controller acts only as a launcher route for the standard
       * Fiori Elements create flow.
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
       * Handles the RequestsCreate route match.
       *
       * Important:
       * The RequestsCreate route is a launcher route only.
       * It should not stay in the browser history.
       *
       * @returns {void}
       */
      _onCreateMatched: function () {
        if (this._bCreateStarted) {
          return;
        }

        this._bCreateStarted = true;

        /*
         * Mark create flow active before replacing route.
         * Main.controller uses this to keep Create Request selected.
         */
        this._markCreateFlowActive();

        /*
         * Replace RequestsCreate with RequestsView in history.
         *
         * Then createDocument opens the draft Object Page.
         * After Cancel / Discard Draft, FE should naturally return to RequestsView.
         */
        this._oRouter.navTo(
          ROUTE_VIEW_REQUESTS,
          {
            query: {
              createLauncherTs: Date.now().toString(),
            },
          },
          true,
        );

        setTimeout(
          function () {
            this._startCreateFlow();
          }.bind(this),
          300,
        );
      },

      /**
       * Starts the standard Fiori Elements create flow.
       *
       * @returns {void}
       */
      _startCreateFlow: function () {
        const oModel = this.getAppComponent().getModel();

        if (!oModel) {
          this._bCreateStarted = false;
          this._navigateToViewRequests();
          return;
        }

        const oListBinding = oModel.bindList("/Requests");

        try {
          const vCreateResult = this.editFlow.createDocument(oListBinding, {
            creationMode: "NewPage",
          });

          Promise.resolve(vCreateResult)
            .catch(
              function () {
                this._clearCreateFlowActive();
                this._navigateToViewRequests();
              }.bind(this),
            )
            .finally(
              function () {
                this._bCreateStarted = false;
              }.bind(this),
            );
        } catch (oError) {
          this._bCreateStarted = false;
          this._clearCreateFlowActive();
          this._navigateToViewRequests();
        }
      },

      /**
       * Navigates to View Requests.
       *
       * @returns {void}
       */
      _navigateToViewRequests: function () {
        this.getAppComponent()
          .getRouter()
          .navTo(
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
