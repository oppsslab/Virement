sap.ui.define(
  ["sap/ui/core/mvc/ControllerExtension", "sap/m/Popover", "sap/m/Text"],
  function (ControllerExtension, Popover, Text) {
    "use strict";

    /*
     * Radio button order in ReturnCategoryField.fragment.xml, mapped to the
     * ReturnCategory code list. Keep the two in sync.
     */
    const RETURN_CATEGORY_CODES = ["Z", "C"];

    const ERROR_WORKFLOW_STATUSES = ["ERRONEOUS", "ERROR"];

    return ControllerExtension.extend(
      "virement.zuippsvirement.ext.controller.ObjectPageExt",
      {
        /**
         * Icon for WorkflowStatusField.fragment.xml's ObjectStatus -
         * only set for an error status, so a healthy request shows no
         * icon at all.
         *
         * A plain formatter function is used here (rather than an
         * inline {= %{...} } expression binding) because the latter
         * silently failed to evaluate for this field's icon/active
         * properties in this custom-field-template context, with no
         * console error to diagnose - a formatter is unambiguous and
         * fails loudly (a clear console error) if it is ever wired up
         * incorrectly, unlike a silently-ignored expression binding.
         *
         * @param {string} sStatus workflowStatus
         * @returns {string} an icon URI, or "" for no icon
         */
        formatWorkflowStatusIcon: function (sStatus) {
          return ERROR_WORKFLOW_STATUSES.indexOf(sStatus) !== -1
            ? "sap-icon://message-error"
            : "";
        },

        /**
         * Whether WorkflowStatusField.fragment.xml's ObjectStatus
         * should render as "active" (clickable, underlined) - only
         * true for an error status. See formatWorkflowStatusIcon for
         * why this is a formatter rather than an expression binding.
         *
         * @param {string} sStatus workflowStatus
         * @returns {boolean}
         */
        formatWorkflowStatusActive: function (sStatus) {
          return ERROR_WORKFLOW_STATUSES.indexOf(sStatus) !== -1;
        },

        /**
         * Icon for EarmarkedFundsDocNumberField.fragment.xml's
         * ObjectStatus - a green tick once the Earmarked Funds
         * document has been checked as Completed against S/4, no
         * icon otherwise. See formatWorkflowStatusIcon above for why
         * this is a formatter rather than an expression binding.
         *
         * @param {boolean} bIsCompleted earmarkedFundsIsCompleted
         * @returns {string} an icon URI, or "" for no icon
         */
        formatEarmarkedFundsIcon: function (bIsCompleted) {
          return bIsCompleted ? "sap-icon://sys-enter-2" : "";
        },

        /**
         * ValueState for EarmarkedFundsDocNumberField.fragment.xml's
         * ObjectStatus - "Success" (green) once Completed, "None"
         * otherwise.
         *
         * @param {boolean} bIsCompleted earmarkedFundsIsCompleted
         * @returns {string} a sap.ui.core.ValueState name
         */
        formatEarmarkedFundsState: function (bIsCompleted) {
          return bIsCompleted ? "Success" : "None";
        },

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

        /**
         * Opens a Popover showing the workflow's execution error message.
         * Called from the WorkflowStatusField fragment's ObjectStatus
         * press event - that control is only shown as "active"
         * (clickable) when workflowStatus is an error status, so this is
         * not wired to fire otherwise.
         *
         * workflowError is deliberately NOT relied on to already be
         * loaded: it is not part of this page's own $select (it is only
         * ever read via a plain OData path, never referenced by any
         * annotation Fiori elements scans to build $select, and marking
         * it Hidden in a FieldGroup to force inclusion does not work -
         * Fiori elements skips genuinely hidden fields from $select too).
         * context.requestProperty() explicitly fetches it on demand
         * instead, regardless of what the page originally selected.
         *
         * The Popover is created once and reused (bound to whichever
         * context was pressed most recently), matching the standard
         * SAPUI5 lazy-singleton-control pattern.
         *
         * @param {sap.ui.base.Event} oEvent press event of the ObjectStatus
         * @returns {void}
         */
        onWorkflowStatusPress: function (oEvent) {
          const oSource = oEvent.getSource();

          const oContext = oSource.getBindingContext();

          if (!oContext) {
            return;
          }

          if (!this._workflowErrorPopover) {
            this._workflowErrorPopover = new Popover({
              title: "Workflow Error",
              placement: "Auto",
              contentWidth: "20rem",
              content: new Text({
                text: "{workflowError}",
              }).addStyleClass("sapUiSmallMargin"),
            });

            this.getView().addDependent(this._workflowErrorPopover);
          }

          this._workflowErrorPopover.bindElement(oContext.getPath());

          this._workflowErrorPopover.openBy(oSource);

          oContext.requestProperty("workflowError").catch(function (oError) {
            console.error("Failed to load workflow error message:", oError);
          });
        },
      },
    );
  },
);
