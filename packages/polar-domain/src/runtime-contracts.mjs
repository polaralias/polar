const VALIDATION_DIRECTION = new Set(["input", "output"]);
export const TRUST_CLASSES = Object.freeze(["native", "skill", "mcp", "plugin"]);
export const RISK_CLASSES = Object.freeze([
  "low",
  "moderate",
  "high",
  "critical",
]);
export const EXECUTION_TYPES = Object.freeze([
  "tool",
  "handoff",
  "automation",
  "heartbeat",
]);
const executionTypes = new Set(EXECUTION_TYPES);

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {Set<unknown>} seen
 * @returns {string|undefined}
 */
function validateStrictJsonValue(value, path, seen) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return undefined;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return `${path} must be a finite number`;
    }

    return undefined;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return `${path} must not contain circular references`;
    }

    seen.add(value);
    for (let index = 0; index < value.length; index += 1) {
      const error = validateStrictJsonValue(
        value[index],
        `${path}[${index}]`,
        seen,
      );
      if (error) {
        seen.delete(value);
        return error;
      }
    }
    seen.delete(value);
    return undefined;
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return `${path} must not contain circular references`;
    }

    seen.add(value);
    for (const [key, childValue] of Object.entries(value)) {
      const error = validateStrictJsonValue(
        childValue,
        `${path}.${key}`,
        seen,
      );
      if (error) {
        seen.delete(value);
        return error;
      }
    }
    seen.delete(value);
    return undefined;
  }

  return `${path} must be a JSON value`;
}

function freezeRecord(value) {
  return Object.freeze({ ...value });
}

/**
 * @typedef {Object} SchemaValidationResult
 * @property {boolean} ok
 * @property {unknown} [value]
 * @property {string[]} [errors]
 */

/**
 * @typedef {Object} ValueField
 * @property {boolean} [required]
 * @property {(value: unknown) => SchemaValidationResult} parse
 */

/**
 * @typedef {Object} StrictObjectSchema
 * @property {string} schemaId
 * @property {(value: unknown) => SchemaValidationResult} validate
 */

/**
 * @typedef {Object} ActionContract
 * @property {string} actionId
 * @property {number} version
 * @property {StrictObjectSchema} inputSchema
 * @property {StrictObjectSchema} outputSchema
 * @property {"low"|"moderate"|"high"|"critical"} riskClass
 * @property {"native"|"skill"|"mcp"|"plugin"} trustClass
 * @property {number} timeoutMs
 * @property {{ maxAttempts: number }} retryPolicy
 */

export class PolarTypedError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PolarTypedError";
    this.code = code;
    this.details = freezeRecord(details);
  }
}

export class ContractValidationError extends PolarTypedError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, details = {}) {
    super("POLAR_CONTRACT_VALIDATION_ERROR", message, details);
    this.name = "ContractValidationError";
  }
}

export class ContractRegistryError extends PolarTypedError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, details = {}) {
    super("POLAR_CONTRACT_REGISTRY_ERROR", message, details);
    this.name = "ContractRegistryError";
  }
}

export class MiddlewareExecutionError extends PolarTypedError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, details = {}) {
    super("POLAR_MIDDLEWARE_EXECUTION_ERROR", message, details);
    this.name = "MiddlewareExecutionError";
  }
}

export class RuntimeExecutionError extends PolarTypedError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, details = {}) {
    super("POLAR_RUNTIME_EXECUTION_ERROR", message, details);
    this.name = "RuntimeExecutionError";
  }
}

/**
 * @param {unknown} value
 * @returns {"tool"|"handoff"|"automation"|"heartbeat"}
 */
export function parseExecutionType(value) {
  if (typeof value !== "string" || !executionTypes.has(value)) {
    throw new ContractValidationError("Invalid execution type", {
      expected: EXECUTION_TYPES,
      received: value,
    });
  }

  return /** @type {"tool"|"handoff"|"automation"|"heartbeat"} */ (value);
}

/**
 * @param {unknown} value
 * @returns {SchemaValidationResult}
 */
function ok(value) {
  return { ok: true, value };
}

/**
 * @param {string} error
 * @returns {SchemaValidationResult}
 */
function fail(error) {
  return { ok: false, errors: [error] };
}

/**
 * @param {{ minLength?: number, required?: boolean }} [options]
 * @returns {ValueField}
 */
export function stringField(options = {}) {
  const { minLength = 1, required = true } = options;

  return {
    required,
    parse(value) {
      if (typeof value !== "string") {
        return fail("must be a string");
      }

      if (value.length < minLength) {
        return fail(`must have length >= ${minLength}`);
      }

      return ok(value);
    },
  };
}

/**
 * @param {{ required?: boolean }} [options]
 * @returns {ValueField}
 */
export function booleanField(options = {}) {
  const { required = true } = options;

  return {
    required,
    parse(value) {
      if (typeof value !== "boolean") {
        return fail("must be a boolean");
      }

      return ok(value);
    },
  };
}

/**
 * @param {{ required?: boolean }} [options]
 * @returns {ValueField}
 */
export function jsonField(options = {}) {
  const { required = true } = options;

  return {
    required,
    parse(value) {
      const validationError = validateStrictJsonValue(value, "value", new Set());
      if (validationError) {
        return fail(validationError);
      }

      return ok(value);
    },
  };
}

/**
 * @param {{ required?: boolean, minLength?: number }} [options]
 * @returns {ValueField}
 */
