sap.ui.define(
  [
    "sap/m/MessageBox",
    "sap/ui/core/routing/HashChanger",
  ],
  function (MessageBox, HashChanger) {
    "use strict";

    /*
     * Fields a copied request carries over: user-entered header fields
     * and item fields. Derived fields (amounts, department/region,
     * workflow, approvers, document numbers) are recalculated by the
     * server on the new draft, and attachments must be re-uploaded.
     */
    const COPY_HEADER_FIELDS = [
      "requestType_code",
      "budgetType_code",
      "returnCategory_code",
      "supplementCategory_code",
      "transferCategory",
      "reason",
    ];

    const COPY_ITEM_FIELDS = [
      "costCentre",
      "glAccount",
      "material",
      "wbs",
      "description",
      "supplementAmount",
      "returnAmount",
      "transferInAmount",
      "transferOutAmount",
      "assetStatus_code",
    ];

    function pickDefined(oSource, aFields) {
      const oResult = {};

      aFields.forEach(function (sField) {
        if (oSource[sField] !== undefined && oSource[sField] !== null) {
          oResult[sField] = oSource[sField];
        }
      });

      return oResult;
    }

    return {
      /*
       * Creates a new Draft pre-filled from this request's header and
       * items, then opens it. The copy is a fresh request: no request
       * number, status, workflow, approvers, Earmarked Funds or
       * attachments.
       */
      onCopyRequest: async function (oArgument) {
        const oContext =
          oArgument && typeof oArgument.getSource === "function"
            ? oArgument.getSource().getBindingContext()
            : oArgument;

        const oModel = oContext.getModel();

        try {
          const oHeader = await oContext.requestObject();

          const aItemContexts = await oModel
            .bindList("RequestItems", oContext)
            .requestContexts(0, 999);

          const aItems = await Promise.all(
            aItemContexts.map(function (oItemContext) {
              return oItemContext.requestObject();
            }),
          );

          const oPayload = pickDefined(oHeader, COPY_HEADER_FIELDS);

          oPayload.RequestItems = aItems.map(function (oItem) {
            return pickDefined(oItem, COPY_ITEM_FIELDS);
          });

          const oNewContext = oModel.bindList("/Requests").create(oPayload);

          await oNewContext.created();

          HashChanger.getInstance().setHash(
            `/Requests(ID=${oNewContext.getProperty("ID")},IsActiveEntity=false)`,
          );
        } catch (oError) {
          MessageBox.error(
            (oError && oError.message) ||
              "The request could not be copied. Please try again.",
          );
        }
      },
    };
  },
);
