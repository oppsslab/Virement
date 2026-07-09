const cds = require("@sap/cds");
const { buildTemplate } = require("./utils/items-template");

const LOG = cds.log("download-items-template-logic");

function getUserRoles(user) {
  const userRoles = [];

  if (!user) {
    return userRoles;
  }

  /*
   * Preferred CAP-style role check.
   */
  if (typeof user.is === "function") {
    if (user.is("MASS_UPLOAD_ALL")) {
      userRoles.push("MASS_UPLOAD_ALL");
    }

    if (user.is("MASS_UPLOAD_TRANSFER")) {
      userRoles.push("MASS_UPLOAD_TRANSFER");
    }
  }

  /*
   * Fallback if roles are exposed as array or object.
   */
  if (user.roles) {
    if (Array.isArray(user.roles)) {
      user.roles.forEach(function (role) {
        const normalizedRole = String(role || "")
          .trim()
          .toUpperCase();

        if (normalizedRole && !userRoles.includes(normalizedRole)) {
          userRoles.push(normalizedRole);
        }
      });
    } else if (typeof user.roles === "object") {
      Object.keys(user.roles).forEach(function (role) {
        const normalizedRole = String(role || "")
          .trim()
          .toUpperCase();

        if (
          user.roles[role] === true &&
          normalizedRole &&
          !userRoles.includes(normalizedRole)
        ) {
          userRoles.push(normalizedRole);
        }
      });
    }
  }

  return userRoles;
}

function getExistingColumns(entity, candidates) {
  if (!entity || !entity.elements) {
    return candidates;
  }

  return candidates.filter(function (column) {
    const element = entity.elements[column];

    if (!element) {
      return false;
    }

    if (element.virtual) {
      return false;
    }

    if (element.isAssociation || element.isComposition) {
      return false;
    }

    return true;
  });
}

function getRequestTypeFromObject(object) {
  if (!object) {
    return null;
  }

  if (object.requestType_code) {
    return object.requestType_code;
  }

  if (object.type_code) {
    return object.type_code;
  }

  if (object.requestTypeCode) {
    return object.requestTypeCode;
  }

  if (object.requestType) {
    if (typeof object.requestType === "string") {
      return object.requestType;
    }

    if (typeof object.requestType === "object" && object.requestType.code) {
      return object.requestType.code;
    }
  }

  return null;
}

function normalizeRequestType(value) {
  let requestType = value;

  if (typeof requestType === "object" && requestType.code) {
    requestType = requestType.code;
  }

  requestType = String(requestType || "")
    .trim()
    .toUpperCase();

  if (!["T", "S", "R"].includes(requestType)) {
    throw new Error("Invalid request type found: " + requestType);
  }

  return requestType;
}

async function queryOne(tx, entity, columns, requestId) {
  if (!entity || !columns || !columns.length) {
    return null;
  }

  return tx.run(
    SELECT.one.from(entity).columns(columns).where({ ID: requestId }),
  );
}

