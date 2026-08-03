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
