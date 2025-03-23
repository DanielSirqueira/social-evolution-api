import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';
import { OrganizationStatus } from '@api/dto/organization.dto';

const isNotEmpty = (...propertyNames: string[]): JSONSchema7 => {
  const properties = {};
  propertyNames.forEach(
    (property) =>
      (properties[property] = {
        minLength: 1,
        description: `The "${property}" cannot be empty`,
      }),
  );
  return {
    if: {
      propertyNames: {
        enum: [...propertyNames],
      },
    },
    then: { properties },
  };
};

export const createOrganizationSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    instanceLimit: { type: 'number', minimum: 1 },
    status: { type: 'string', enum: Object.values(OrganizationStatus) }
  },
  required: ['name'],
  additionalProperties: false,
  allOf: [isNotEmpty('name')]
};

export const updateOrganizationSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    instanceLimit: { type: 'number', minimum: 1 },
    status: { type: 'string', enum: Object.values(OrganizationStatus) }
  },
  additionalProperties: false
};

export const getOrganizationSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    id: { type: 'string' }
  },
  additionalProperties: false,
  allOf: [isNotEmpty('id')]
};

export const forceDeleteOrganizationSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    id: { type: 'string' }
  },
  additionalProperties: false,
  allOf: [isNotEmpty('id')]
};

export const listOrganizationsSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    status: { type: 'string', enum: Object.values(OrganizationStatus) }
  },
  additionalProperties: false
}; 