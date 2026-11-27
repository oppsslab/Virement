sap.ui.define(
  ["sap/fe/core/rootView/NavContainer.controller", "sap/ui/model/json/JSONModel"],
  function (PageController, JSONModel) {
    "use strict";

    return PageController.extend("virement.zuippsvirement.ext.view.Main", {
      /**
       * Called when the controller is instantiated.
       *
       * @returns {void}
       */
      onInit: function () {
        PageController.prototype.onInit.apply(this, arguments);

        const appId = this.getAppComponent().getManifestEntry("/sap.app/id");

        const appPath = appId.replaceAll(".", "/");
        const appModulePath = jQuery.sap.getModulePath(appPath);

        const oImageModel = new JSONModel({
            CompanyLogo: `${appModulePath}/images/EPF_night.png`,
            AppLogo: `${appModulePath}/images/IFAMSVirement_night.png`,
        });

        this.getView().setModel(oImageModel, "LogoImageModel");

        this._oRouter = this.getOwnerComponent().getRouter();

        this._oRouter.attachRouteMatched(this._onRouteChange, this);

        this._applyRoleBasedNavVisibility();
      },

      /*
       * Admin-only nav tabs (menuData.json keys) - hidden from the
       * top nav bar entirely for non-admins, not just left to the
       * backend's own ADMIN-only write restrictions, so a regular
       * user never sees an entry point into a screen they can only
       * read (or nothing at all, for Email Configuration, which has
       * no non-admin READ restriction but is still admin-only in
       * practice).
       */
      ADMIN_ONLY_NAV_KEYS: [
        "ApproverMatrix",
        "GroupingMaintenance",
        "EmailConfiguration",
        "SystemConfiguration",
      ],

      /*
       * Approver-only nav tabs - REQUEST_APPROVE is this app's base
       * "has access at all" role, shared by regular requestors and
       * approvers alike (not approval-specific despite the name), so
       * a user with none of it has no legitimate access to any of
       * these - PendingApprovals (mass Approve/Reject), MyRequests
       * and VirementRequests (the other two List Report views over
       * /Requests - see README §9) are all hidden for them, same as
       * admin-only tabs are for a non-admin. Home itself and its own
       * "Create Virement Request" access stay gated separately via
       * DashboardModel>/isApprover in Home.view.xml, since Home is
       * always reachable as the landing page.
       */
      APPROVER_ONLY_NAV_KEYS: [
        "PendingApprovals",
        "MyRequests",
      ],

      /*
       * Request Report (the all-requestors List Report) is visible to
       * Admin and BCM (role BUDGET_ZERORISE) users only.
       */
      ADMIN_OR_BCM_NAV_KEYS: ["VirementRequests"],

      /**
       * Hides the admin-only and approver-only entries in MenuModel's
       * navigation array for a user lacking the matching role, based
       * on UserDetails.isAdmin / isApprover.
       *
       * @returns {Promise<void>}
       */
      _applyRoleBasedNavVisibility: async function () {
        const oMenuModel = this.getOwnerComponent().getModel("MenuModel");

        if (!oMenuModel) {
          return;
        }

        let bIsAdmin = false;
        let bIsApprover = false;
        let bIsBCM = false;

        try {
          const oMainModel = this.getOwnerComponent().getModel();

          /*
           * This runs at app bootstrap, before the Home view even
           * loads - querying the OData model this early can fail if
           * its metadata isn't ready yet, which previously fell
           * through to the bIsAdmin = false fallback below and hid
           * the tabs regardless of the user's real role. Waiting for
           * metadataLoaded() first avoids that race.
           */
          await oMainModel.getMetaModel().requestObject("/");

          const oListBinding = oMainModel.bindList("/UserDetails", null, null, null, {
            $select: "isAdmin,isApprover,isBCM",
          });

          const aContexts = await oListBinding.requestContexts(0, 1);

          bIsAdmin = Boolean(
            aContexts.length && aContexts[0].getProperty("isAdmin"),
          );

          bIsApprover = Boolean(
            aContexts.length && aContexts[0].getProperty("isApprover"),
          );

          bIsBCM = Boolean(
            aContexts.length && aContexts[0].getProperty("isBCM"),
          );
        } catch (oError) {
          console.error(
            "Failed to determine role-based nav visibility:",
            oError,
          );
        }

        const aNavigation = oMenuModel.getProperty("/navigation") || [];

        aNavigation.forEach(function (oItem, iIndex) {
          const bHide =
            (!bIsAdmin && this.ADMIN_ONLY_NAV_KEYS.includes(oItem.key)) ||
            (!bIsApprover && this.APPROVER_ONLY_NAV_KEYS.includes(oItem.key)) ||
            (!bIsAdmin &&
              !bIsBCM &&
              this.ADMIN_OR_BCM_NAV_KEYS.includes(oItem.key));

          if (bHide) {
            oMenuModel.setProperty(
              `/navigation/${iIndex}/visible`,
              false,
            );
          }
        }, this);
      },

      /**
       * Removes the route-matched event handler when the
       * controller is destroyed.
       *
       * @returns {void}
       */
      onExit: function () {
        if (this._oRouter) {
          this._oRouter.detachRouteMatched(this._onRouteChange, this);

          this._oRouter = null;
        }
      },

      /**
       * Updates the selected menu item after route navigation.
       *
       * @param {sap.ui.base.Event} oEvent Route-matched event.
       * @returns {void}
       */
      _onRouteChange: function (oEvent) {
        const sRouteName = oEvent.getParameter("name");
        const oMenu = this.getView().byId("ithMenu");

        if (!oMenu || !sRouteName) {
          return;
        }

        oMenu.setSelectedKey(sRouteName);
      },

      /**
       * Navigates to the route assigned to the selected menu item.
       *
       * @param {sap.ui.base.Event} oEvent Item-selection event.
       * @returns {void}
       */
      onItemSelect: function (oEvent) {
        const oSelectedItem = oEvent.getParameter("item");

        if (!oSelectedItem) {
          return;
        }

        const sRouteName = oSelectedItem.getKey();

        if (!sRouteName) {
          return;
        }

        this.getOwnerComponent().getRouter().navTo(sRouteName, {}, false);
      },

      /**
       * Formatter used in the XML view.
       *
       * @param {string} sI18nKey The i18n key.
       * @returns {string} The translated text.
       */
      getBundleText: function (sI18nKey) {
        return this._getI18nText(sI18nKey);
      },

      /**
       * Retrieves translated text from the i18n bundle.
       *
       * @param {string} sI18nKey The i18n key.
       * @returns {string} The translated text.
       */
      _getI18nText: function (sI18nKey) {
        if (!sI18nKey) {
          return "";
        }

        const oResourceModel = this.getModel("i18n");

        if (!oResourceModel) {
          return sI18nKey;
        }

        const oBundle = oResourceModel.getResourceBundle();

        if (!oBundle) {
          return sI18nKey;
        }

        return oBundle.getText(sI18nKey);
      },
    });
  },
);
