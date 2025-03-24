import { BadRequestException, InternalServerErrorException } from '@exceptions';
import { PrismaRepository } from '@api/repository/repository.service';
import { CreateOrganizationDto, OrganizationDto, OrganizationStatus, UpdateOrganizationDto } from '@api/dto/organization.dto';
import { ConfigService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import i18n from '@utils/i18n';

export class OrganizationService {
  private readonly logger = new Logger('OrganizationService');

  constructor(
    private readonly prismaRepository: PrismaRepository,
    private readonly configService: ConfigService,
  ) {}

  async createOrganization(data: CreateOrganizationDto): Promise<OrganizationDto> {
    try {
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        throw new BadRequestException(i18n.t('organization.disable'));
      }

      const organization = await this.prismaRepository.organization.create({
        data: {
          name: data.name,
          description: data.description,
          instanceLimit: data.instanceLimit || this.configService.get('ORGANIZATION').DEFAULT_INSTANCE_LIMIT,
          status: data.status || OrganizationStatus.ACTIVE,
        },
      });

      return {
        id: organization.id,
        name: organization.name,
        description: organization.description,
        instanceLimit: organization.instanceLimit,
        status: organization.status as unknown as OrganizationStatus,
        instanceCount: 0,
      };
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error.message);
    }
  }

  async findAllOrganizations(filter?: { status?: string }): Promise<OrganizationDto[]> {
    try {
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        throw new BadRequestException(i18n.t('organization.disable'));
      }

      const where: any = {};
      if (filter?.status) {
        where.status = filter.status;
      }

      const organizations = await this.prismaRepository.organization.findMany({
        where,
        orderBy: { name: 'asc' },
      });

      const result = await Promise.all(
        organizations.map(async (org) => {
          const instanceCount = await this.prismaRepository.instance.count({
            where: { organizationId: org.id },
          });

          return {
            id: org.id,
            name: org.name,
            description: org.description,
            instanceLimit: org.instanceLimit,
            status: org.status as unknown as OrganizationStatus,
            instanceCount,
          };
        }),
      );

      return result;
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error.message);
    }
  }

  async findOrganizationById(id: string): Promise<OrganizationDto> {
    try {
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        throw new BadRequestException(i18n.t('organization.disable'));
      }

      const organization = await this.prismaRepository.organization.findUnique({
        where: { id },
      });

      if (!organization) {
        throw new BadRequestException('Organization not found');
      }

      const instanceCount = await this.prismaRepository.instance.count({
        where: { organizationId: id },
      });

      return {
        id: organization.id,
        name: organization.name,
        description: organization.description,
        instanceLimit: organization.instanceLimit,
        status: organization.status as unknown as OrganizationStatus,
        instanceCount,
      };
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error.message);
    }
  }

  async updateOrganization(id: string, data: UpdateOrganizationDto): Promise<OrganizationDto> {
    try {
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        throw new BadRequestException(i18n.t('organization.disable'));
      }

      const organization = await this.prismaRepository.organization.findUnique({
        where: { id },
      });

      if (!organization) {
        throw new BadRequestException('Organization not found');
      }

      const updatedOrganization = await this.prismaRepository.organization.update({
        where: { id },
        data: {
          name: data.name !== undefined ? data.name : organization.name,
          description: data.description !== undefined ? data.description : organization.description,
          instanceLimit: data.instanceLimit !== undefined ? data.instanceLimit : organization.instanceLimit,
          status: data.status !== undefined ? data.status : organization.status,
        },
      });

      const instanceCount = await this.prismaRepository.instance.count({
        where: { organizationId: id },
      });

      return {
        id: updatedOrganization.id,
        name: updatedOrganization.name,
        description: updatedOrganization.description,
        instanceLimit: updatedOrganization.instanceLimit,
        status: updatedOrganization.status as unknown as OrganizationStatus,
        instanceCount,
      };
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error.message);
    }
  }

  async deleteOrganization(id: string): Promise<void> {
    try {
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        throw new BadRequestException(i18n.t('organization.disable'));
      }

      // Verificar se existem instâncias associadas a esta organização
      const instanceCount = await this.prismaRepository.instance.count({
        where: { organizationId: id },
      });

      if (instanceCount > 0) {
        throw new BadRequestException('Não é possível excluir uma organização com instâncias associadas');
      }

      await this.prismaRepository.organization.delete({
        where: { id },
      });
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error.message);
    }
  }

  async forceDeleteOrganization(id: string): Promise<void> {
    try {
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        throw new BadRequestException(i18n.t('organization.disable'));
      }

      // Check if the organization exists
      const organization = await this.prismaRepository.organization.findUnique({
        where: { id },
      });

      if (!organization) {
        throw new BadRequestException('Organization not found');
      }

      // Get all instances associated with this organization
      const instances = await this.prismaRepository.instance.findMany({
        where: { organizationId: id },
      });

      // Delete all associated instances
      if (instances.length > 0) {
        this.logger.log(`Deleting ${instances.length} instances associated with organization ${id}`);
        
        // Delete each instance individually
        for (const instance of instances) {
          await this.prismaRepository.instance.delete({
            where: { id: instance.id },
          });
        }
      }

      // Delete the organization
      await this.prismaRepository.organization.delete({
        where: { id },
      });

      this.logger.log(`Organization ${id} successfully deleted, along with ${instances.length} instances`);
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error.message);
    }
  }

  /**
   * Utility method to find an organization by token
   * @param token The organization token
   * @returns The organization data or null if not found or feature disabled
   */
  async getOrganizationByToken(token: string): Promise<any> {
    try {
      // Check if organization feature is enabled
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        return null;
      }

      // Find the organization with the specified token
      const organization = await this.prismaRepository.organization.findFirst({
        where: { token },
      });

      if (!organization) {
        return null;
      }

      return organization;
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }
} 