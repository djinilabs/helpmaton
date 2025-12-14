# Troubleshooting Guide

Common issues and solutions when using the HTTP to REST API transformation plugin.

## Plugin Not Running

### Symptoms
- HTTP API v2 resources still present in CloudFormation
- No transformation occurring

### Solutions

1. **Check Plugin Order**: Ensure `http-to-rest` is listed **before** `custom-domain` in `app.arc`:
   ```arc
   @plugins
   http-to-rest
   custom-domain
   ```

2. **Verify Plugin Path**: Check that the plugin is in the correct location:
   ```
   apps/backend/src/plugins/http-to-rest/
   ```

3. **Check Logs**: Look for plugin execution logs during deployment:
   ```bash
   arc deploy --verbose
   ```

## Routes Not Working

### Symptoms
- 404 errors on routes
- Method not allowed errors
- Routes missing after deployment

### Solutions

1. **Check Resource Hierarchy**: Verify that resources are created correctly:
   ```bash
   aws cloudformation describe-stack-resources --stack-name your-stack \
     --query "StackResources[?ResourceType=='AWS::ApiGateway::Resource']"
   ```

2. **Verify Methods**: Check that methods are created:
   ```bash
   aws cloudformation describe-stack-resources --stack-name your-stack \
     --query "StackResources[?ResourceType=='AWS::ApiGateway::Method']"
   ```

3. **Check Deployment**: Ensure deployment includes all methods:
   ```bash
   aws cloudformation describe-stack-resources --stack-name your-stack \
     --query "StackResources[?ResourceType=='AWS::ApiGateway::Deployment']"
   ```

4. **Review Route Parsing**: Check that route keys are parsed correctly. Common issues:
   - Wildcard routes (`/*`) need proper proxy resource
   - Path parameters (`:param`) should be converted to `{param}`
   - ANY methods should expand to all HTTP methods

## Custom Domain Issues

### Symptoms
- Custom domain returns 403 or connection errors
- Domain not mapping to API
- SSL certificate errors

### Solutions

1. **Check Plugin Order**: `custom-domain` must run **after** `http-to-rest`:
   ```arc
   @plugins
   http-to-rest
   custom-domain
   ```

2. **Verify Domain Resources**: Check that domain resources are created:
   ```bash
   aws cloudformation describe-stack-resources --stack-name your-stack \
     --query "StackResources[?ResourceType=='AWS::ApiGateway::DomainName']"
   ```

3. **Check Base Path Mapping**: Verify base path mapping exists:
   ```bash
   aws cloudformation describe-stack-resources --stack-name your-stack \
     --query "StackResources[?ResourceType=='AWS::ApiGateway::BasePathMapping']"
   ```

4. **Verify Route53 Records**: If using Route53, check DNS records:
   ```bash
   aws route53 list-resource-record-sets --hosted-zone-id YOUR_ZONE_ID
   ```

5. **Check Certificate**: Verify certificate ARN is correct and in the same region

## Authorizer Issues

### Symptoms
- Unauthorized errors on protected routes
- Authorizers not working
- 401 errors

### Solutions

1. **Check Authorizer Type**: Verify authorizer transformation:
   - JWT → `COGNITO_USER_POOLS`
   - Lambda/REQUEST → `TOKEN`
   - IAM → `AuthorizationType: AWS_IAM` on methods

2. **Verify Method Authorization**: Check method authorization types:
   ```bash
   aws apigateway get-method --rest-api-id YOUR_API_ID \
     --resource-id RESOURCE_ID --http-method GET
   ```

3. **Check Authorizer References**: Verify methods reference correct authorizers

4. **Test Authorizer Configuration**: Test authorizer directly if possible

## Lambda Integration Issues

### Symptoms
- Lambda functions not invoked
- 500 errors
- Function timeouts

### Solutions

1. **Verify Integration URIs**: Check that integration URIs are preserved:
   ```bash
   aws apigateway get-integration --rest-api-id YOUR_API_ID \
     --resource-id RESOURCE_ID --http-method GET
   ```

2. **Check Lambda Permissions**: Verify Lambda execution role has API Gateway invoke permissions:
   ```bash
   aws lambda get-policy --function-name YOUR_FUNCTION_NAME
   ```

3. **Verify Function ARNs**: Ensure Lambda function ARNs are correct

4. **Check Integration Type**: Verify integration type is `AWS_PROXY`

## CloudFormation Validation Errors

### Symptoms
- CloudFormation stack update fails
- Template validation errors
- Missing dependencies

### Solutions

1. **Check Resource Dependencies**: Verify all `DependsOn` attributes are correct:
   - Deployment depends on all methods
   - Stage depends on deployment
   - Methods depend on resources

2. **Verify Resource References**: Check that all `Ref` and `Fn::GetAtt` references are valid

3. **Check Resource Limits**: REST API has limits on resources and methods

4. **Review Template**: Export and review the transformed template:
   ```bash
   aws cloudformation get-template --stack-name your-stack
   ```

## Performance Issues

### Symptoms
- Increased latency
- Higher costs
- More cold starts

### Solutions

1. **Monitor Metrics**: Use CloudWatch to monitor:
   - API Gateway latency
   - Lambda invocation patterns
   - Error rates

2. **Compare Costs**: Review AWS billing to compare HTTP API v2 vs REST API costs

3. **Optimize Resources**: Consider:
   - Reducing number of resources
   - Consolidating routes
   - Using caching

## Debugging Tips

### Enable Verbose Logging

```bash
arc deploy --verbose
```

### Check CloudFormation Events

```bash
aws cloudformation describe-stack-events --stack-name your-stack \
  --max-items 20
```

### Review Plugin Logs

The plugin logs transformation steps. Look for:
- "Transforming HTTP API v2 to REST API..."
- "Transformation complete. Removed X HTTP v2 resources."

### Export Template

Export the transformed template to review:

```bash
aws cloudformation get-template --stack-name your-stack \
  --query 'TemplateBody' --output text > transformed-template.json
```

### Test Locally

You can test the transformation locally by:
1. Running `arc deploy --dry-run` (if supported)
2. Reviewing the generated CloudFormation template
3. Validating the template structure

## Getting Help

If you encounter issues not covered here:

1. Check CloudWatch logs for detailed error messages
2. Review the transformed CloudFormation template
3. Compare with the original HTTP API v2 template
4. Check AWS API Gateway documentation
5. Review plugin source code for transformation logic

## Common Error Messages

### "No HTTP API v2 found, skipping transformation"
- **Cause**: Plugin is running but no HTTP API v2 resources detected
- **Solution**: This is normal if you've already migrated or don't have HTTP API v2

### "No integration found for route"
- **Cause**: Route references an integration that doesn't exist
- **Solution**: Check route target references and integration resources

### "No resource found for path"
- **Cause**: Resource hierarchy not created correctly for a path
- **Solution**: Check route key parsing and resource creation logic

### "Domain configuration missing DomainName or CertificateArn"
- **Cause**: Custom domain configuration incomplete
- **Solution**: Ensure both DomainName and CertificateArn are provided

