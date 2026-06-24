sap.ui.define(
  ["sap/m/MessageBox", "sap/m/MessageToast", "sap/ui/core/Fragment"],
  function (MessageBox, MessageToast, Fragment) {
    "use strict";

    // =========================================================================
    //  SHARED STATE
    // =========================================================================
    let oUploadDialog = null;
    let oUploadModel = null;
    let oUploadView = null;
    let oUploadContext = null;
    let sUploadedBase64 = null;

    // =========================================================================
    //  MODULE-SCOPE HELPERS (no dependency on `this`)
    // =========================================================================

    function resolveView(oCtx, oEvent) {
      if (oCtx && oCtx.getView && oCtx.getView()) {
        return oCtx.getView();
      }
      if (oCtx && oCtx.base && oCtx.base.getView && oCtx.base.getView()) {
        return oCtx.base.getView();
      }
      if (oCtx && oCtx._view) {
        return oCtx._view;
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
      if (oCtx && oCtx.getModel && oCtx.getModel()) {
        return oCtx.getModel();
      }
      const oView = resolveView(oCtx, oEvent);
      if (oView && oView.getModel && oView.getModel()) {
        return oView.getModel();
      }
      if (oCtx && oCtx.base && oCtx.base.getModel && oCtx.base.getModel()) {
        return oCtx.base.getModel();
      }
      if (oEvent && oEvent.getSource && oEvent.getSource()) {
        const oSrc = oEvent.getSource();
        if (oSrc.getModel && oSrc.getModel()) {
          return oSrc.getModel();
        }
      }
      return null;
    }

    function resolveBindingContext(oCtx, oEvent) {
      const oView = resolveView(oCtx, oEvent);
      if (oView && oView.getBindingContext && oView.getBindingContext()) {
        return oView.getBindingContext();
      }
      if (oCtx && oCtx.getBindingContext && oCtx.getBindingContext()) {
        return oCtx.getBindingContext();
      }
      if (oEvent && oEvent.getSource && oEvent.getSource()) {
        const oSrc = oEvent.getSource();
        if (oSrc.getBindingContext && oSrc.getBindingContext()) {
          return oSrc.getBindingContext();
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
      const oByteArray = new Uint8Array(aByteNumbers);

      const oBlob = new Blob([oByteArray], {
        type:
          sMimeType ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const sUrl = window.URL.createObjectURL(oBlob);
      const oLink = document.createElement("a");
      oLink.href = sUrl;
      oLink.download = sFileName || "RequestItems_Template.xlsx";
      document.body.appendChild(oLink);
      oLink.click();
      document.body.removeChild(oLink);
      window.URL.revokeObjectURL(sUrl);
    }

    function readFileAsBase64(oFile) {
      return new Promise(function (resolve, reject) {
        const oReader = new FileReader();
        oReader.onload = function (oLoadEvent) {
          const sResult = oLoadEvent.target.result;
          resolve(sResult.split(",")[1]);
        };
        oReader.onerror = function () {
          reject(new Error("Failed to read the file."));
        };
        oReader.readAsDataURL(oFile);
      });
    }

    function getItemsBinding(oView) {
      if (!oView || !oView.findAggregatedObjects) {
        return null;
      }
      const aControls = oView.findAggregatedObjects(true, function (oCtrl) {
        return (
          oCtrl.isA &&
          (oCtrl.isA("sap.m.Table") || oCtrl.isA("sap.ui.table.Table"))
        );
      });
      for (let i = 0; i < aControls.length; i++) {
        const oTable = aControls[i];
        const oBinding =
          oTable.getBinding("items") || oTable.getBinding("rows");
        if (oBinding && oBinding.getPath) {
          const sPath = oBinding.getPath();
          if (sPath && sPath.indexOf("RequestItems") !== -1) {
            return oBinding;
          }
        }
      }
      return null;
    }

    function byFragId(oDialog, sLocalId, oView) {
      if (oView && oView.byId) {
        const oControl = oView.byId(sLocalId);
        if (oControl) {
          return oControl;
        }
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
            sMsg = oParsed.error.message;
          }
        } catch (e) {
          /* keep */
        }
      }
      return sMsg;
    }

    /**
     * Normalizes the uploadItems action result into an items array.
     * Handles: { items: [...] }, { value: [...] }, [...], or single object.
     *
     * @param {object|Array} oResult
     * @returns {Array<object>}
     */
    function normalizeItems(oResult) {
      if (!oResult) {
        return [];
      }
      // Wrapped: { items: [...] }
      if (Array.isArray(oResult.items)) {
        return oResult.items;
      }
      // OData collection: { value: [...] }
      if (Array.isArray(oResult.value)) {
        return oResult.value;
      }
      // Plain array
      if (Array.isArray(oResult)) {
        return oResult;
      }
      // Single object — wrap it.
      if (typeof oResult === "object") {
        return [oResult];
      }
      return [];
    }

    // ---- Upload event logic (module scope) --------------------------------

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
          console.log("File read OK, base64 length:", sBase64.length);
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
      if (!oUploadModel || !oUploadContext) {
        console.error(
          "Upload: missing model/context.",
          oUploadModel,
          oUploadContext,
        );
        MessageBox.error("No request context found.");
        return;
      }

      oUploadDialog.setBusy(true);

      const oOperation = oUploadModel.bindContext(
        "ZSVC_PPS_VIREMENT.uploadItems(...)",
        oUploadContext,
      );
      oOperation.setParameter("content", sUploadedBase64);

      oOperation
        .execute()
        .then(function () {
          const oResult = oOperation.getBoundContext().getObject();
          console.log("Raw uploadItems result:", oResult);

          const aItems = normalizeItems(oResult);
          console.log("Normalized items count:", aItems.length);

          if (!aItems.length) {
            oUploadDialog.setBusy(false);
            MessageToast.show("No items found in the file.");
            return Promise.reject(new Error("__handled__"));
          }

          const oItemsBinding = getItemsBinding(oUploadView);
          if (!oItemsBinding) {
            oUploadDialog.setBusy(false);
            console.error("Items table binding not found.");
            MessageBox.error("Could not find the items table binding.");
            return Promise.reject(new Error("__handled__"));
          }

          aItems.forEach(function (oItem) {
            oItemsBinding.create({
              srNo: oItem.srNo,
              costCentre: oItem.costCentre,
              glAccount: oItem.glAccount,
              material: oItem.material,
              wbs: oItem.wbs,
              assetStatus_code: oItem.assetStatus_code,
              type_code: oItem.type_code,
              amount: oItem.amount,
              description: oItem.description,
            });
          });

          return oUploadModel.submitBatch(oUploadModel.getUpdateGroupId());
        })
        .then(function () {
          oUploadDialog.setBusy(false);
          oUploadDialog.close();
          sUploadedBase64 = null;
          MessageToast.show("Items uploaded successfully.");
        })
        .catch(function (oError) {
          oUploadDialog.setBusy(false);
          if (oError && oError.message === "__handled__") {
            return;
          }
          console.error("Upload error:", oError);
          MessageBox.error(extractErrorMessage(oError));
        });
    }

    function handleCancelUpload() {
      sUploadedBase64 = null;
      if (oUploadDialog) {
        oUploadDialog.close();
      }
    }

    // =========================================================================
    //  RETURNED HANDLER OBJECT (thin entry points)
    // =========================================================================
    return {
      /**
       * Downloads the blank Excel template.
       * @param {sap.ui.base.Event} oEvent
       */
      onDownloadTemplate: function (oEvent) {
        const oModel = resolveModel(this, oEvent);
        if (!oModel) {
          console.error("DownloadTemplate: OData model not found.");
          MessageBox.error("Could not access the service. Please retry.");
          return;
        }

        const oOperation = oModel.bindContext("/downloadItemsTemplate(...)");
        oOperation
          .execute()
          .then(function () {
            const oCtx = oOperation.getBoundContext();
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
            MessageBox.error("Failed to download the template.");
          });
      },

      /**
       * Opens the upload dialog and wires its handlers programmatically.
       * Buttons are wired via the dialog's begin/end aggregations (reliable).
       * @param {sap.ui.base.Event} oEvent
       */
      onOpenUploadDialog: function (oEvent) {
        const oModel = resolveModel(this, oEvent);
        const oView = resolveView(this, oEvent);
        const oContext = resolveBindingContext(this, oEvent);

        if (!oModel) {
          console.error("UploadItems: OData model not found.");
          MessageBox.error("Could not access the service.");
          return;
        }

        // Guard: ensure we are in edit mode (draft).
        if (oContext && oContext.getProperty("IsActiveEntity") === true) {
          MessageBox.warning(
            "Please switch to edit mode before uploading items.",
          );
          return;
        }

        // Store in module-scope state.
        oUploadModel = oModel;
        oUploadView = oView;
        oUploadContext = oContext;
        sUploadedBase64 = null;

        if (!oUploadDialog) {
          Fragment.load({
            id: oView ? oView.getId() : "uploadItemsFrag",
            name: "virement.zuippsvirement.ext.fragment.UploadItemsDialog",
            controller: this,
          })
            .then(function (oDialog) {
              oUploadDialog = oDialog;
              if (oView) {
                oView.addDependent(oDialog);
              }

              // Wire buttons directly from dialog aggregations (reliable).
              const oConfirmBtn = oDialog.getBeginButton();
              const oCancelBtn = oDialog.getEndButton();
              const oFileUploader = byFragId(
                oDialog,
                "itemsFileUploader",
                oView,
              );

              if (oFileUploader) {
                oFileUploader.attachChange(handleFileSelected);
              } else {
                console.warn("FileUploader NOT FOUND!");
              }

              if (oConfirmBtn) {
                oConfirmBtn.attachPress(handleConfirmUpload);
              } else {
                console.warn("Confirm (begin) button NOT FOUND!");
              }

              if (oCancelBtn) {
                oCancelBtn.attachPress(handleCancelUpload);
              } else {
                console.warn("Cancel (end) button NOT FOUND!");
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
