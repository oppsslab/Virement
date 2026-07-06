sap.ui.define(
  [
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "sap/ui/core/message/Message",
    "sap/ui/core/message/MessageType",
    "sap/ui/core/Messaging",
  ],
  function (
    MessageBox,
    MessageToast,
    Fragment,
    Message,
    MessageType,
    Messaging,
  ) {
    "use strict";

    let oUploadDialog = null;
    let oUploadModel = null;
    let oUploadView = null;
    let oUploadContext = null;
    let sUploadedBase64 = null;
    let aUploadMessages = [];

    function resolveView(oCtx, oEvent) {
      if (oCtx && oCtx.getView && oCtx.getView()) return oCtx.getView();
      if (oCtx && oCtx.base && oCtx.base.getView && oCtx.base.getView())
        return oCtx.base.getView();
      if (oCtx && oCtx._view) return oCtx._view;
      if (oEvent && oEvent.getSource && oEvent.getSource()) {
        let oControl = oEvent.getSource();
        while (oControl) {
          if (oControl.isA && oControl.isA("sap.ui.core.mvc.View"))
            return oControl;
          oControl = oControl.getParent && oControl.getParent();
        }
      }
      return null;
    }

    function resolveModel(oCtx, oEvent) {
      if (oCtx && oCtx.getModel && oCtx.getModel()) return oCtx.getModel();
      const oView = resolveView(oCtx, oEvent);
      if (oView && oView.getModel && oView.getModel()) return oView.getModel();
      if (oCtx && oCtx.base && oCtx.base.getModel && oCtx.base.getModel())
        return oCtx.base.getModel();
      if (oEvent && oEvent.getSource && oEvent.getSource()) {
        const oSrc = oEvent.getSource();
        if (oSrc.getModel && oSrc.getModel()) return oSrc.getModel();
      }
      return null;
    }

    function resolveBindingContext(oCtx, oEvent) {
      const oView = resolveView(oCtx, oEvent);
      if (oView && oView.getBindingContext && oView.getBindingContext())
        return oView.getBindingContext();
      if (oCtx && oCtx.getBindingContext && oCtx.getBindingContext())
        return oCtx.getBindingContext();
      if (oEvent && oEvent.getSource && oEvent.getSource()) {
        const oSrc = oEvent.getSource();
        if (oSrc.getBindingContext && oSrc.getBindingContext())
          return oSrc.getBindingContext();
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
      oLink.download = sFileName || "Mass Upload Template.xlsx";

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

    function getItemsBinding(oView) {
      if (!oView || !oView.findAggregatedObjects) return null;
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
          if (sPath && sPath.indexOf("RequestItems") !== -1) return oBinding;
        }
      }
      return null;
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
      if (oError && oError.message) sMsg = oError.message;
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

    function clearUploadMessages() {
      if (aUploadMessages.length) {
        Messaging.removeMessages(aUploadMessages);
        aUploadMessages = [];
      }
    }

    function normalizeMessage(vMessage) {
      if (!vMessage) return "";
      if (typeof vMessage === "string") return vMessage;
      if (vMessage.value) return vMessage.value;
      return String(vMessage);
    }

    function isGenericUploadWrapperMessage(sMessage) {
      return (
        sMessage === "Upload validation failed." ||
        sMessage === "Failed to process the uploaded file." ||
        sMessage === "Multiple errors occurred, see details below." ||
        sMessage === "Multiple errors occurred, see details below"
      );
    }

    function removeGenericUploadWrapperMessages() {
      const oMessageModel = Messaging.getMessageModel();
      if (!oMessageModel || !oMessageModel.getData) return;
      const aMessages = oMessageModel.getData() || [];
      const aMessagesToRemove = aMessages.filter(function (oMessage) {
        const sMessage =
          oMessage && oMessage.getMessage
            ? oMessage.getMessage()
            : oMessage && oMessage.message
              ? oMessage.message
              : "";
        return isGenericUploadWrapperMessage(sMessage);
      });
      if (aMessagesToRemove.length) Messaging.removeMessages(aMessagesToRemove);
    }

    function collectMessagesFromError(oError) {
      const aRawMessages = [];
      function addRawMessage(sMessage, sTarget, sCode) {
        if (!sMessage) return;
        aRawMessages.push({
          message: sMessage,
          target: sTarget || "",
          code: sCode || "ITEM_VALIDATION",
        });
      }
      function readODataErrorBody(oBody) {
        if (!oBody) return;
        const oErr = oBody.error || oBody;
        if (Array.isArray(oErr.details) && oErr.details.length) {
          oErr.details.forEach(function (oDetail) {
            addRawMessage(
              normalizeMessage(oDetail.message),
              oDetail.target,
              oDetail.code,
            );
          });
        }
        if (oErr.message)
          addRawMessage(normalizeMessage(oErr.message), oErr.target, oErr.code);
      }
      try {
        if (oError && oError.responseText)
          readODataErrorBody(JSON.parse(oError.responseText));
      } catch (e) {}
      try {
        if (oError && oError.error) readODataErrorBody(oError.error);
      } catch (e) {}
      try {
        if (oError && oError.cause && oError.cause.error)
          readODataErrorBody(oError.cause.error);
      } catch (e) {}
      if (!aRawMessages.length) addRawMessage(extractErrorMessage(oError));

      const mSeen = {};
      const aDeduped = aRawMessages.filter(function (oMessage) {
        const sKey = oMessage.message + "|" + oMessage.target;
        if (mSeen[sKey]) return false;
        mSeen[sKey] = true;
        return true;
      });
      const aUsefulMessages = aDeduped.filter(function (oMessage) {
        return !isGenericUploadWrapperMessage(oMessage.message);
      });
      return aUsefulMessages.length ? aUsefulMessages : aDeduped;
    }

    function resolveUploadMessageTarget(oDetail, sContextPath) {
      const sBackendTarget =
        oDetail && oDetail.target ? String(oDetail.target) : "";
      if (!sContextPath) return "";
      if (sBackendTarget.indexOf("items/") === 0)
        return sContextPath + "/RequestItems";
      if (sBackendTarget === "items") return sContextPath + "/RequestItems";
      return sContextPath;
    }

    function pushBackendMessagesToFooter(oError, oModel, oContext) {
      if (!oModel) return 0;
      Messaging.registerMessageProcessor(oModel);
      const sContextPath =
        oContext && oContext.getPath ? oContext.getPath() : "";
      const aDetails = collectMessagesFromError(oError);
      const aMessages = aDetails.map(function (oDetail) {
        return new Message({
          message: oDetail.message,
          description: oDetail.message,
          type: MessageType.Error,
          target: resolveUploadMessageTarget(oDetail, sContextPath),
          processor: oModel,
          persistent: true,
          code: oDetail.code || "ITEM_VALIDATION",
        });
      });
      if (aMessages.length) {
        Messaging.addMessages(aMessages);
        aUploadMessages = aUploadMessages.concat(aMessages);
      }
      return aMessages.length;
    }

    function normalizeItems(oResult) {
      if (!oResult) return [];
      if (Array.isArray(oResult.items)) return oResult.items;
      if (Array.isArray(oResult.value)) return oResult.value;
      if (Array.isArray(oResult)) return oResult;
      if (typeof oResult === "object") return [oResult];
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

      clearUploadMessages();
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
          const aItems = normalizeItems(oResult);
          if (!aItems.length) {
            oUploadDialog.setBusy(false);
            MessageToast.show("No items found in the file.");
            return Promise.reject(new Error("__handled__"));
          }

          const oItemsBinding = getItemsBinding(oUploadView);
          if (!oItemsBinding) {
            oUploadDialog.setBusy(false);
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

          clearSelectedUploadFile();

          MessageToast.show("Items uploaded successfully.");
        })
        .catch(function (oError) {
          oUploadDialog.setBusy(false);
          if (oError && oError.message === "__handled__") return;
          console.error("Upload error:", oError);

          const iMessageCount = pushBackendMessagesToFooter(
            oError,
            oUploadModel,
            oUploadContext,
          );

          removeGenericUploadWrapperMessages();
          setTimeout(function () {
            removeGenericUploadWrapperMessages();
          }, 0);

          oUploadDialog.close();
          sUploadedBase64 = null;

          MessageBox.error("Multiple errors occurred, see details below.", {
            title: "Upload Validation Failed",
          });

          if (!iMessageCount) MessageBox.error(extractErrorMessage(oError));
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
        "itemsFileUploader",
        oUploadView,
      );

      if (oFileUploader && oFileUploader.clear) {
        oFileUploader.clear();
      }
    }

    return {
      onDownloadTemplate: function (oEvent) {
        const oModel = resolveModel(this, oEvent);
        const oContext = resolveBindingContext(this, oEvent);

        if (!oModel) {
          MessageBox.error("Could not access the service. Please retry.");
          return;
        }

        if (!oContext) {
          MessageBox.error("Could not determine the current request.");
          console.error("DownloadTemplate: missing binding context.");
          return;
        }

        console.log("DownloadTemplate context path:", oContext.getPath());

        /*
         * Bound action on Requests.
         *
         * Important:
         * This must match the namespace in your $metadata.
         * If needed, check:
         * /service/ZSVC_PPS_VIREMENT/$metadata
         */
        const oOperation = oModel.bindContext(
          "ZSVC_PPS_VIREMENT.downloadItemsTemplate(...)",
          oContext,
        );

        /*
         * Optional but helpful for draft/create mode.
         * This makes sure selected requestType_code is patched before backend reads it.
         */
        const sUpdateGroupId =
          oModel.getUpdateGroupId && oModel.getUpdateGroupId();

        const pBeforeInvoke =
          oModel.hasPendingChanges && oModel.hasPendingChanges()
            ? oModel.submitBatch(sUpdateGroupId || "$auto")
            : Promise.resolve();

        pBeforeInvoke
          .then(function () {
            console.log("Invoking downloadItemsTemplate bound action...");

            if (oOperation.invoke) {
              return oOperation.invoke();
            }

            /*
             * Fallback for UI5 versions where execute() is used.
             * Your uploadItems code already uses execute(), so this keeps it compatible.
             */
            return oOperation.execute();
          })
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
        const oContext = resolveBindingContext(this, oEvent);

        if (!oModel) {
          MessageBox.error("Could not access the service.");
          return;
        }
        if (oContext && oContext.getProperty("IsActiveEntity") === true) {
          MessageBox.warning(
            "Please switch to edit mode before uploading items.",
          );
          return;
        }

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
              if (oView) oView.addDependent(oDialog);

              const oConfirmBtn = oDialog.getBeginButton();
              const oCancelBtn = oDialog.getEndButton();
              const oFileUploader = byFragId(
                oDialog,
                "itemsFileUploader",
                oView,
              );

              if (oFileUploader) oFileUploader.attachChange(handleFileSelected);
              else console.warn("FileUploader NOT FOUND!");

              if (oConfirmBtn) oConfirmBtn.attachPress(handleConfirmUpload);
              else console.warn("Confirm button NOT FOUND!");

              if (oCancelBtn) oCancelBtn.attachPress(handleCancelUpload);
              else console.warn("Cancel button NOT FOUND!");

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
