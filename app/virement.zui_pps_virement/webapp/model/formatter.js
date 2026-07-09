sap.ui.define([], function () {
  "use strict";

  return {
    statusState: function (sStatus) {
      if (!sStatus) {
        return "None";
      } else if (sStatus === "Sent to SAP") {
        return "Success";
      } else if (sStatus === "Rejected") {
        return "Error";
      } else if (sStatus.includes("Pending Approval")) {
        return "Warning";
      } else {
        return "None";
      }
    },
  };
});
