sap.ui.define(
  ["sap/fe/core/rootView/NavContainer.controller"],
  function (PageController) {
    "use strict";

    return PageController.extend("virement.zuippsvirement.ext.view.Main", {
      /**
       * Called when the controller is instantiated.
       *
       * Initializes the Fiori Elements root view controller, sets the initial app
       * title, and attaches a route matched handler so the ToolPage side navigation
       * and title stay synchronized with router-driven navigation.
       *
       * @returns {void}
       */
      onInit: function () {
        PageController.prototype.onInit.apply(this, arguments);

        this._initializePageTitle();

        const oRouter = this.getOwnerComponent().getRouter();

        oRouter.attachRouteMatched(this._onRouteMatched, this);
      },

      /**
       * Initializes the page title.
       *
       * If MenuModel>/pageTitle is empty, the app title from the i18n bundle is used.
       * This keeps Home using the normal application title.
       *
       * @returns {void}
       */
      _initializePageTitle: function () {
        const oMenuModel = this.getModel("MenuModel");

        if (!oMenuModel) {
          return;
        }

        const sCurrentTitle = oMenuModel.getProperty("/pageTitle");

        if (!sCurrentTitle) {
          oMenuModel.setProperty("/pageTitle", this._getI18nText("appTitle"));
        }
      },

      /**
       * Handles route changes and updates the selected side navigation item dynamically.
       *
       * The route is matched against the menu model using each item's matchRoutes
       * array. If a matching menu item is found, the selectedKey and page title are
       * updated from the menu model.
       *
       * If no matching item is found, the current selected item and title are kept.
       * This is intentional for Object Page navigation, because the Object Page can
       * be opened from either View Requests or Create Request.
       *
       * @param {sap.ui.base.Event} oEvent The route matched event.
       * @returns {void}
       */
      _onRouteMatched: function (oEvent) {
        const sRouteName = oEvent.getParameter("name");
        const oMatchedItem = this._findMenuItemByRoute(sRouteName);

        if (!oMatchedItem) {
          return;
        }

        this._applyNavigationState(oMatchedItem);
      },

      /**
       * Handles the selection of an item from the ToolPage side navigation.
       *
       * The selected item's key is used to find the corresponding menu model entry.
       * The item's route property is then used for navigation.
       *
       * This keeps the UI selection key independent from the manifest route name.
       *
       * Example:
       * key   = "RequestsView"
       * route = "ViewRequests"
       *
       * @param {sap.ui.base.Event} oEvent The itemSelect event from the side navigation.
       * @returns {void}
       */
      onItemSelect: function (oEvent) {
        const oSelectedItem = oEvent.getParameter("item");

        if (!oSelectedItem) {
          return;
        }

        const sKey = oSelectedItem.getKey();

        if (!sKey) {
          return;
        }

        const oMenuItem = this._findMenuItemByKey(sKey);

        if (!oMenuItem) {
          return;
        }

        this._applyNavigationState(oMenuItem);

        if (!oMenuItem.route) {
          return;
        }

        this.getOwnerComponent().getRouter().navTo(oMenuItem.route);
      },

      /**
       * Applies the selected navigation item state to the MenuModel.
       *
       * This updates:
       * - MenuModel>/selectedKey
       * - MenuModel>/pageTitle
       *
       * Home keeps the original app title. Other navigation items use their own
       * translated title.
       *
       * @param {object} oMenuItem The matched menu item from MenuModel.
       * @returns {void}
       */
      _applyNavigationState: function (oMenuItem) {
        const oMenuModel = this.getModel("MenuModel");

        if (!oMenuModel || !oMenuItem) {
          return;
        }

        oMenuModel.setProperty("/selectedKey", oMenuItem.key);

        if (oMenuItem.useAppTitle) {
          oMenuModel.setProperty("/pageTitle", this._getI18nText("appTitle"));
          return;
        }

        oMenuModel.setProperty(
          "/pageTitle",
          this._getI18nText(oMenuItem.titleI18nKey),
        );
      },

      /**
       * Finds a menu item by its key.
       *
       * This searches all navigation levels recursively.
       *
       * @param {string} sKey The menu item key.
       * @returns {object|null} The matched menu item, or null if not found.
       */
      _findMenuItemByKey: function (sKey) {
        const aItems = this._getAllNavigationItems();

        return (
          aItems.find(function (oItem) {
            return oItem.key === sKey;
          }) || null
        );
      },

      /**
       * Finds a menu item by route name.
       *
       * A route matches a menu item when:
       * - the item's route equals the route name, or
       * - the item's matchRoutes array contains the route name
       *
       * @param {string} sRouteName The matched route name from the router.
       * @returns {object|null} The matched menu item, or null if not found.
       */
      _findMenuItemByRoute: function (sRouteName) {
        const aItems = this._getAllNavigationItems();

        return (
          aItems.find(function (oItem) {
            const bRouteMatches = oItem.route === sRouteName;
            const bMatchRoutesContainsRoute =
              Array.isArray(oItem.matchRoutes) &&
              oItem.matchRoutes.indexOf(sRouteName) !== -1;

            return bRouteMatches || bMatchRoutesContainsRoute;
          }) || null
        );
      },

      /**
       * Returns all navigation items from the menu model as a flat array.
       *
       * This includes both top-level and nested navigation items.
       *
       * @returns {object[]} Flat list of menu items.
       */
      _getAllNavigationItems: function () {
        const oMenuModel = this.getModel("MenuModel");

        if (!oMenuModel) {
          return [];
        }

        const aNavigation = oMenuModel.getProperty("/navigation") || [];

        return this._flattenNavigationItems(aNavigation);
      },

      /**
       * Recursively flattens navigation items.
       *
       * @param {object[]} aItems The navigation items.
       * @returns {object[]} Flat list of navigation items.
       */
      _flattenNavigationItems: function (aItems) {
        let aFlatItems = [];

        if (!Array.isArray(aItems)) {
          return aFlatItems;
        }

        aItems.forEach(function (oItem) {
          aFlatItems.push(oItem);

          if (Array.isArray(oItem.items) && oItem.items.length) {
            aFlatItems = aFlatItems.concat(
              this._flattenNavigationItems(oItem.items),
            );
          }
        }, this);

        return aFlatItems;
      },

      /**
       * Formatter used in the XML view.
       *
       * Example:
       * text="{path: 'MenuModel>titleI18nKey', formatter: '.getBundleText'}"
       *
       * @param {string} sI18nKey The key from the i18n resource bundle.
       * @returns {string} The translated text, or the key itself if not found.
       */
      getBundleText: function (sI18nKey) {
        return this._getI18nText(sI18nKey);
      },

      /**
       * Returns a translated text from the i18n resource bundle.
       *
       * If the key or i18n model is missing, the key itself is returned as fallback.
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

        return oBundle.getText(sI18nKey);
      },

      /**
       * Expands or collapses the ToolPage side navigation.
       *
       * @returns {void}
       */
      onSideNavButtonPress: function () {
        const oToolPage = this.byId("toolPage");

        if (!oToolPage) {
          return;
        }

        oToolPage.setSideExpanded(!oToolPage.getSideExpanded());
      },
    });
  },
);
