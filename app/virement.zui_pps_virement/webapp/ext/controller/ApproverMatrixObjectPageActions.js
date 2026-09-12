sap.ui.define(
  [
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/Input",
    "sap/ui/core/routing/HashChanger",
  ],
  function (
    MessageBox,
    MessageToast,
    Dialog,
    Button,
    Label,
    Input,
    HashChanger,
  ) {
    "use strict";

    const ACTION_DELEGATE = "ZSVC_PPS_VIREMENT.delegatePendingApproval";

    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

      return oData.request?.requestNumber || oData.emailAddress || oContext.getPath();
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
     * Run sequentially, not Promise.all - matches the same rationale as
     * PendingApprovalsListReportActions' runMassAction: one request's
     * failure must not stop the rest, and every outcome (success or
     * error) is captured rather than thrown.
     */
    function runDelegateAction(aSelectedContexts, sDelegateEmail) {
      const aResults = [];

      return aSelectedContexts
        .reduce(function (pChain, oContext) {
          const sLabel = labelOf(oContext);

          return pChain
            .then(function () {
              return executeBoundAction(ACTION_DELEGATE, oContext, {
                delegateEmail: sDelegateEmail,
              });
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

    function showSummary(aResults) {
      const aFailed = aResults.filter(function (oResult) {
        return !oResult.ok;
      });

      if (!aFailed.length) {
        MessageToast.show(`${aResults.length} pending approval(s) delegated.`);

        return;
      }

      const sDetails = aFailed
        .map(function (oResult) {
          return `${oResult.label}: ${oResult.message}`;
        })
        .join("\n");

      MessageBox.warning(
        `${aResults.length - aFailed.length} of ${aResults.length} delegated. ${aFailed.length} failed:\n${sDetails}`,
        { title: "Delegate Result" },
      );
    }

    function refreshList(aSelectedContexts) {
      const oModel = aSelectedContexts[0] && aSelectedContexts[0].getModel();

      if (oModel && oModel.refresh) {
        oModel.refresh();
      }
    }

    function openDelegateDialog(aSelectedContexts) {
      const oInput = new Input({
        width: "100%",
        placeholder: "delegatee@example.com",
        type: "Text",
      });

      const oDialog = new Dialog({
        title: "Delegate Selected Pending Approvals",
        contentWidth: "28rem",
        content: [
          new Label({
            text: `Delegate ${aSelectedContexts.length} selected pending approval(s) to:`,
            wrapping: true,
          }).addStyleClass("sapUiSmallMarginBottom sapUiSmallMarginBegin"),
          oInput,
        ],
        beginButton: new Button({
          text: "Delegate",
          type: "Emphasized",
          press: function () {
            const sEmail = oInput.getValue().trim();

            if (!sEmail || !EMAIL_PATTERN.test(sEmail)) {
              MessageToast.show("Please enter a valid email address.");

              return;
            }

            oDialog.setBusy(true);

            runDelegateAction(aSelectedContexts, sEmail).then(function (
              aResults,
            ) {
              oDialog.setBusy(false);
              oDialog.close();

              refreshList(aSelectedContexts);
              showSummary(aResults);
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
       * Table toolbar action on the Approver Matrix Object Page's
       * Pending Approvals facet (requiresSelection, see manifest.json)
       * - lets an admin bulk-reassign the selected pending approval
       * assignments to someone else, without being the current pending
       * approver themselves. Calls the bound delegatePendingApproval
       * action (delegate-pending-approval-logic.js) once per selected
       * row, same sequential-with-per-item-error-capture pattern as
       * PendingApprovalsListReportActions' mass approve/reject.
       *
       * @param {sap.ui.model.odata.v4.Context} oContext
       * @param {sap.ui.model.odata.v4.Context[]} aSelectedContexts
       * @returns {void}
       */
      onDelegateSelected: function (oContext, aSelectedContexts) {
        if (!aSelectedContexts || !aSelectedContexts.length) {
          MessageToast.show("Select at least one pending approval first.");

          return;
        }

        openDelegateDialog(aSelectedContexts);
      },

      /**
       * Table toolbar action on the Approver Matrix Object Page's
       * Pending Approvals facet (requiresSelection, see manifest.json)
       * - opens the selected row's Request on its own Object Page.
       *
       * Replaces an earlier attempt at making Request Number itself a
       * clickable UI.DataFieldWithNavigationPath link, which crashed
       * ("Cannot read properties of undefined (reading 'request')")
       * for any row not already cached from an earlier successful
       * open - apparently unreliable for a navigation nested this
       * deep (Object Page -> facet -> row -> association -> another
       * Object Page). Navigates directly off request_ID, a plain
       * local scalar column on this row, via HashChanger rather than
       * UIComponent.getRouterFor - the latter needs a Control
       * instance to resolve the owning component, which a bare
       * Context (what a table toolbar action receives) is not.
       *
       * request_ID is fetched via context.requestProperty(), NOT read
       * synchronously off getObject() - a first attempt added it as a
       * hidden UI.DataField to force it into the table's $select, but
       * Fiori Elements excludes genuinely UI.Hidden fields from
       * $select regardless (the exact same gotcha
       * onWorkflowStatusPress above already works around for
       * workflowError - "marking it Hidden in a FieldGroup to force
       * inclusion does not work"), so it was silently missing from
       * every row's data. requestProperty() explicitly fetches it on
       * demand instead, regardless of what the table originally
       * selected.
       *
       * @param {sap.ui.model.odata.v4.Context} oContext
       * @param {sap.ui.model.odata.v4.Context[]} aSelectedContexts
       * @returns {Promise<void>}
       */
      onOpenRequest: function (oContext, aSelectedContexts) {
        if (!aSelectedContexts || aSelectedContexts.length !== 1) {
          MessageToast.show("Select exactly one pending approval first.");

          return Promise.resolve();
        }

        return aSelectedContexts[0]
          .requestProperty("request_ID")
          .then(function (sRequestId) {
            if (!sRequestId) {
              MessageToast.show("Could not determine which request to open.");

              return;
            }

            HashChanger.getInstance().setHash(
              `/Requests(ID=${sRequestId},IsActiveEntity=true)`,
            );
          })
          .catch(function (oError) {
            console.error("Failed to resolve request_ID:", oError);

            MessageToast.show("Could not determine which request to open.");
          });
      },
    };
  },
);
