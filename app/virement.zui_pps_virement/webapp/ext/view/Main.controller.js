sap.ui.define(
  ["sap/fe/core/rootView/NavContainer.controller"],
  function (PageController) {
    "use strict";

    const ROUTE_HOME = "RequestsMain";
    const ROUTE_VIEW_REQUESTS = "RequestsView";
    const ROUTE_CREATE_REQUEST = "RequestsCreate";
    const ROUTE_OBJECT_PAGE = "RequestsObjectPage";

    const CREATE_FLOW_ACTIVE_FLAG = "virement.zuippsvirement.createFlowActive";

    const CREATE_OBJECT_PAGE_VISITED_FLAG =
      "virement.zuippsvirement.createObjectPageVisited";

    return PageController.extend("virement.zuippsvirement.ext.view.Main", {
      /**
       * Called when the controller is instantiated.
       *
       * @returns {void}
       */
      onInit: function () {
        PageController.prototype.onInit.apply(this, arguments);

        this._mMenuItemsByKey = null;
        this._mMenuItemsByRoute = null;
        this._iNavigationRootCount = null;
        this._sPreviousRouteName = null;
        this._bRedirectingToViewRequests = false;

        this._initializePageTitle();

        this._oRouter = this.getOwnerComponent().getRouter();
        this._oRouter.attachRouteMatched(this._onRouteMatched, this);
      },

      /**
       * Called when the controller is destroyed.
       *
       * @returns {void}
       */
      onExit: function () {
        if (this._oRouter) {
          this._oRouter.detachRouteMatched(this._onRouteMatched, this);
          this._oRouter = null;
        }

        this._mMenuItemsByKey = null;
        this._mMenuItemsByRoute = null;
        this._iNavigationRootCount = null;
        this._sPreviousRouteName = null;
        this._bRedirectingToViewRequests = false;
      },

      /**
       * Initializes the page title.
       *
       * @returns {void}
       */
      _initializePageTitle: function () {
        const oMenuModel = this.getModel("MenuModel");

        if (!oMenuModel || oMenuModel.getProperty("/pageTitle")) {
          return;
        }

        oMenuModel.setProperty("/pageTitle", this._getI18nText("appTitle"));
      },

      /**
       * Handles route changes and updates side navigation state.
       *
       * Special handling:
       * - Keeps Create Request selected while create draft Object Page is open.
       * - Forces return to View Requests after draft discard/cancel.
       *
       * @param {sap.ui.base.Event} oEvent The route matched event.
       * @returns {void}
       */
      _onRouteMatched: function (oEvent) {
        const sRouteName = oEvent.getParameter("name");
        const bCreateFlowActive = this._isCreateFlowActive();

        let oMatchedItem = this._findMenuItemByRoute(sRouteName);

        /*
         * Create Request launcher route.
         */
        if (bCreateFlowActive && sRouteName === ROUTE_CREATE_REQUEST) {
          oMatchedItem = this._findMenuItemByRoute(ROUTE_CREATE_REQUEST);
        }

        /*
         * RequestsCreate.controller replaces RequestsCreate with RequestsView
         * before opening the Object Page.
         *
         * During that temporary RequestsView match, keep Create Request selected.
         */
        if (
          bCreateFlowActive &&
          sRouteName === ROUTE_VIEW_REQUESTS &&
          this._sPreviousRouteName === ROUTE_CREATE_REQUEST
        ) {
          oMatchedItem = this._findMenuItemByRoute(ROUTE_CREATE_REQUEST);
        }

        /*
         * Object Page opened by createDocument.
         * Keep Create Request selected while user is creating the draft.
         */
        if (bCreateFlowActive && sRouteName === ROUTE_OBJECT_PAGE) {
          this._markCreateObjectPageVisited();
          oMatchedItem = this._findMenuItemByRoute(ROUTE_CREATE_REQUEST);
        }

        /*
         * Main discard/cancel fix:
         *
         * If user came from the create Object Page and FE sends the app to any
         * route other than RequestsView, force navigation back to RequestsView.
         */
        if (
          bCreateFlowActive &&
          this._wasCreateObjectPageVisited() &&
          sRouteName !== ROUTE_OBJECT_PAGE &&
          sRouteName !== ROUTE_VIEW_REQUESTS &&
          !this._bRedirectingToViewRequests
        ) {
          this._redirectToViewRequests();
          return;
        }

        /*
         * Correct return path:
         * Once View Requests is reached after create draft Object Page,
         * clear create-flow flags and select View Requests.
         */
        if (
          bCreateFlowActive &&
          this._wasCreateObjectPageVisited() &&
          sRouteName === ROUTE_VIEW_REQUESTS
        ) {
          this._clearCreateFlowActive();
          this._clearCreateObjectPageVisited();

          this._bRedirectingToViewRequests = false;
          oMatchedItem = this._findMenuItemByRoute(ROUTE_VIEW_REQUESTS);
        }

        /*
         * Safety fallback:
         * If Home is reached outside the create Object Page return flow,
         * clear create state.
         */
        if (
          bCreateFlowActive &&
          sRouteName === ROUTE_HOME &&
          !this._wasCreateObjectPageVisited()
        ) {
          this._clearCreateFlowActive();
          this._clearCreateObjectPageVisited();

          oMatchedItem = this._findMenuItemByRoute(ROUTE_HOME);
        }

        if (oMatchedItem) {
          this._applyNavigationState(oMatchedItem);
        }

        this._sPreviousRouteName = sRouteName;
      },

      /**
       * Handles side navigation item selection.
       *
       * @param {sap.ui.base.Event} oEvent The itemSelect event.
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

        if (!oMenuItem || !oMenuItem.route) {
          return;
        }

        /*
         * If user intentionally chooses Create Request,
         * reset any stale create-flow state first.
         *
         * RequestsCreate.controller will mark create flow active again.
         */
        if (oMenuItem.route === ROUTE_CREATE_REQUEST) {
          this._clearCreateFlowActive();
          this._clearCreateObjectPageVisited();
          this._bRedirectingToViewRequests = false;
        }

        /*
         * If user manually selects any non-create menu item,
         * clear create state.
         */
        if (oMenuItem.route !== ROUTE_CREATE_REQUEST) {
          this._clearCreateFlowActive();
          this._clearCreateObjectPageVisited();
          this._bRedirectingToViewRequests = false;
        }

        /*
         * Do not manually update selectedKey/pageTitle here.
         * Let routeMatched update state after successful navigation.
         */
        this.getOwnerComponent().getRouter().navTo(oMenuItem.route, {}, false);
      },

      /**
       * Redirects to View Requests and replaces current history entry.
       *
       * @returns {void}
       */
      _redirectToViewRequests: function () {
        if (this._bRedirectingToViewRequests) {
          return;
        }

        this._bRedirectingToViewRequests = true;

        setTimeout(
          function () {
            this.getOwnerComponent()
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
          }.bind(this),
          100,
        );
      },

      /**
       * Applies selected navigation state to MenuModel.
       *
       * @param {object} oMenuItem The matched menu item.
       * @returns {void}
       */
      _applyNavigationState: function (oMenuItem) {
        const oMenuModel = this.getModel("MenuModel");

        if (!oMenuModel || !oMenuItem) {
          return;
        }

        const sPageTitle = oMenuItem.useAppTitle
          ? this._getI18nText("appTitle")
          : this._getI18nText(oMenuItem.titleI18nKey);

        oMenuModel.setProperty("/selectedKey", oMenuItem.key);
        oMenuModel.setProperty("/pageTitle", sPageTitle);
      },

      /**
       * Finds a menu item by key.
       *
       * @param {string} sKey The menu item key.
       * @returns {object|null} The matched menu item.
       */
      _findMenuItemByKey: function (sKey) {
        this._ensureNavigationLookups();

        return this._mMenuItemsByKey[sKey] || null;
      },

      /**
       * Finds a menu item by route.
       *
       * @param {string} sRouteName The route name.
       * @returns {object|null} The matched menu item.
       */
      _findMenuItemByRoute: function (sRouteName) {
        this._ensureNavigationLookups();

        return this._mMenuItemsByRoute[sRouteName] || null;
      },

      /**
       * Ensures navigation lookup maps exist.
       *
       * @returns {void}
       */
      _ensureNavigationLookups: function () {
        const oMenuModel = this.getModel("MenuModel");
        const aNavigation = oMenuModel
          ? oMenuModel.getProperty("/navigation") || []
          : [];

        const bLookupMissing =
          !this._mMenuItemsByKey || !this._mMenuItemsByRoute;

        const bNavigationRootCountChanged =
          this._iNavigationRootCount !== aNavigation.length;

        if (bLookupMissing || bNavigationRootCountChanged) {
          this._buildNavigationLookups(aNavigation);
        }
      },

      /**
       * Builds key and route lookup maps.
       *
       * @param {object[]} aNavigation The navigation items.
       * @returns {void}
       */
      _buildNavigationLookups: function (aNavigation) {
        this._mMenuItemsByKey = {};
        this._mMenuItemsByRoute = {};
        this._iNavigationRootCount = Array.isArray(aNavigation)
          ? aNavigation.length
          : 0;

        this._registerNavigationItems(aNavigation);
      },

      /**
       * Recursively registers navigation items.
       *
       * @param {object[]} aItems The navigation items.
       * @returns {void}
       */
      _registerNavigationItems: function (aItems) {
        if (!Array.isArray(aItems)) {
          return;
        }

        aItems.forEach(function (oItem) {
          if (!oItem) {
            return;
          }

          if (oItem.key) {
            this._mMenuItemsByKey[oItem.key] = oItem;
          }

          if (oItem.route) {
            this._mMenuItemsByRoute[oItem.route] = oItem;
          }

          if (Array.isArray(oItem.matchRoutes)) {
            oItem.matchRoutes.forEach(function (sRouteName) {
              this._mMenuItemsByRoute[sRouteName] = oItem;
            }, this);
          }

          if (Array.isArray(oItem.items) && oItem.items.length) {
            this._registerNavigationItems(oItem.items);
          }
        }, this);
      },

      /**
       * Invalidates navigation lookup maps.
       *
       * @returns {void}
       */
      _invalidateNavigationLookups: function () {
        this._mMenuItemsByKey = null;
        this._mMenuItemsByRoute = null;
        this._iNavigationRootCount = null;
      },

      /**
       * Checks whether create flow is currently active.
       *
       * @returns {boolean} True if create flow is active.
       */
      _isCreateFlowActive: function () {
        try {
          return (
            window.sessionStorage.getItem(CREATE_FLOW_ACTIVE_FLAG) === "true"
          );
        } catch (oError) {
          return false;
        }
      },

      /**
       * Clears create-flow state.
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

      /**
       * Marks that the create Object Page was visited.
       *
       * @returns {void}
       */
      _markCreateObjectPageVisited: function () {
        try {
          window.sessionStorage.setItem(
            CREATE_OBJECT_PAGE_VISITED_FLAG,
            "true",
          );
        } catch (oError) {
          // Ignore sessionStorage errors.
        }
      },

      /**
       * Checks if create Object Page was visited.
       *
       * @returns {boolean} True if create Object Page was visited.
       */
      _wasCreateObjectPageVisited: function () {
        try {
          return (
            window.sessionStorage.getItem(CREATE_OBJECT_PAGE_VISITED_FLAG) ===
            "true"
          );
        } catch (oError) {
          return false;
        }
      },

      /**
       * Clears create Object Page visited state.
       *
       * @returns {void}
       */
      _clearCreateObjectPageVisited: function () {
        try {
          window.sessionStorage.removeItem(CREATE_OBJECT_PAGE_VISITED_FLAG);
        } catch (oError) {
          // Ignore sessionStorage errors.
        }
      },

      /**
       * Formatter used in XML view.
       *
       * @param {string} sI18nKey The i18n key.
       * @returns {string} The translated text.
       */
      getBundleText: function (sI18nKey) {
        return this._getI18nText(sI18nKey);
      },

      /**
       * Gets translated text from i18n bundle.
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

      /**
       * Expands or collapses side navigation.
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
