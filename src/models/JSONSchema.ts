export type JSONSchema7TypeName =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export interface JSONSchema7 {
  type?: JSONSchema7TypeName | JSONSchema7TypeName[];
  properties?: Record<string, JSONSchema7>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  items?: JSONSchema7;
  additionalProperties?: boolean | JSONSchema7;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  anyOf?: JSONSchema7[];
  oneOf?: JSONSchema7[];
  allOf?: JSONSchema7[];
}
