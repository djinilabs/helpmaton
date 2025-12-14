/**
 * Authorizer transformation logic
 */

const { convertIntegrationUri } = require('./methods');

/**
 * Transform HTTP API v2 authorizers to REST API authorizers
 * @param {Object} cloudformation - CloudFormation template
 * @param {string} restApiId - REST API resource ID (default: 'HTTP')
 * @returns {Object} Transformed authorizers and updated method references
 */
function transformAuthorizers(cloudformation, restApiId = 'HTTP') {
  const authorizers = {};
  const authorizerMap = {}; // Map old authorizer ID to new authorizer ID

  // Find all HTTP v2 authorizers
  for (const [resourceId, resource] of Object.entries(cloudformation.Resources || {})) {
    if (resource.Type === 'AWS::ApiGatewayV2::Authorizer') {
      const props = resource.Properties || {};
      
      // Determine authorizer type
      const authorizerType = props.AuthorizerType || 'REQUEST';
      
      // IAM authorizers don't require an Authorizer resource in REST API
      // They are configured directly on methods with AuthorizationType='AWS_IAM'
      if (authorizerType === 'IAM' || authorizerType === 'AWS_IAM') {
        // Skip creating an authorizer resource for IAM types
        // Methods using IAM authorizers will be handled in transform.js
        continue;
      }
      
      // Create REST API authorizer
      const newAuthorizerId = resourceId.replace('V2', '').replace('Http', 'HTTP');
      
      const restAuthorizer = {
        Type: 'AWS::ApiGateway::Authorizer',
        Properties: {
          RestApiId: { Ref: restApiId },
          Name: props.Name || newAuthorizerId,
          Type: mapAuthorizerType(authorizerType, props),
        },
      };

      // Map authorizer properties based on type
      if (authorizerType === 'JWT') {
        // REST API JWT authorizers: Use COGNITO_USER_POOLS if using Cognito, otherwise TOKEN
        // Check if JWT configuration indicates Cognito (has Issuer pointing to Cognito)
        // Note: This transformation assumes Cognito for COGNITO_USER_POOLS type.
        // If the JWT authorizer uses a different identity provider, it will be transformed
        // to TOKEN type, which may require additional configuration in REST API.
        const isCognito = props.JwtConfiguration?.Issuer?.includes('cognito-idp') || 
                         props.JwtConfiguration?.Issuer?.includes('amazoncognito.com');
        
        if (isCognito) {
          restAuthorizer.Properties.Type = 'COGNITO_USER_POOLS';
        } else {
          // For non-Cognito JWT providers, use TOKEN type
          // Note: Non-Cognito JWT providers may require additional configuration
          restAuthorizer.Properties.Type = 'TOKEN';
        }
        
        restAuthorizer.Properties.IdentitySource = props.IdentitySource || 'method.request.header.Authorization';
        
        if (props.JwtConfiguration) {
          // Map JWT configuration
          if (props.JwtConfiguration.Audience && Array.isArray(props.JwtConfiguration.Audience)) {
            restAuthorizer.Properties.ProviderARNs = props.JwtConfiguration.Audience;
          } else if (props.JwtConfiguration.Audience) {
            restAuthorizer.Properties.ProviderARNs = [props.JwtConfiguration.Audience];
          }
          if (props.JwtConfiguration.Issuer) {
            restAuthorizer.Properties.AuthorizerResultTtlInSeconds = props.AuthorizerResultTtlInSeconds || 300;
          }
        }
      } else if (authorizerType === 'REQUEST' || authorizerType === 'LAMBDA') {
        // Keep REQUEST type for REST API (REST API does support REQUEST authorizers)
        restAuthorizer.Properties.Type = 'REQUEST';
        // Convert AuthorizerUri if it's in OpenAPI string format
        restAuthorizer.Properties.AuthorizerUri = convertIntegrationUri(props.AuthorizerUri);
        restAuthorizer.Properties.AuthorizerCredentials = props.AuthorizerCredentials;
        // Configure IdentitySource to forward Authorization header
        // This allows the authorizer to access Bearer tokens
        // Note: Header names must be lowercase in IdentitySource
        // Note: method.request.path is not a valid identity source - path is available in methodArn
        restAuthorizer.Properties.IdentitySource = props.IdentitySource || 
          'method.request.header.authorization';
        restAuthorizer.Properties.AuthorizerResultTtlInSeconds = props.AuthorizerResultTtlInSeconds || 300;
      }

      // Remove undefined properties
      Object.keys(restAuthorizer.Properties).forEach(key => {
        if (restAuthorizer.Properties[key] === undefined) {
          delete restAuthorizer.Properties[key];
        }
      });

      authorizers[newAuthorizerId] = restAuthorizer;
      authorizerMap[resourceId] = newAuthorizerId;
    }
  }

  return {
    authorizers,
    authorizerMap,
  };
}

/**
 * Map HTTP API v2 authorizer type to REST API authorizer type
 * @param {string} v2Type - HTTP API v2 authorizer type
 * @param {Object} props - Authorizer properties
 * @returns {string} REST API authorizer type
 */
function mapAuthorizerType(v2Type, props) {
  switch (v2Type) {
    case 'JWT':
      return 'TOKEN';
    case 'REQUEST':
    case 'LAMBDA':
      // Keep REQUEST type for REST API (REST API does support REQUEST authorizers)
      return 'REQUEST';
    default:
      return 'TOKEN';
  }
}

module.exports = {
  transformAuthorizers,
};

