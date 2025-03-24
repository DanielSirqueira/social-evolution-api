import { InstanceDto } from '@api/dto/instance.dto';
import { prismaRepository } from '@api/server.module';
import { Auth, configService, Database } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { ForbiddenException, UnauthorizedException } from '@exceptions';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('GUARD');

async function apikey(req: Request, _: Response, next: NextFunction) {
  const env = configService.get<Auth>('AUTHENTICATION').API_KEY;
  const key = req.get('apikey');
  const db = configService.get<Database>('DATABASE');

  if (!key) {
    logger.error('No API key provided in request headers');
    throw new UnauthorizedException();
  }

  // Global API Key has access to everything
  if (env.KEY === key) {
    logger.debug('Access granted via global API key');
    return next();
  }

  const param = req.params as unknown as InstanceDto;

  try {
    // Check if the token belongs to an organization
    if (configService.get('ORGANIZATION').ENABLED) {
      logger.debug(`Checking organization token for: ${key}`);
      
      const organization = await prismaRepository.organization.findFirst({
        where: { token: key },
      });

      if (organization) {
        logger.debug(`Access attempt using organization token: ${organization.id} - ${organization.name}`);
        
        // Organization-specific routes
        if (req.originalUrl.includes(`/organization/${organization.id}`)) {
          logger.debug(`Organization accessing its own data: ${organization.id}`);
          return next();
        }

        // Access to listing all organizations is not allowed with organization token
        if (req.originalUrl === '/organization' || req.originalUrl.startsWith('/organization?')) {
          logger.debug(`Organization token tried to access all organizations list: ${organization.id}`);
          throw new ForbiddenException('Access denied', 'Organization token cannot access other organizations');
        }

        // Allow access to /organization/token route with organization token
        if (req.originalUrl === '/organization/token') {
          logger.debug(`Organization accessing its own data by token: ${organization.id}`);
          return next();
        }

        // Access to other organizations is not allowed
        if (req.originalUrl.includes('/organization/')) {
          const urlParts = req.originalUrl.split('/');
          const targetOrgId = urlParts[urlParts.indexOf('organization') + 1]?.split('?')[0];
          
          if (targetOrgId && targetOrgId !== organization.id) {
            logger.debug(`Organization tried to access another organization: ${organization.id} -> ${targetOrgId}`);
            throw new ForbiddenException('Access denied', 'Organization token cannot access other organizations');
          }
        }

        // Access to organization's instances
        if (param?.instanceName) {
          const instance = await prismaRepository.instance.findUnique({
            where: { name: param.instanceName },
          });
          
          if (instance && instance.organizationId === organization.id) {
            logger.debug(`Organization accessing its instance: ${organization.id} -> ${instance.name}`);
            return next();
          } else {
            logger.debug(`Organization tried to access non-owned instance: ${organization.id} -> ${param.instanceName}`);
            throw new ForbiddenException('Access denied', 'Organization token cannot access instances from other organizations');
          }
        }

        // List all instances of the organization
        if (req.originalUrl.includes('/instance/fetchInstances')) {
          // Modify the request to filter only instances from the organization
          req.query.organizationId = organization.id;
          logger.debug(`Organization listing its instances: ${organization.id}`);
          return next();
        }

        // Create new instance for the organization
        if (req.originalUrl.includes('/instance/create')) {
          // Force the instance to be linked to the organization
          if (req.body) {
            req.body.organizationId = organization.id;
            logger.debug(`Organization creating new instance: ${organization.id}`);
            return next();
          }
        }
      }
    }

    // Check instance token (original logic)
    if (param?.instanceName) {
      const instance = await prismaRepository.instance.findUnique({
        where: { name: param.instanceName },
      });
      if (instance && instance.token === key) {
        logger.debug(`Instance accessing itself: ${instance.name}`);
        return next();
      }
    } else {
      if (req.originalUrl.includes('/instance/fetchInstances') && db.SAVE_DATA.INSTANCE) {
        const instanceByKey = await prismaRepository.instance.findFirst({
          where: { token: key },
        });
        if (instanceByKey) {
          // Limit the response only to the instance itself
          req.query.instanceName = instanceByKey.name;
          logger.debug(`Instance accessing instance list (filtered to self): ${instanceByKey.name}`);
          return next();
        }
      }
    }
  } catch (error) {
    if (error instanceof ForbiddenException) {
      throw error;
    }
    logger.error(error);
  }

  throw new UnauthorizedException();
}

export const authGuard = { apikey };
