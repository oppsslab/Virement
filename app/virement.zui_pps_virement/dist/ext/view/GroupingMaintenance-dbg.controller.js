sap.ui.define(
  ["sap/fe/core/PageController", "sap/ui/model/json/JSONModel"],
  function (PageController, JSONModel) {
    "use strict";

    return PageController.extend(
      "virement.zuippsvirement.ext.view.GroupingMaintenance",
      {
        onInit: function () {
          PageController.prototype.onInit.apply(this, arguments);

          const appId = this.getAppComponent().getManifestEntry("/sap.app/id");

          const appPath = appId.replaceAll(".", "/");
          const appModulePath = jQuery.sap.getModulePath(appPath);

          const oImageModel = new JSONModel({
            glGroupingIcon: `${appModulePath}/images/reportIcon.png`,
            departmentGroupingIcon: `${appModulePath}/images/reportIcon.png`,
            functionalDepartmentGroupingIcon: `${appModulePath}/images/reportIcon.png`,
            buildingGroupingIcon: `${appModulePath}/images/reportIcon.png`,
            regionBranchGroupingIcon: `${appModulePath}/images/reportIcon.png`,
          });

          this.getView().setModel(oImageModel, "ImageModel");
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
      },
    );
  },
);
