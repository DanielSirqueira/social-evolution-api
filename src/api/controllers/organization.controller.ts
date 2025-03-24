import { BadRequestException, InternalServerErrorException } from '@exceptions';
import { CreateOrganizationDto, OrganizationDto, OrganizationStatus, UpdateOrganizationDto } from '@api/dto/organization.dto';
import { ConfigService } from '@config/env.config';
import { CacheConf, Chatwoot } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { PrismaRepository } from '@api/repository/repository.service';
import i18n from '@utils/i18n';
import { WAMonitoringService } from '@api/services/monitor.service';
import { CacheService } from '@api/services/cache.service';
import { Events } from '@api/types/wa.types';
import EventEmitter2 from 'eventemitter2';
import { v4 } from 'uuid';
import { diagnosticTokenCheck } from '@api/utils/organization.util';
import { Auth } from '@config/env.config';

export class OrganizationController {
  private readonly logger = new Logger('OrganizationController');

  constructor(
    private readonly prismaRepository: PrismaRepository,
    private readonly configService: ConfigService,
    private readonly waMonitor: WAMonitoringService,
    private readonly cache: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  async createOrganization(data: CreateOrganizationDto): Promise<OrganizationDto> {
    try {
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        throw new BadRequestException(i18n.t('organization.disable'));
      }

      // Generate a token using UUID v4 in uppercase format
      let token: string;
      if (!data.token) {
        token = v4().toUpperCase();
      } else {
        token = data.token;
      }

      const organization = await this.prismaRepository.organization.create({
        data: {
          name: data.name,
          description: data.description || null,
          instanceLimit: data.instanceLimit || 5,
          status: data.status || OrganizationStatus.ACTIVE,
          token: token,
        },
      });

      // Clear organization listing cache after creating a new one
      if (this.configService.get<CacheConf>('CACHE').REDIS.ENABLED) {
        try {
          await this.cache.deleteAll('organization:*');
          this.logger.log(`Cache cleared after creating organization ${organization.id}`);
        } catch (cacheError) {
          this.logger.error(`Error clearing cache after creating organization: ${cacheError.message}`);
        }
      }

      return {
        id: organization.id,
        name: organization.name,
        description: organization.description,
        instanceLimit: organization.instanceLimit,
        status: organization.status as unknown as OrganizationStatus,
        instanceCount: 0,
        token: organization.token,
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
            token: org.token,
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
        token: organization.token,
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
          token: data.token !== undefined ? data.token : organization.token,
        },
      });

      // Clear organization cache
      if (this.configService.get<CacheConf>('CACHE').REDIS.ENABLED) {
        try {
          await this.cache.delete(`organization:${id}`);
          await this.cache.deleteAll('organization:*');
          this.logger.log(`Cache cleared for organization ${id}`);
        } catch (cacheError) {
          this.logger.error(`Error clearing cache for organization: ${cacheError.message}`);
        }
      }

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
        token: updatedOrganization.token,
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

      // Validate if organization ID is valid
      if (!id || typeof id !== 'string') {
        throw new BadRequestException('Invalid organization ID');
      }

      // Check if organization exists
      const organization = await this.prismaRepository.organization.findUnique({
        where: { id },
      });

      if (!organization) {
        throw new BadRequestException('Organization not found');
      }

      // Check if there are instances associated with this organization
      const instanceCount = await this.prismaRepository.instance.count({
        where: { organizationId: id },
      });

      if (instanceCount > 0) {
        throw new BadRequestException(`Cannot delete organization because it has ${instanceCount} associated instances. Use the route /organization/${id}/force to force delete.`);
      }

      // If there are no instances, proceed with normal deletion
      await this.prismaRepository.organization.delete({
        where: { id },
      });

      // Clear organization cache
      if (this.configService.get<CacheConf>('CACHE').REDIS.ENABLED) {
        try {
          await this.cache.delete(`organization:${id}`);
          await this.cache.deleteAll('organization:*');
          this.logger.log(`Cache cleared for organization ${id}`);
        } catch (cacheError) {
          this.logger.error(`Error clearing cache for organization: ${cacheError.message}`);
        }
      }

      this.logger.log(`Organization ${id} successfully deleted`);
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

      // Validate if organization ID is valid
      if (!id || typeof id !== 'string') {
        throw new BadRequestException('Invalid organization ID');
      }

      // Check if organization exists
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

      // If there are no instances, use normal deletion method
      if (instances.length === 0) {
        this.logger.log(`Organization ${id} has no instances, using normal deletion method`);
        await this.prismaRepository.organization.delete({
          where: { id },
        });

        // Clear organization cache
        await this.cache.delete(`organization:${id}`);
        await this.cache.deleteAll(`*${id}*`);
        await this.cache.deleteAll('organization:*');
        
        this.logger.log(`Organization ${id} successfully deleted`);
        return;
      }

      // Delete all associated instances
      this.logger.log(`Deleting ${instances.length} instances associated with organization ${id}`);
      
