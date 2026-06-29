// Aurora DSQL IAM Authentication
// Generates short-lived auth tokens for database connections

import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { DSQLAuthToken, DSQLConfig } from '@/types/dsql';

const TOKEN_REFRESH_BUFFER_MS = 60 * 1000; // Refresh 1 minute before expiry

let cachedToken: DSQLAuthToken | null = null;

export async function generateAuthToken(config: DSQLConfig): Promise<DSQLAuthToken> {
  // Check if we have a valid cached token
  if (cachedToken && !isTokenExpired(cachedToken)) {
    return cachedToken;
  }

  const signer = new DsqlSigner({
    hostname: config.clusterEndpoint,
    region: config.region,
  });

  const token = await signer.getDbConnectAdminAuthToken();

  const authToken: DSQLAuthToken = {
    token,
    expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes from now
    hostname: config.clusterEndpoint,
    region: config.region,
  };

  cachedToken = authToken;
  return authToken;
}

export function isTokenExpired(token: DSQLAuthToken): boolean {
  return Date.now() >= token.expiresAt - TOKEN_REFRESH_BUFFER_MS;
}

export function clearCachedToken(): void {
  cachedToken = null;
}

export function getTokenRemainingMs(token: DSQLAuthToken): number {
  return Math.max(0, token.expiresAt - Date.now());
}

// For Vercel OIDC federation (serverless environments)
export async function generateAuthTokenWithOIDC(
  config: DSQLConfig,
  oidcToken?: string
): Promise<DSQLAuthToken> {
  // When running on Vercel, use OIDC token exchange
  // This allows serverless functions to get temporary AWS credentials

  if (!oidcToken) {
    // Fall back to regular IAM auth
    return generateAuthToken(config);
  }

  // In production, this would exchange the OIDC token with AWS STS
  // for temporary credentials, then generate the DSQL auth token
  // For now, we use the standard path
  return generateAuthToken(config);
}
