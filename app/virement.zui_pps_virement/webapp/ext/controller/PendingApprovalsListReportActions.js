sap.ui.define(
  [
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/TextArea",
    "sap/ui/core/BusyIndicator",
  ],
  function (
    MessageBox,
    MessageToast,
    Dialog,
    Button,
    Label,
    TextArea,
    BusyIndicator,
  ) {
    "use strict";

    const ACTION_APPROVE = "ZSVC_PPS_VIREMENT.approveRequest";
    const ACTION_REJECT = "ZSVC_PPS_VIREMENT.rejectRequest";

    function extractErrorMessage(oError) {
      let sMsg = "An unexpected error occurred.";

      if (oError && oError.message) {
        sMsg = oError.message;
      }

      if (oError && oError.responseText) {
        try {
          const oParsed = JSON.parse(oError.responseText);

          if (oParsed && oParsed.error && oParsed.error.message) {
            sMsg =
              typeof oParsed.error.message === "string"
                ? oParsed.error.message
                : oParsed.error.message.value;
          }
        } catch (e) {}
      }

      return sMsg;
    }

    function labelOf(oContext) {
      const oData = oContext.getObject() || {};

      return oData.requestNumber || oContext.getPath();
    }

    function executeBoundAction(sAction, oContext, mParameters) {
      const oOperation = oContext.getModel().bindContext(`${sAction}(...)`, oContext);

      if (mParameters) {
        Object.keys(mParameters).forEach(function (sKey) {
          oOperation.setParameter(sKey, mParameters[sKey]);
        });
      }

      return oOperation.execute();
    }

    /*
     * Run sequentially, not Promise.all - approveRequest can trigger a
     * real S/4 posting per request (see post-to-s4-logic.js), and
     * firing many of those at once risks overloading the CPI/S4
     * connection. One request's failure must not stop the rest, so
     * every outcome (success or error) is captured rather than thrown.
     */
    function runMassAction(sAction, aSelectedContexts, mParameters) {
      const aResults = [];

      return aSelectedContexts
        .reduce(function (pChain, oContext) {
          const sLabel = labelOf(oContext);

          return pChain
            .then(function () {
              return executeBoundAction(sAction, oContext, mParameters);
            })
            .then(function () {
              aResults.push({ label: sLabel, ok: true });
            })
            .catch(function (oError) {
              aResults.push({
                label: sLabel,
                ok: false,
                message: extractErrorMessage(oError),
              });
            });
        }, Promise.resolve())
        .then(function () {
          return aResults;
        });
    }

    function showSummary(aResults, sVerb) {
      const aFailed = aResults.filter(function (oResult) {
        return !oResult.ok;
      });

      if (!aFailed.length) {
        MessageToast.show(`${aResults.length} request(s) ${sVerb}.`);

        return;
      }

      const sDetails = aFailed
        .map(function (oResult) {
          return `${oResult.label}: ${oResult.message}`;
        })
        .join("\n");

      MessageBox.warning(
        `${aResults.length - aFailed.length} of ${aResults.length} request(s) ${sVerb}. ${aFailed.length} failed:\n${sDetails}`,
        { title: "Mass Action Result" },
      );
    }

    function refreshList(aSelectedContexts) {
      const oModel = aSelectedContexts[0] && aSelectedContexts[0].getModel();

      if (oModel && oModel.refresh) {
        oModel.refresh();
      }
    }

    function openRejectDialog(aSelectedContexts) {
      const oTextArea = new TextArea({
        width: "100%",
        rows: 4,
        placeholder: "Reason for rejection - applied to every selected request",
      });

      const oDialog = new Dialog({
        title: "Reject Selected Requests",
        contentWidth: "28rem",
        content: [
          new Label({
            text: `Reject ${aSelectedContexts.length} selected request(s). This cannot be undone.`,
            wrapping: true,
          }).addStyleClass("sapUiSmallMarginBottom sapUiSmallMarginBegin"),
          oTextArea,
        ],
        beginButton: new Button({
          text: "Reject",
          type: "Reject",
          press: function () {
            const sComment = oTextArea.getValue().trim();

            if (!sComment) {
              MessageToast.show("Please enter a reason for rejection.");

              return;
            }

            oDialog.setBusy(true);

            runMassAction(ACTION_REJECT, aSelectedContexts, {
              comment: sComment,
            }).then(function (aResults) {
              oDialog.setBusy(false);
              oDialog.close();

              refreshList(aSelectedContexts);
              showSummary(aResults, "rejected");
            });
          },
        }),
        endButton: new Button({
          text: "Cancel",
          press: function () {
            oDialog.close();
          },
        }),
        afterClose: function () {
          oDialog.destroy();
        },
      });

      oDialog.open();
    }

    return {
      /**
       * Table toolbar action for Pending Approvals (requiresSelection,
       * see manifest.json) - approves every selected request. Runs the
       * same bound approveRequest action the Object Page's single
       * Approve button uses, once per selection.
       *
       * @param {sap.ui.model.odata.v4.Context} oContext
       * @param {sap.ui.model.odata.v4.Context[]} aSelectedContexts
       * @returns {void}
       */
      onMassApprove: function (oContext, aSelectedContexts) {
        if (!aSelectedContexts || !aSelectedContexts.length) {
          MessageToast.show("Select at least one request first.");

          return;
        }

        MessageBox.confirm(
          `Approve ${aSelectedContexts.length} selected request(s)? This posts to S/4 where applicable and cannot be undone.`,
          {
            title: "Approve Selected",
            onClose: function (sAction) {
              if (sAction !== MessageBox.Action.OK) {
                return;
              }

              BusyIndicator.show(0);

              runMassAction(ACTION_APPROVE, aSelectedContexts)
                .then(function (aResults) {
                  BusyIndicator.hide();

                  refreshList(aSelectedContexts);
                  showSummary(aResults, "approved");
                })
                .catch(function (oError) {
                  BusyIndicator.hide();

                  console.error("Mass approve error:", oError);
                  MessageBox.error(extractErrorMessage(oError));
                });
            },
          },
        );
      },

      /**
       * Table toolbar action for Pending Approvals (requiresSelection,
       * see manifest.json) - rejects every selected request with one
       * shared reason, collected via a single dialog.
       *
       * @param {sap.ui.model.odata.v4.Context} oContext
       * @param {sap.ui.model.odata.v4.Context[]} aSelectedContexts
       * @returns {void}
       */
      onMassReject: function (oContext, aSelectedContexts) {
        if (!aSelectedContexts || !aSelectedContexts.length) {
          MessageToast.show("Select at least one request first.");

          return;
        }

        openRejectDialog(aSelectedContexts);
      },
    };
  },
);