      // Delete each instance individually
      for (const instance of instances) {
        try {
          this.logger.log(`Starting deletion of instance ${instance.name} (${instance.id})`);
          
          // Use the same flow as deleteInstance from InstanceController
          const waInstance = this.waMonitor.waInstances[instance.name];
          
          // Check connection state
          const connectionState = waInstance?.connectionStatus?.state;
          this.logger.log(`Instance ${instance.name} connection state: ${connectionState || 'unknown'}`);
          
          // Clear Chatwoot cache if enabled
          if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && waInstance) {
            this.logger.log(`Clearing Chatwoot cache for instance ${instance.name}`);
            waInstance.clearCacheChatwoot();
          }
          
          // If instance is connected or connecting, log out
          if (waInstance && (connectionState === 'connecting' || connectionState === 'open')) {
            this.logger.log(`Logging out instance ${instance.name}`);
            try {
              waInstance.logoutInstance();
            } catch (logoutError) {
              this.logger.error(`Error logging out instance ${instance.name}: ${logoutError.message}`);
            }
          }
          
          // Send deletion webhook for the instance
          if (waInstance) {
            try {
              this.logger.log(`Sending deletion webhook for instance ${instance.name}`);
              waInstance.sendDataWebhook(Events.INSTANCE_DELETE, {
                instanceName: instance.name,
                instanceId: instance.id,
              });
            } catch (webhookError) {
              this.logger.error(`Error sending deletion webhook for instance ${instance.name}: ${webhookError.message}`);
            }
          }
          
          // Emit remove event (same as deleteInstance)
          this.logger.log(`Emitting removal event for instance ${instance.name}`);
          this.eventEmitter.emit('remove.instance', instance.name, 'inner');
          
          // The remove.instance event triggers cleaningUp in WAMonitoringService
          // which already handles cache cleaning and instance data, so we don't need
          // to do it manually here
          
          // Since cleaningUp is asynchronous, wait a bit to ensure it's completed
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Ensure the instance cache is cleared
          await this.clearInstanceCache(instance.name, instance.id);
          
        } catch (error) {
          this.logger.error(`Error processing deletion of instance ${instance.name} (${instance.id}): ${error.message}`);
        }
      }

      // After removing all instances, now remove the organization
      try {
        await this.prismaRepository.organization.delete({
          where: { id },
        });

        // Clear organization cache
        await this.cache.delete(`organization:${id}`);
        await this.cache.deleteAll(`*${id}*`);
        await this.cache.deleteAll('organization:*');
        
        this.logger.log(`Organization ${id} successfully deleted, along with ${instances.length} instances`);
      } catch (error) {
        this.logger.error(`Error deleting organization ${id}: ${error.message}`);
        throw new InternalServerErrorException(`Could not delete organization after deleting instances: ${error.message}`);
      }
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error.message);
    }
  }

  async findInstancesByOrganizationId(id: string): Promise<any[]> {
    try {
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        throw new BadRequestException(i18n.t('organization.disable'));
      }

      // Validate if the organization ID is valid
      if (!id || typeof id !== 'string') {
        throw new BadRequestException('Invalid organization ID');
      }

      // Check if the organization exists
      const organization = await this.prismaRepository.organization.findUnique({
        where: { id },
      });

      if (!organization) {
        throw new BadRequestException('Organization not found');
      }

      // Get instances associated with the organization
      const instances = await this.prismaRepository.instance.findMany({
        where: { organizationId: id },
        select: {
          id: true,
          name: true,
          ownerJid: true,
          profileName: true,
          profilePicUrl: true,
          connectionStatus: true,
          number: true,
          integration: true
        }
      });

      return instances;
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error.message);
    }
  }

  /**
   * Clears the cache of a specific instance
   * @param instanceName - Instance name
   * @param instanceId - Instance ID (optional)
   */
  private async clearInstanceCache(instanceName: string, instanceId?: string): Promise<void> {
    try {
      this.logger.log(`Clearing cache for instance ${instanceName}`);
      
      // Clear cache by instance name
      await this.cache.delete(instanceName);
      
      // If instance ID is provided, clear that too
      if (instanceId) {
        await this.cache.delete(instanceId);
      }
      
      // Clear patterns that contain the instance name
      await this.cache.deleteAll(`*${instanceName}*`);
      
      // If instance ID is provided, clear patterns that contain it
      if (instanceId) {
        await this.cache.deleteAll(`*${instanceId}*`);
      }
      
      this.logger.log(`Cache for instance ${instanceName} successfully cleared`);
    } catch (error) {
      this.logger.error(`Error clearing instance cache for ${instanceName}: ${error.message}`);
    }
  }

  /**
   * Clears the cache of all instances associated with an organization
   * @param organizationId - Organization ID
   */
  public async clearOrganizationInstancesCache(organizationId: string): Promise<void> {
    try {
      this.logger.log(`Clearing cache for all instances in organization ${organizationId}`);
      
      // Find all instances in the organization
      const instances = await this.prismaRepository.instance.findMany({
        where: { organizationId },
        select: { id: true, name: true }
      });
      
      if (instances.length === 0) {
        this.logger.log(`No instances found for organization ${organizationId}`);
        return;
      }
      
      // Clear cache for each instance
      for (const instance of instances) {
        await this.clearInstanceCache(instance.name, instance.id);
      }
      
      // Clear organization cache
      await this.cache.delete(`organization:${organizationId}`);
      await this.cache.deleteAll(`*${organizationId}*`);
      await this.cache.deleteAll('organization:*');
      
      this.logger.log(`Cache for ${instances.length} instances in organization ${organizationId} successfully cleared`);
    } catch (error) {
      this.logger.error(`Error clearing cache for instances in organization ${organizationId}: ${error.message}`);
    }
  }

  /**
   * Find an organization by its token
   * @param token The organization token
   * @returns The organization data or null if not found
   */
  async findOrganizationByToken(token: string): Promise<OrganizationDto | null> {
    try {
      this.logger.log(`Searching for organization with token: ${token}`);
      
      // Check if organization feature is enabled
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        this.logger.debug('Organization feature is disabled');
        throw new BadRequestException('Organization feature is disabled');
      }

      // Validate if token was provided
      if (!token || typeof token !== 'string') {
        this.logger.debug('Invalid organization token provided');
        throw new BadRequestException('Invalid organization token');
      }

      // Log the token for debugging
      this.logger.debug(`Finding organization with token: "${token}" (length: ${token.length})`);

      // Find organization by token - direct query to match auth.guard.ts
      const organization = await this.prismaRepository.organization.findFirst({
        where: { token }
      });

      if (!organization) {
        // Log all organizations for debugging
        const allOrganizations = await this.prismaRepository.organization.findMany({
          select: {
            id: true,
            name: true,
            token: true
          }
        });
        
        this.logger.debug(`Available organizations: ${JSON.stringify(allOrganizations.map(o => ({
          id: o.id,
          name: o.name,
          token: o.token,
          tokenLength: o.token.length
        })))}`);
        
        this.logger.error(`No organization found with token: ${token}`);
        throw new BadRequestException('Organization not found');
      }

      this.logger.log(`Found organization by token: ${organization.id} - ${organization.name}`);

      // Count instances for this organization
      const instanceCount = await this.prismaRepository.instance.count({
        where: { organizationId: organization.id }
      });
      
      // Return the organization data
      return {
        id: organization.id,
        name: organization.name,
        description: organization.description,
        instanceLimit: organization.instanceLimit,
        status: organization.status as unknown as OrganizationStatus,
        instanceCount,
        token: organization.token
      };
    } catch (error) {
      this.logger.error(`Error finding organization by token: ${error.message || JSON.stringify(error)}`);
      throw error;
    }
  }

  /**
   * Find organization by token directly - optimized for /organization/token route
   * @param token The organization token
   * @returns The organization data with instance count
   */
  async findOrganizationByTokenDirect(token: string): Promise<any> {
    try {
      this.logger.log(`Direct token lookup for: "${token}"`);
      
      // Check if organization feature is enabled
      if (!this.configService.get('ORGANIZATION').ENABLED) {
        this.logger.debug('Organization feature is disabled');
        throw new BadRequestException('Organization feature is disabled');
      }

      // Validate token
      if (!token) {
        this.logger.debug('No token provided');
        throw new BadRequestException('API key is required in request headers');
      }
      
      // Check if it's the global API key
      const env = this.configService.get<Auth>('AUTHENTICATION').API_KEY;
      if (env.KEY === token) {
        this.logger.debug('Token is global API key, not valid for this endpoint');
        throw new BadRequestException('Global API key is not valid for this endpoint, use an organization token');
      }

      // Direct database lookup
      this.logger.debug(`Looking for organization with token: "${token}"`);
      const organization = await this.prismaRepository.organization.findFirst({
        where: { token }
      });
      
      if (!organization) {
        // Log available organizations for debugging
        const allOrgs = await this.prismaRepository.organization.findMany({
          select: {
            id: true,
            name: true,
            token: true
          }
        });
        
        this.logger.debug(`No organization found. Available organizations (${allOrgs.length}): ${JSON.stringify(allOrgs.map(o => ({
          id: o.id,
          name: o.name,
          token: `"${o.token}"`,
          tokenLength: o.token.length
        })))}`);
        
        throw new BadRequestException('No organization found with the provided token');
      }
      
      this.logger.log(`Found organization: ${organization.id} - ${organization.name}`);
      
      // Count instances for this organization
      const instanceCount = await this.prismaRepository.instance.count({
        where: { organizationId: organization.id }
      });
      
      // Format response
      return {
        id: organization.id,
        name: organization.name,
        description: organization.description,
        instanceLimit: organization.instanceLimit,
        status: organization.status as unknown as OrganizationStatus,
        instanceCount,
        token: organization.token
      };
    } catch (error) {
      this.logger.error(`Error in direct token lookup: ${error.message || JSON.stringify(error)}`);
      throw error;
    }
  }
} 