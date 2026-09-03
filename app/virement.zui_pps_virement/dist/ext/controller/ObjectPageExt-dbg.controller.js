sap.ui.define(["sap/ui/core/mvc/ControllerExtension"], function (
  ControllerExtension,
) {
  "use strict";

  /*
   * Radio button order in ReturnCategoryField.fragment.xml, mapped to the
   * ReturnCategory code list. Keep the two in sync.
   */
  const RETURN_CATEGORY_CODES = ["Z", "C"];

  return ControllerExtension.extend(
    "virement.zuippsvirement.ext.controller.ObjectPageExt",
    {
      /**
       * Writes the picked Return Category back to the draft.
       *
       * The radio group reads returnCategory_code through a one-way
       * expression binding, so the selection has to be persisted here.
       *
       * @param {sap.ui.base.Event} oEvent select event of the radio group
       * @returns {void}
       */
      onReturnCategorySelect: function (oEvent) {
        const oGroup = oEvent.getSource();

        const iSelectedIndex = oEvent.getParameter("selectedIndex");

        const sCode = RETURN_CATEGORY_CODES[iSelectedIndex];

        if (!sCode) {
          return;
        }

        const oContext = oGroup.getBindingContext();

        if (!oContext) {
          console.error("No binding context for the Return Category field.");

          return;
        }

        /*
         * Selecting the already selected button must not trigger a PATCH.
         */
        if (oContext.getProperty("returnCategory_code") === sCode) {
          return;
        }

        oContext.setProperty("returnCategory_code", sCode).catch(function (
          oError,
        ) {
          console.error("Failed to set the Return Category:", oError);
        });
      },
    },
  );
});
