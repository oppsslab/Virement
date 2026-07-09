sap.ui.define(
  ["sap/fe/core/PageController", "../../model/formatter"],
  function (PageController, formatter) {
    "use strict";

    return PageController.extend("virement.zuippsvirement.ext.view.Home", {
      formatter: formatter,

      onInit: function () {
        PageController.prototype.onInit.apply(this, arguments);
      },
    });
  },
);
