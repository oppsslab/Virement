sap.ui.define(
  [
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "sap/ui/model/resource/ResourceModel",
  ],
  function (MessageBox, MessageToast, Fragment, ResourceModel) {
    "use strict";

    /*
     * See ApproverMatrixListReportActions.js for the rationale behind
     * this file's structure - this mirrors it exactly, adapted for
     * the RegionBranchGrouping entity/fields.
     */
    const I18N_BUNDLE_NAME = "virement.zuippsvirement.i18n.i18n";

    let oUploadDialog = null;
    let oUploadModel = null;
    let oUploadView = null;
    let sUploadedBase64 = null;

    function resolveView(oCtx, oEvent) {
      if (oCtx && oCtx.getView && oCtx.getView()) return oCtx.getView();

      if (oCtx && oCtx.base && oCtx.base.getView && oCtx.base.getView()) {
        return oCtx.base.getView();
      }

      if (oEvent && oEvent.getSource && oEvent.getSource()) {
        let oControl = oEvent.getSource();

        while (oControl) {
          if (oControl.isA && oControl.isA("sap.ui.core.mvc.View")) {
            return oControl;
          }

          oControl = oControl.getParent && oControl.getParent();
        }
      }

      return null;
    }

    function resolveModel(oCtx, oEvent) {
      if (oCtx && oCtx.getModel && oCtx.getModel()) return oCtx.getModel();

      const oView = resolveView(oCtx, oEvent);

      if (oView && oView.getModel && oView.getModel()) {
        return oView.getModel();
      }

      if (oEvent && oEvent.getSource && oEvent.getSource()) {
        const oSrc = oEvent.getSource();

        if (oSrc.getModel && oSrc.getModel()) {
          return oSrc.getModel();
        }
      }

      return null;
    }

    function triggerDownload(sBase64, sFileName, sMimeType) {
      const sByteChars = atob(sBase64);
      const aByteNumbers = new Array(sByteChars.length);

      for (let i = 0; i < sByteChars.length; i++) {
        aByteNumbers[i] = sByteChars.charCodeAt(i);
      }

      const oBlob = new Blob([new Uint8Array(aByteNumbers)], {
        type:
          sMimeType ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const sUrl = window.URL.createObjectURL(oBlob);
      const oLink = document.createElement("a");

      oLink.href = sUrl;
      oLink.download = sFileName || "Region Branch Grouping Template.xlsx";

      document.body.appendChild(oLink);
      oLink.click();
      document.body.removeChild(oLink);

      window.URL.revokeObjectURL(sUrl);
    }

    function readFileAsBase64(oFile) {
      return new Promise(function (resolve, reject) {
        const oReader = new FileReader();

        oReader.onload = function (oLoadEvent) {
          resolve(oLoadEvent.target.result.split(",")[1]);
        };

        oReader.onerror = function () {
          reject(new Error("Failed to read the file."));
        };

        oReader.readAsDataURL(oFile);
      });
    }

    function byFragId(oDialog, sLocalId, oView) {
      if (oView && oView.byId) {
        const oControl = oView.byId(sLocalId);

        if (oControl) return oControl;
      }

      const aFound = oDialog.findAggregatedObjects(true, function (oCtrl) {
        const sId = oCtrl.getId && oCtrl.getId();

        return sId && sId.indexOf(sLocalId) !== -1;
      });

      return aFound && aFound.length ? aFound[0] : null;
    }

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

    function normalizeRows(oResult) {
      if (!oResult) return [];
      if (Array.isArray(oResult.rows)) return oResult.rows;
      if (Array.isArray(oResult.value)) return oResult.value;
      if (Array.isArray(oResult)) return oResult;

      return [];
    }

    function handleFileSelected(oEvent) {
      const aFiles = oEvent.getParameter("files");
      const oFile = aFiles && aFiles[0];

      if (!oFile) {
        sUploadedBase64 = null;
        return;
      }

      readFileAsBase64(oFile)
        .then(function (sBase64) {
          sUploadedBase64 = sBase64;
        })
        .catch(function (oErr) {
          console.error("File read error:", oErr);
          MessageBox.error("Failed to read the selected file.");
          sUploadedBase64 = null;
        });
    }

    function handleConfirmUpload() {
      if (!sUploadedBase64) {
        MessageToast.show("Please select an Excel file first.");
        return;
      }

      if (!oUploadModel) {
        MessageBox.error("Could not access the service. Please retry.");
        return;
      }

      oUploadDialog.setBusy(true);

      const oOperation = oUploadModel.bindContext("/uploadRegionBranchGrouping(...)");

      oOperation.setParameter("content", sUploadedBase64);

      oOperation
        .execute()
        .then(function () {
          const oResult = oOperation.getBoundContext().getObject();
          const aRows = normalizeRows(oResult);

          if (!aRows.length) {
            oUploadDialog.setBusy(false);
            MessageToast.show("No rows found in the file.");
            return Promise.reject(new Error("__handled__"));
          }

          const sUpdateGroupId =
            oUploadModel.getUpdateGroupId && oUploadModel.getUpdateGroupId();

          const oListBinding = oUploadModel.bindList(
            "/RegionBranchGrouping",
            null,
            null,
            null,
            { $$updateGroupId: sUpdateGroupId || "$auto" },
          );

          /*
           * RegionBranchGrouping is draft-enabled (required for the List
           * Report's inline edit of existing rows), so a plain create
           * only produces a draft - it still needs draftActivate per
           * row to become a live, visible record. Contexts are kept
           * so each one can be activated once the batch confirms it.
           */
          const aCreatedContexts = aRows.map(function (oRow) {
            return oListBinding.create({
              region: oRow.region,
              state: oRow.state,
              branch: oRow.branch,
              costCentre: oRow.costCentre,
              costCentreDescription: oRow.costCentreDescription,
            });
          });

          return oUploadModel
            .submitBatch(sUpdateGroupId || "$auto")
            .then(function () {
              return Promise.all(
                aCreatedContexts.map(function (oContext) {
                  return oContext.created().then(function () {
                    return oUploadModel
                      .bindContext(
                        "ZSVC_PPS_VIREMENT.draftActivate(...)",
                        oContext,
                      )
                      .execute();
                  });
                }),
              );
            });
        })
        .then(function () {
          if (oUploadModel.refresh) {
            oUploadModel.refresh();
          }

          oUploadDialog.setBusy(false);
          oUploadDialog.close();

          clearSelectedUploadFile();

          MessageToast.show("Region & Branch Grouping rows uploaded successfully.");
        })
        .catch(function (oError) {
          oUploadDialog.setBusy(false);

          if (oError && oError.message === "__handled__") {
            return;
          }

          console.error("Upload error:", oError);

          oUploadDialog.close();
          sUploadedBase64 = null;

          MessageBox.error(extractErrorMessage(oError), {
            title: "Upload Validation Failed",
          });
        });
    }

    function handleCancelUpload() {
      clearSelectedUploadFile();

      if (oUploadDialog) {
        oUploadDialog.close();
      }
    }

    function clearSelectedUploadFile() {
      sUploadedBase64 = null;

      if (!oUploadDialog) {
        return;
      }

      const oFileUploader = byFragId(
        oUploadDialog,
        "regionBranchGroupingFileUploader",
        oUploadView,
      );

      if (oFileUploader && oFileUploader.clear) {
        oFileUploader.clear();
      }
    }

    return {
      onDownloadTemplate: function (oEvent) {
        const oModel = resolveModel(this, oEvent);

        if (!oModel) {
          MessageBox.error("Could not access the service. Please retry.");
          return;
        }

        const oOperation = oModel.bindContext(
          "/downloadRegionBranchGroupingTemplate(...)",
        );

        oOperation
          .execute()
          .then(function () {
            const oCtx = oOperation.getBoundContext();

            if (!oCtx) {
              MessageBox.error("No response was returned from the service.");
              return;
            }

            const sContent = oCtx.getProperty("content");
            const sFileName = oCtx.getProperty("fileName");
            const sMimeType = oCtx.getProperty("mimeType");

            if (!sContent) {
              MessageBox.error("The template content is empty.");
              return;
            }

            triggerDownload(sContent, sFileName, sMimeType);
            MessageToast.show("Template downloaded.");
          })
          .catch(function (oError) {
            console.error("DownloadTemplate error:", oError);
            MessageBox.error(extractErrorMessage(oError));
          });
      },

      onOpenUploadDialog: function (oEvent) {
        const oModel = resolveModel(this, oEvent);
        const oView = resolveView(this, oEvent);

        if (!oModel) {
          MessageBox.error("Could not access the service.");
          return;
        }

        oUploadModel = oModel;
        oUploadView = oView;
        sUploadedBase64 = null;

        if (!oUploadDialog) {
          Fragment.load({
            id: oView ? oView.getId() : "regionBranchGroupingUploadFrag",
            name: "virement.zuippsvirement.ext.fragment.RegionBranchGroupingUploadDialog",
            controller: this,
          })
            .then(function (oDialog) {
              oUploadDialog = oDialog;

              oDialog.setModel(
                new ResourceModel({ bundleName: I18N_BUNDLE_NAME }),
                "i18n",
              );

              if (oView) {
                oView.addDependent(oDialog);
              }

              const oConfirmBtn = oDialog.getBeginButton();
              const oCancelBtn = oDialog.getEndButton();
              const oFileUploader = byFragId(
                oDialog,
                "regionBranchGroupingFileUploader",
                oView,
              );

              if (oFileUploader) {
                oFileUploader.attachChange(handleFileSelected);
              }

              if (oConfirmBtn) {
                oConfirmBtn.attachPress(handleConfirmUpload);
              }

              if (oCancelBtn) {
                oCancelBtn.attachPress(handleCancelUpload);
              }

              oDialog.open();
            })
            .catch(function (oErr) {
              console.error("Open upload dialog failed:", oErr);
              MessageBox.error("Could not open the upload dialog.");
            });
        } else {
          oUploadDialog.open();
        }
      },
    };
  },
);
