import { prismaRepository } from '@api/server.module';
import { Auth, configService } from '@config/env.config';
import { Logger } from '@config/logger.config';

const logger = new Logger('OrganizationUtil');

/**
 * Check if a given token is a global API key
 * @param token The token to check
 * @returns true if the token is the global API key
 */
export function isGlobalApiKey(token: string): boolean {
  const env = configService.get<Auth>('AUTHENTICATION').API_KEY;
  return env.KEY === token;
}

/**
 * Diagnostic function to detailed check an organization token
 * @param token The organization token to check
 */
export async function diagnosticTokenCheck(token: string): Promise<any> {
  logger.debug(`Running detailed diagnostics for token: ${token}`);
  
  try {
    // Check exact token
    const exactMatch = await prismaRepository.organization.findFirst({
      where: { token }
    });
    
    // Check token with trim
    const trimmedMatch = await prismaRepository.organization.findFirst({
      where: { token: token.trim() }
    });
    
    // Check token with case insensitivity
    const caseInsensitiveMatch = await prismaRepository.organization.findFirst({
      where: { 
        token: {
          equals: token,
          mode: 'insensitive'
        }
      }
    });
    
    // Check using like query
    const likeMatch = await prismaRepository.organization.findFirst({
      where: {
        token: {
          contains: token
        }
      }
    });
    
    // Check all organizations
    const allOrgs = await prismaRepository.organization.findMany({
      select: {
        id: true,
        name: true,
        token: true
      }
    });
    
    // Build diagnostic results
    const results = {
      inputToken: token,
      tokenLength: token.length,
      exactMatch: !!exactMatch ? { id: exactMatch.id, name: exactMatch.name } : null,
      trimmedMatch: !!trimmedMatch ? { id: trimmedMatch.id, name: trimmedMatch.name } : null,
      caseInsensitiveMatch: !!caseInsensitiveMatch ? { id: caseInsensitiveMatch.id, name: caseInsensitiveMatch.name } : null,
      likeMatch: !!likeMatch ? { id: likeMatch.id, name: likeMatch.name } : null,
      allOrganizations: allOrgs.map(org => ({
        id: org.id,
        name: org.name,
        token: org.token,
        tokenLength: org.token.length,
        matches: org.token === token
      }))
    };
    
    logger.debug(`Diagnostic results: ${JSON.stringify(results, null, 2)}`);
    return results;
  } catch (error) {
    logger.error(`Error during token diagnostic: ${error.message}`);
    throw error;
  }
}

/**
 * Find organization by token
 * @param token The organization token to look for
 * @returns The organization or null if not found or organization feature disabled
 */
export async function findOrganizationByToken(token: string): Promise<any | null> {
  try {
    // Skip if token is global API key or organization feature is disabled
    if (isGlobalApiKey(token) || !configService.get('ORGANIZATION').ENABLED) {
      return null;
    }

    // Try to find using exact match
    let organization = await prismaRepository.organization.findFirst({
      where: { token }
    });

    // If not found, try with more flexibility
    if (!organization) {
      // Try with trim()
      organization = await prismaRepository.organization.findFirst({
        where: { token: token.trim() }
      });
      
      // Try case insensitive if still not found
      if (!organization) {
        organization = await prismaRepository.organization.findFirst({
          where: { 
            token: {
              equals: token,
              mode: 'insensitive'
            }
          }
        });
      }
    }

    return organization;
  } catch (error) {
    logger.error(`Error finding organization by token: ${error.message}`);
    return null;
  }
}

/**
 * Check if a token is a valid organization token
 * @param token The token to check
 * @returns true if the token belongs to an organization
 */
export async function isOrganizationToken(token: string): Promise<boolean> {
  const organization = await findOrganizationByToken(token);
  return !!organization;
}

/**
 * Get an organization ID from a token
 * @param token The token to check
 * @returns The organization ID or null if not found
 */
export async function getOrganizationIdFromToken(token: string): Promise<string | null> {
  const organization = await findOrganizationByToken(token);
  return organization?.id || null;
} 