sap.ui.define(
  ["sap/m/MessageBox", "sap/m/MessageToast", "sap/ui/core/BusyIndicator"],
  function (MessageBox, MessageToast, BusyIndicator) {
    "use strict";

    const ACTION = "ZSVC_PPS_VIREMENT.completeRejectedEarmarkedFunds";

    const REJECTED = 1;
    const VIREMENT = "T";

    function errorText(oError) {
      return (oError && oError.message) || "An unexpected error occurred.";
    }

    /**
     * Splits the selection into requests the action can work on (a
     * Rejected request with an Earmarked Funds document) and the rest.
     * The list only loads its visible columns, so both properties are
     * requested explicitly.
     */
    function classify(aContexts) {
      return Promise.all(
        aContexts.map(function (oContext) {
          return oContext
            .requestProperty([
              "requestNumber",
              "status_code",
              "earmarkedFundsDocNumber",
              "requestType_code",
            ])
            .then(function (aValues) {
              return {
                context: oContext,
                label: aValues[0] || oContext.getPath(),
                eligible:
                  aValues[3] === VIREMENT &&
                  aValues[1] === REJECTED &&
                  Boolean(aValues[2]),
                documentNumber: aValues[2],
              };
            });
        }),
      );
    }

    /**
     * Reads the request on its own. A single-entity read of a Rejected
     * request makes the server check the document's status live in S/4
     * (see requests-after-read-logic.js).
     */
    function readIsCompleted(oEntry) {
      return oEntry.context
        .getModel()
        .bindContext(oEntry.context.getPath(), undefined, {
          $select:
            "ID,status_code,earmarkedFundsDocNumber,earmarkedFundsIsCompleted",
          $$groupId: "$direct",
        })
        .requestObject()
        .then(function (oData) {
          return Boolean(oData && oData.earmarkedFundsIsCompleted);
        });
    }

    /**
     * Runs the action for one request, then confirms the result against
     * S/4. The action answers 200 even when S/4 refuses the completion
     * (it reports that as a warning message), so the call resolving is
     * not proof of success.
     */
    function completeOne(oEntry) {
      const oModel = oEntry.context.getModel();
      const oMessageModel = sap.ui.getCore().getMessageManager().getMessageModel();
      const aBefore = oMessageModel.getData().slice();

      const sServerText = function () {
        return oMessageModel
          .getData()
          .filter(function (oMessage) {
            return aBefore.indexOf(oMessage) === -1;
          })
          .map(function (oMessage) {
            return oMessage.getMessage();
          })
          .join(" ");
      };

      return oModel
        .bindContext(`${ACTION}(...)`, oEntry.context)
        .execute()
        .then(function () {
          return readIsCompleted(oEntry);
        })
        .then(function (bCompleted) {
          return {
            label: oEntry.label,
            ok: bCompleted,
            message: bCompleted
              ? ""
              : sServerText() ||
                `Document ${oEntry.documentNumber} is still not shown as complete in S/4.`,
          };
        })
        .catch(function (oError) {
          return { label: oEntry.label, ok: false, message: errorText(oError) };
        });
    }

    /*
     * Sequential on purpose: every call talks to S/4 through CPI, and
     * one failure must not stop the others.
     */
    function completeAll(aEntries) {
      const aResults = [];

      return aEntries
        .reduce(function (pChain, oEntry) {
          return pChain
            .then(function () {
              return completeOne(oEntry);
            })
            .then(function (oResult) {
              aResults.push(oResult);
            });
        }, Promise.resolve())
        .then(function () {
          return aResults;
        });
    }

    function showSummary(aResults, iSkipped) {
      const aFailed = aResults.filter(function (oResult) {
        return !oResult.ok;
      });

      const aLines = [
        `${aResults.length - aFailed.length} of ${aResults.length} Earmarked Funds document(s) are complete.`,
      ];

      if (iSkipped) {
        aLines.push(
          `${iSkipped} selected request(s) were skipped (not a Rejected Virement, or no Earmarked Funds document).`,
        );
      }

      if (aFailed.length) {
        aLines.push("", `${aFailed.length} need follow-up:`);

        aFailed.forEach(function (oResult) {
          aLines.push(`${oResult.label}: ${oResult.message}`);
        });
      }

      const fnShow = aFailed.length ? MessageBox.warning : MessageBox.success;

      fnShow(aLines.join("\n"), { title: "Complete Earmarked Funds" });
    }

    return {
      /**
       * Enablement rule for the toolbar button (see manifest.json): on
       * only when something is selected and EVERY selected request is a
       * Virement with status Rejected. Both values are already loaded by
       * the list's Request Type and Status columns - note the type
       * arrives as the expanded "requestType/code", not as
       * "requestType_code", so reading the latter would always be empty.
       *
       * @param {sap.ui.model.odata.v4.Context} oContext
       * @param {sap.ui.model.odata.v4.Context[]} aSelectedContexts
       * @returns {boolean}
       */
      isCompleteEarmarkedFundsEnabled: function (oContext, aSelectedContexts) {
        return Boolean(
          aSelectedContexts &&
            aSelectedContexts.length &&
            aSelectedContexts.every(function (oSelected) {
              return (
                oSelected.getProperty("requestType/code") === VIREMENT &&
                oSelected.getProperty("status_code") === REJECTED
              );
            }),
        );
      },

      /**
       * Request Report table toolbar action (admins only,
       * requiresSelection - see manifest.json). Completes the Earmarked
       * Funds document of every selected Rejected request, using the
       * same bound action as the Object Page button, so the server
       * applies the same admin and status checks to each one.
       *
       * @param {sap.ui.model.odata.v4.Context} oContext
       * @param {sap.ui.model.odata.v4.Context[]} aSelectedContexts
       * @returns {void}
       */
      onCompleteEarmarkedFunds: function (oContext, aSelectedContexts) {
        if (!aSelectedContexts || !aSelectedContexts.length) {
          MessageToast.show("Select at least one request first.");

          return;
        }

        BusyIndicator.show(0);

        classify(aSelectedContexts)
          .then(function (aEntries) {
            BusyIndicator.hide();

            const aEligible = aEntries.filter(function (oEntry) {
              return oEntry.eligible;
            });
            const iSkipped = aEntries.length - aEligible.length;

            if (!aEligible.length) {
              MessageBox.information(
                "None of the selected requests is a Rejected Virement with an Earmarked Funds document.",
              );

              return;
            }

            const sSkipped = iSkipped
              ? ` ${iSkipped} other selected request(s) will be skipped.`
              : "";

            MessageBox.confirm(
              `Mark the Earmarked Funds document of ${aEligible.length} rejected request(s) as complete? This releases their budget reservation in S/4.${sSkipped}`,
              {
                title: "Complete Earmarked Funds",
                onClose: function (sAction) {
                  if (sAction !== MessageBox.Action.OK) {
                    return;
                  }

                  BusyIndicator.show(0);

                  completeAll(aEligible).then(function (aResults) {
                    BusyIndicator.hide();
                    aEligible[0].context.getModel().refresh();
                    showSummary(aResults, iSkipped);
                  });
                },
              },
            );
          })
          .catch(function (oError) {
            BusyIndicator.hide();
            MessageBox.error(errorText(oError));
          });
      },
    };
  },
);