export function idField(options = {}) {
  const { required = true, minLength = 1 } = options;

  return {
    required,
    parse(value) {
      let normalized = null;

      if (typeof value === "string") {
        normalized = value;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        normalized = String(value);
      }

      if (normalized === null) {
        return fail("must be a string or finite number");
      }

      if (normalized.length < minLength) {
        return fail(`must have length >= ${minLength}`);
      }

      return ok(normalized);
    },
  };
}

/**
 * @param {{ min?: number, max?: number, required?: boolean, finite?: boolean }} [options]
 * @returns {ValueField}
 */
export function numberField(options = {}) {
  const {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    required = true,
    finite = true,
  } = options;

  return {
    required,
    parse(value) {
      if (typeof value !== "number") {
        return fail("must be a number");
      }

      if (finite && !Number.isFinite(value)) {
        return fail("must be a finite number");
      }

      if (value < min) {
        return fail(`must be >= ${min}`);
      }

      if (value > max) {
        return fail(`must be <= ${max}`);
      }

      return ok(value);
    },
  };
}

/**
 * @param {{ minItems?: number, required?: boolean, itemMinLength?: number }} [options]
 * @returns {ValueField}
 */
export function stringArrayField(options = {}) {
  const { minItems = 1, required = true, itemMinLength = 1 } = options;

  return {
    required,
    parse(value) {
      if (!Array.isArray(value)) {
        return fail("must be an array");
      }

      if (value.length < minItems) {
        return fail(`must contain at least ${minItems} item(s)`);
      }

      const normalized = [];
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index];
        if (typeof item !== "string") {
          return fail(`item[${index}] must be a string`);
        }

        if (item.length < itemMinLength) {
          return fail(`item[${index}] must have length >= ${itemMinLength}`);
        }

        normalized.push(item);
      }

      return ok(Object.freeze(normalized));
    },
  };
}

/**
 * @param {{ minItems?: number, required?: boolean, finite?: boolean }} [options]
 * @returns {ValueField}
 */
export function numberArrayField(options = {}) {
  const { minItems = 1, required = true, finite = true } = options;

  return {
    required,
    parse(value) {
      if (!Array.isArray(value)) {
        return fail("must be an array");
      }

      if (value.length < minItems) {
        return fail(`must contain at least ${minItems} item(s)`);
      }

      const normalized = [];
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index];
        if (typeof item !== "number") {
          return fail(`item[${index}] must be a number`);
        }

        if (finite && !Number.isFinite(item)) {
          return fail(`item[${index}] must be a finite number`);
        }

        normalized.push(item);
      }

      return ok(Object.freeze(normalized));
    },
  };
}

/**
 * @param {readonly string[]} values
 * @param {{ required?: boolean }} [options]
 * @returns {ValueField}
 */
export function enumField(values, options = {}) {
  const allowedValues = new Set(values);
  const { required = true } = options;

  return {
    required,
    parse(value) {
      if (typeof value !== "string") {
        return fail("must be a string");
      }

      if (!allowedValues.has(value)) {
        return fail(`must be one of: ${values.join(", ")}`);
      }

      return ok(value);
    },
  };
}

/**
 * @param {{ schemaId: string, fields: Record<string, ValueField> }} config
 * @returns {StrictObjectSchema}
 */
export function createStrictObjectSchema({ schemaId, fields }) {
  const fieldEntries = Object.entries(fields);
  const allowedKeys = new Set(fieldEntries.map(([fieldName]) => fieldName));

  return Object.freeze({
    schemaId,
    validate(value) {
      if (!isPlainObject(value)) {
        return {
          ok: false,
          errors: [`${schemaId} must be a plain object`],
        };
      }

      const inputRecord = /** @type {Record<string, unknown>} */ (value);
      const errors = [];
      const normalized = {};

      for (const key of Object.keys(inputRecord)) {
        if (!allowedKeys.has(key)) {
          errors.push(`${schemaId} has unknown field "${key}"`);
        }
      }

      for (const [fieldName, field] of fieldEntries) {
        const hasValue = Object.prototype.hasOwnProperty.call(
          inputRecord,
          fieldName,
        );

        if (!hasValue) {
          if (field.required ?? true) {
            errors.push(`${schemaId} is missing required field "${fieldName}"`);
          }
          continue;
        }

        const parsed = field.parse(inputRecord[fieldName]);
        if (!parsed.ok) {
          const fieldErrors = parsed.errors ?? ["invalid value"];
          for (const fieldError of fieldErrors) {
            errors.push(`${schemaId}.${fieldName} ${fieldError}`);
          }
          continue;
        }

        normalized[fieldName] = parsed.value;
      }

      if (errors.length > 0) {
        return { ok: false, errors };
      }

      return { ok: true, value: freezeRecord(normalized) };
    },
  });
}

/**
 * @param {StrictObjectSchema} schema
 * @param {unknown} value
 * @param {"input"|"output"} direction
 * @param {string} actionId
 * @param {number} version
 * @returns {Record<string, unknown>}
 */
export function validateSchemaOrThrow(
  schema,
  value,
  direction,
  actionId,
  version,
) {
  if (!VALIDATION_DIRECTION.has(direction)) {
    throw new ContractValidationError(
      `Unknown validation direction "${direction}"`,
      { actionId, version, direction },
    );
  }

  const validation = schema.validate(value);

  if (!validation.ok) {
    throw new ContractValidationError(
      `Contract ${direction} validation failed for ${actionId}@${version}`,
      {
        actionId,
        version,
        direction,
        schemaId: schema.schemaId,
        errors: validation.errors ?? [],
      },
    );
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}
