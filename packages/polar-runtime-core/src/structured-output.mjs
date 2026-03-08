function normalizeJsonText(rawText) {
  return String(rawText || "").replace(/```json?\s*/g, "").replace(/```/g, "").trim();
}

function normalizeValidationErrors(validation) {
  if (!validation || !Array.isArray(validation.errors)) {
    return [];
  }
  return validation.errors
    .map((error) => (typeof error === "string" ? error : String(error || "")))
    .filter((error) => error.length > 0);
}

function normalizeClampReasons(validation) {
  if (!validation || !Array.isArray(validation.clampReasons)) {
    return [];
  }
  return validation.clampReasons
    .map((reason) => (typeof reason === "string" ? reason : String(reason || "")))
    .filter((reason) => reason.length > 0);
}

export function createJsonSchemaResponseFormat(name, schema) {
  return Object.freeze({
    type: "json_schema",
    json_schema: {
      name,
      strict: true,
      schema,
    },
  });
}

async function generateStructuredCandidate(input) {
  const request =
    input.responseFormat === undefined
      ? { ...input.request }
      : { ...input.request, responseFormat: input.responseFormat };
  try {
    const response = await input.providerGateway.generate(request);
    return {
      response,
      structuredOutputFallbackUsed: false,
    };
  } catch {
    if (input.responseFormat === undefined) {
      throw new Error("structured_output_unavailable");
    }
    const { responseFormat, ...fallbackRequest } = request;
    const response = await input.providerGateway.generate(fallbackRequest);
    return {
      response,
      structuredOutputFallbackUsed: true,
    };
  }
}

export async function requestStructuredJsonResponse(input) {
  let structuredOutputFallbackUsed = false;
  let repairAttempted = false;

  try {
    const initial = await generateStructuredCandidate({
      providerGateway: input.providerGateway,
      request: input.initialRequest,
      responseFormat: input.responseFormat,
    });
    structuredOutputFallbackUsed = initial.structuredOutputFallbackUsed;
    const initialText = String(initial.response?.text || "{}");
    const initialValidation = input.validateResponseText(initialText);
    if (initialValidation?.valid) {
      return {
        value: initialValidation.value,
        valid: true,
        fallbackReason: null,
        repairAttempted: false,
        repairSucceeded: false,
        structuredOutputFallbackUsed,
        validationErrors: [],
        clampReasons: normalizeClampReasons(initialValidation),
        errorMessage: null,
      };
    }

    const initialErrors = normalizeValidationErrors(initialValidation);
    const initialClampReasons = normalizeClampReasons(initialValidation);
    if (typeof input.buildRepairRequest !== "function") {
      return {
        value: null,
        valid: false,
        fallbackReason: input.invalidFallbackReason || "schema_invalid",
        repairAttempted: false,
        repairSucceeded: false,
        structuredOutputFallbackUsed,
        validationErrors: initialErrors,
        clampReasons:
          initialClampReasons.length > 0
            ? initialClampReasons
            : [input.invalidFallbackReason || "schema_invalid"],
        errorMessage: null,
      };
    }

    repairAttempted = true;
    const repairRequest = input.buildRepairRequest({
      invalidOutput: normalizeJsonText(initialText),
      validationErrors: initialErrors,
    });
    const repair = await generateStructuredCandidate({
      providerGateway: input.providerGateway,
      request: repairRequest,
      responseFormat: input.responseFormat,
    });
    structuredOutputFallbackUsed =
      structuredOutputFallbackUsed || repair.structuredOutputFallbackUsed;
    const repairedValidation = input.validateResponseText(
      String(repair.response?.text || "{}"),
    );
    if (repairedValidation?.valid) {
      return {
        value: repairedValidation.value,
        valid: true,
        fallbackReason: null,
        repairAttempted: true,
        repairSucceeded: true,
        structuredOutputFallbackUsed,
        validationErrors: [],
        clampReasons: normalizeClampReasons(repairedValidation),
        errorMessage: null,
      };
    }

    const repairedClampReasons = normalizeClampReasons(repairedValidation);
    return {
      value: null,
      valid: false,
      fallbackReason: input.invalidFallbackReason || "schema_invalid",
      repairAttempted: true,
      repairSucceeded: false,
      structuredOutputFallbackUsed,
      validationErrors:
        normalizeValidationErrors(repairedValidation).length > 0
          ? normalizeValidationErrors(repairedValidation)
          : initialErrors,
      clampReasons:
        repairedClampReasons.length > 0
          ? repairedClampReasons
          : [input.invalidFallbackReason || "schema_invalid"],
      errorMessage: null,
    };
  } catch (error) {
    return {
      value: null,
      valid: false,
      fallbackReason: input.unavailableFallbackReason || "structured_output_unavailable",
      repairAttempted,
      repairSucceeded: false,
      structuredOutputFallbackUsed,
      validationErrors: [],
      clampReasons: [
        input.unavailableFallbackReason || "structured_output_unavailable",
      ],
      errorMessage:
        typeof error?.message === "string" && error.message.length > 0
          ? error.message
          : null,
    };
  }
}
