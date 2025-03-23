import { RouterBroker } from '@api/abstract/abstract.router';
import { CreateOrganizationDto, OrganizationDto, UpdateOrganizationDto } from '@api/dto/organization.dto';
import { organizationController } from '@api/server.module';
import { ConfigService } from '@config/env.config';
import { createOrganizationSchema, forceDeleteOrganizationSchema, getOrganizationSchema, listOrganizationsSchema, updateOrganizationSchema } from '@validate/organization.schema';
import { Request, RequestHandler, Router } from 'express';
import { JSONSchema7 } from 'json-schema';
import { validate } from 'jsonschema';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';

import { HttpStatus } from './index.router';

type OrganizationDataValidate<T, R> = {
  request: Request;
  schema: JSONSchema7;
  ClassRef: any;
  execute: (data: T) => Promise<R>;
};

export class OrganizationRouter extends RouterBroker {
  private logger = new Logger('OrganizationRouter');

  constructor(
    readonly configService: ConfigService,
    ...guards: RequestHandler[]
  ) {
    super();
    this.router
      .post('/', ...guards, async (req, res) => {
        const response = await this.organizationDataValidate<CreateOrganizationDto, OrganizationDto>({
          request: req,
          schema: createOrganizationSchema,
          ClassRef: CreateOrganizationDto,
          execute: (data) => organizationController.createOrganization(data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .get('/', ...guards, async (req, res) => {
        const response = await this.organizationDataValidate<any, OrganizationDto[]>({
          request: req,
          schema: listOrganizationsSchema,
          ClassRef: Object,
          execute: (data) => organizationController.findAllOrganizations(data?.status ? { status: data.status as string } : undefined),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get('/:id', ...guards, async (req, res) => {
        const { id } = req.params;
        
        try {
          if (!id || typeof id !== 'string') {
            throw new BadRequestException('Invalid organization ID');
          }
          
          const organization = await organizationController.findOrganizationById(id);
          
          return res.status(HttpStatus.OK).json(organization);
        } catch (error) {
          this.logger.error(`Error fetching organization ${id}: ${error.message}`);
          throw error;
        }
      })
      .put('/:id', ...guards, async (req, res) => {
        const { id } = req.params;
        
        const response = await this.organizationDataValidate<UpdateOrganizationDto, OrganizationDto>({
          request: req,
          schema: updateOrganizationSchema,
          ClassRef: UpdateOrganizationDto,
          execute: (data) => organizationController.updateOrganization(id, data),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .delete('/:id', ...guards, async (req, res) => {
        const { id } = req.params;
        
        try {
          if (!id || typeof id !== 'string') {
            throw new BadRequestException('Invalid organization ID');
          }
          
          await organizationController.deleteOrganization(id);
          
          return res.status(HttpStatus.OK).json({ 
            success: true, 
            message: 'Organization successfully deleted' 
          });
        } catch (error) {
          this.logger.error(`Error deleting organization ${id}: ${error.message}`);
          throw error;
        }
      })
      .delete('/:id/force', ...guards, async (req, res) => {
        const { id } = req.params;
        
        try {
          if (!id || typeof id !== 'string') {
            throw new BadRequestException('Invalid organization ID');
          }
          
          await organizationController.forceDeleteOrganization(id);
          
          return res.status(HttpStatus.OK).json({ 
            success: true, 
            message: 'Organization and all associated instances were successfully deleted' 
          });
        } catch (error) {
          this.logger.error(`Error force deleting organization ${id}: ${error.message}`);
          throw error;
        }
      })
      .get('/:id/instances', ...guards, async (req, res) => {
        const { id } = req.params;
        
        try {
          if (!id || typeof id !== 'string') {
            throw new BadRequestException('Invalid organization ID');
          }
          
          const instances = await organizationController.findInstancesByOrganizationId(id);
          
          return res.status(HttpStatus.OK).json(instances);
        } catch (error) {
          this.logger.error(`Error fetching instances for organization ${id}: ${error.message}`);
          throw error;
        }
      });
  }

  private async organizationDataValidate<T, R>(args: OrganizationDataValidate<T, R>): Promise<R> {
    const { request, schema, ClassRef, execute } = args;

    const ref = new ClassRef();
    const body = request.body;

    Object.assign(ref, body);

    const v = schema ? validate(ref, schema) : { valid: true, errors: [] };

    if (!v.valid) {
      const message: any[] = v.errors.map(({ stack, schema }) => {
        let message: string;
        if (schema['description']) {
          message = String(schema['description']);
        } else {
          message = String(stack).replace('instance.', '');
        }
        return message;
      });

      this.logger.error(message);
      throw new BadRequestException(message);
    }

    try {
      if (schema) {
        return await execute(ref);
      }

      const queryData = request.query || {};
      if (request.params?.id) {
        Object.assign(queryData, { id: request.params.id });
      }

      return await execute(queryData as T);
    } catch (error) {
      throw error;
    }
  }

  public readonly router: Router = Router();
} 