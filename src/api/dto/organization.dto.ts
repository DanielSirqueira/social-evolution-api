import { Prisma } from '@prisma/client';

export enum OrganizationStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE'
}

export class CreateOrganizationDto {
  name: string;
  description?: string;
  instanceLimit?: number;
  status?: OrganizationStatus;
}

export class UpdateOrganizationDto {
  name?: string;
  description?: string;
  instanceLimit?: number;
  status?: OrganizationStatus;
}

export class OrganizationDto {
  id: string;
  name: string;
  description?: string;
  instanceLimit: number;
  status: OrganizationStatus;
  instanceCount?: number;
} 