async function determineRequestTemplateContext(request, tx) {
  const keys = request.params && request.params[0];

  if (!keys) {
    throw new Error("No bound request keys found.");
  }

  LOG.info("Bound request keys: " + JSON.stringify(keys));

  const requestId = keys.ID;

  if (!requestId) {
    throw new Error("No Request ID found in bound keys.");
  }

  const serviceRequests = request.target;
  const db = cds.entities("ZDB_PPS_VIREMENT");

  if (!db || !db.Requests) {
    throw new Error("DB entity ZDB_PPS_VIREMENT.Requests not found.");
  }

  const dbRequests = db.Requests;

  let record = null;

  /*
   * 1. Try service projection draft first.
   */
  if (serviceRequests && serviceRequests.drafts) {
    const serviceDraftColumns = getExistingColumns(serviceRequests.drafts, [
      "ID",
      "requestType_code",
      "type_code",
      "requestTypeCode",
    ]);

    LOG.info(
      "Trying to read request type from service draft entity. Columns: " +
        JSON.stringify(serviceDraftColumns),
    );

    record = await queryOne(
      tx,
      serviceRequests.drafts,
      serviceDraftColumns,
      requestId,
    );

    if (record) {
      LOG.info(
        "Service draft Requests record found: " + JSON.stringify(record),
      );
    }
  } else {
    LOG.info("Service draft entity request.target.drafts is not available.");
  }

  /*
   * 2. Try DB draft entity next.
   */
  if (!record && dbRequests && dbRequests.drafts) {
    const dbDraftColumns = getExistingColumns(dbRequests.drafts, [
      "ID",
      "requestType_code",
      "type_code",
      "requestTypeCode",
    ]);

    LOG.info(
      "Trying to read request type from DB draft entity. Columns: " +
        JSON.stringify(dbDraftColumns),
    );

    record = await queryOne(tx, dbRequests.drafts, dbDraftColumns, requestId);

    if (record) {
      LOG.info("DB draft Requests record found: " + JSON.stringify(record));
    }
  } else if (!record) {
    LOG.info("DB draft entity db.Requests.drafts is not available.");
  }

  /*
   * 3. Try active DB table.
   */
  if (!record) {
    const dbActiveColumns = getExistingColumns(dbRequests, [
      "ID",
      "requestType_code",
      "type_code",
      "requestTypeCode",
    ]);

    LOG.info(
      "Trying to read request type from active DB entity. Columns: " +
        JSON.stringify(dbActiveColumns),
    );

    record = await queryOne(tx, dbRequests, dbActiveColumns, requestId);

    if (record) {
      LOG.info("Active DB Requests record found: " + JSON.stringify(record));
    }
  }

  /*
   * 4. Last fallback: active service projection.
   */
  if (!record && serviceRequests) {
    const serviceActiveColumns = getExistingColumns(serviceRequests, [
      "ID",
      "requestType_code",
      "type_code",
      "requestTypeCode",
    ]);

    LOG.info(
      "Trying to read request type from active service projection. Columns: " +
        JSON.stringify(serviceActiveColumns),
    );

    record = await queryOne(
      tx,
      serviceRequests,
      serviceActiveColumns,
      requestId,
    );

    if (record) {
      LOG.info(
        "Active service Requests record found: " + JSON.stringify(record),
      );
    }
  }

  if (!record) {
    throw new Error(
      "No Requests record found in service draft, DB draft, active DB table, or active service projection for ID: " +
        requestId,
    );
  }

  const requestType = getRequestTypeFromObject(record);

  if (!requestType) {
    throw new Error(
      "No request type found on Requests record. Record was: " +
        JSON.stringify(record),
    );
  }

  return {
    requestType: normalizeRequestType(requestType),
  };
}

module.exports = async function (request) {
  LOG.info("=== ON downloadItemsTemplate started ===");

  try {
    const tx = cds.tx(request);

    const userRoles = getUserRoles(request.user);
    LOG.info("User roles: " + JSON.stringify(userRoles));

    const templateContext = await determineRequestTemplateContext(request, tx);

    LOG.info("Request type used for template: " + templateContext.requestType);

    /*
     * Return template is role-independent.
     * Roles only matter for Transfer.
     */
    const effectiveRoles = templateContext.requestType === "R" ? [] : userRoles;

    LOG.info(
      "Calling buildTemplate with: " +
        JSON.stringify({
          userRoles: effectiveRoles,
          requestType: templateContext.requestType,
        }),
    );

    const template = buildTemplate(effectiveRoles, templateContext.requestType);

    LOG.info("Template generated: " + template.fileName);
    LOG.info("=== ON downloadItemsTemplate ended successfully ===");

    return template;
  } catch (error) {
    LOG.error("Error in downloadItemsTemplate: " + error.message);

    return request.error(500, "Could not generate template: " + error.message);
  }
};
