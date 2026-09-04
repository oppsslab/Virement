sap.ui.define(
  [
    "sap/fe/core/PageController",
    "../../model/formatter",
    "sap/ui/model/json/JSONModel",
  ],
  function (PageController, formatter, JSONModel) {
    "use strict";

    return PageController.extend("virement.zuippsvirement.ext.view.Home", {
      formatter: formatter,

      onInit: function () {
        PageController.prototype.onInit.apply(this, arguments);

        /*
         * Initialize image model
         */
        const appId = this.getAppComponent().getManifestEntry("/sap.app/id");

        const appPath = appId.replaceAll(".", "/");
        const appModulePath = jQuery.sap.getModulePath(appPath);

        const oImageModel = new JSONModel({
          addIcon: `${appModulePath}/images/addIcon.png`,
          approvalIcon: `${appModulePath}/images/approvalIcon.png`,
          viewRequestIcon: `${appModulePath}/images/viewRequestIcon.png`,
          approverMatrixIcon: `${appModulePath}/images/reportIcon.png`,
        });

        this.getView().setModel(oImageModel, "ImageModel");

        /*
         * Initialize dashboard model
         */
        const oDashboardModel = new JSONModel({
          emailAddress: "",
          fullName: "",
          pendingCount: 0,
          isLoading: true,
        });

        this.getView().setModel(oDashboardModel, "DashboardModel");

        /*
         * Load dashboard data
         */
        this._loadDashboardData();
      },

      /**
       * Loads the authenticated user details and pending approval
       * count in parallel.
       *
       * @private
       * @returns {Promise<void>}
       */
      _loadDashboardData: async function () {
        const oDashboardModel = this.getView().getModel("DashboardModel");

        oDashboardModel.setProperty("/isLoading", true);

        try {
          const [oUserDetails, iPendingCount] = await Promise.all([
            this._getUserDetails(),
            this._getPendingApprovalCount(),
          ]);

          /*
           * Save user details in DashboardModel
           */
          if (oUserDetails) {
            oDashboardModel.setProperty(
              "/emailAddress",
              oUserDetails.emailAddress || "",
            );

            oDashboardModel.setProperty(
              "/fullName",
              oUserDetails.fullName || "",
            );
          }

          /*
           * Save pending approval count in DashboardModel
           */
          oDashboardModel.setProperty("/pendingCount", iPendingCount);
        } catch (oError) {
          console.error("Failed to load dashboard data:", oError);
          oDashboardModel.setProperty("/emailAddress", "");
          oDashboardModel.setProperty("/fullName", "");
          oDashboardModel.setProperty("/pendingCount", 0);
        } finally {
          oDashboardModel.setProperty("/isLoading", false);
        }
      },

      /**
       * Retrieves the authenticated user's details.
       *
       * @private
       * @returns {Promise<object|null>}
       */
      _getUserDetails: async function () {
        const oMainModel = this.getAppComponent().getModel();

        try {
          const oListBinding = oMainModel.bindList(
            "/UserDetails",
            null,
            null,
            null,
            {
              $select: "emailAddress,fullName",
            },
          );

          const aContexts = await oListBinding.requestContexts(0, 1);

          if (aContexts.length === 0) {
            return null;
          }

          return aContexts[0].getObject();
        } catch (oError) {
          console.error("Failed to retrieve user details:", oError);

          return null;
        }
      },

      /**
       * Retrieves the count of requests with Pending Approval status.
       *
       * @private
       * @returns {Promise<number>}
       */
      _getPendingApprovalCount: async function () {
        const oMainModel = this.getAppComponent().getModel();

        try {
          const oListBinding = oMainModel.bindList(
            "/PendingApprovalCount",
            null,
            null,
            null,
            {
              $select: "pendingCount",
            },
          );

          const aContexts = await oListBinding.requestContexts(0, 1);

          if (aContexts.length === 0) {
            return 0;
          }

          return Number(aContexts[0].getProperty("pendingCount")) || 0;
        } catch (oError) {
          console.error("Failed to retrieve pending approval count:", oError);

          return 0;
        }
      },

      /**
       * Refreshes all dashboard information.
       *
       * Can be called after approving, rejecting, or creating
       * a request.
       *
       * @returns {Promise<void>}
       */
      refreshDashboard: async function () {
        await this._loadDashboardData();
      },

      onNavigate: function (oEvent) {
        const oSource = oEvent.getSource();
        const sRouteName = oSource.data("route");

        if (!sRouteName) {
          console.error(
            "Navigation route is missing from CustomData key 'route'.",
          );
          return;
        }

        this.getAppComponent().getRouter().navTo(sRouteName, {}, false);
      },
    });
  },
);
