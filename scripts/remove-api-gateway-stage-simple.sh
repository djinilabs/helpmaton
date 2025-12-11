#!/bin/bash

# Simplified script to remove API Gateway stage resources
# This version processes resources more defensively to avoid jq errors

set -e

STACK_NAME="${1:-HelpmatonProduction}"
STAGE_NAME="${2:-default}"
TEMPLATE_FILE="cloudformation-template-${STACK_NAME}.json"
MODIFIED_TEMPLATE_FILE="cloudformation-template-${STACK_NAME}-modified.json"

echo "🚀 Removing API Gateway stage '${STAGE_NAME}' from stack '${STACK_NAME}'"
echo ""

# Export template
echo "📥 Exporting CloudFormation template..."
aws cloudformation get-template \
  --stack-name "${STACK_NAME}" \
  --query 'TemplateBody' \
  --output json > "${TEMPLATE_FILE}"

if [ ! -f "${TEMPLATE_FILE}" ] || [ ! -s "${TEMPLATE_FILE}" ]; then
  echo "❌ Error: Failed to export template"
  exit 1
fi

echo "✅ Template exported"
echo ""

# Use a simpler, more defensive jq script
echo "🔧 Removing stage-specific resources..."

jq --arg stageName "${STAGE_NAME}" '
  # Helper function to safely check if value is an object
  def is_object: type == "object";
  
  # Step 1: Remove Stage resources
  .Resources |= (
    to_entries | map(
      if (.value | is_object) and .value.Type == "AWS::ApiGateway::Stage" then
        if (.value.Properties.StageName // "") == $stageName then
          empty
        else
          .
        end
      else
        .
      end
    ) | from_entries
  ) |
  
  # Step 2: Remove Deployment resources
  .Resources |= (
    to_entries | map(
      if (.value | is_object) and .value.Type == "AWS::ApiGateway::Deployment" then
        empty
      else
        .
      end
    ) | from_entries
  ) |
  
  # Step 3: Update Usage Plans - remove ApiStages referencing the stage
  .Resources |= (
    to_entries | map(
      if (.value | is_object) and .value.Type == "AWS::ApiGateway::UsagePlan" then
        if .value.Properties.ApiStages then
          .value.Properties.ApiStages = (
            .value.Properties.ApiStages | 
            map(select((.Stage // "") != $stageName))
          ) |
          # Remove Usage Plan if no ApiStages remain
          if (.value.Properties.ApiStages | length) == 0 then
            empty
          else
            .
          end
        else
          .
        end
      else
        .
      end
    ) | from_entries
  ) |
  
  # Step 4: Remove BasePathMapping resources
  .Resources |= (
    to_entries | map(
      if (.value | is_object) and .value.Type == "AWS::ApiGateway::BasePathMapping" then
        if (.value.Properties.Stage // "") == $stageName then
          empty
        else
          .
        end
      else
        .
      end
    ) | from_entries
  ) |
  
  # Step 5: Clean up DependsOn references (simplified - just remove if string matches common patterns)
  .Resources |= (
    to_entries | map(
      if (.value | is_object) and .value.DependsOn then
        if (.value.DependsOn | type) == "array" then
          .value.DependsOn = (
            .value.DependsOn | 
            map(select(
              (. | type) == "string" and 
              (. | contains("Stage") | not) and 
              (. | contains("Deployment") | not)
            ))
          ) |
          if (.value.DependsOn | length) == 0 then
            del(.value.DependsOn)
          else
            .
          end
        elif (.value.DependsOn | type) == "string" then
          if (.value.DependsOn | contains("Stage")) or (.value.DependsOn | contains("Deployment")) then
            del(.value.DependsOn)
          else
            .
          end
        else
          .
        end
      else
        .
      end
    ) | from_entries
  ) |
  
  # Step 6: Remove outputs referencing stage name
  .Outputs |= (
    if .Outputs and (.Outputs | type) == "object" then
      .Outputs | to_entries | map(
        if (.value | is_object) and .value.Value then
          if ((.value.Value | tostring) | contains($stageName)) then
            empty
          else
            .
          end
        else
          .
        end
      ) | from_entries
    else
      {}
    end
  )
' "${TEMPLATE_FILE}" > "${MODIFIED_TEMPLATE_FILE}"

if [ $? -ne 0 ]; then
  echo "❌ Error: jq processing failed"
  exit 1
fi

echo "✅ Template modified successfully"
echo ""

# Validate the modified template
echo "🔍 Validating modified template..."
if aws cloudformation validate-template \
  --template-body "file://${MODIFIED_TEMPLATE_FILE}" \
  >/dev/null 2>&1; then
  echo "✅ Template validation successful"
else
  echo "⚠️  Template validation failed, but continuing..."
fi

echo ""
echo "🚀 Updating CloudFormation stack..."
echo ""
echo "⚠️  WARNING: This will update the CloudFormation stack and remove the stage!"
echo "   The stage will be recreated on the next deployment."
echo "   This will clear the authorizer cache and fix the 401 issues."
echo ""
read -p "   Update CloudFormation stack with modified template? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  # Upload template to S3 first (required for large templates)
  echo "📤 Uploading template to S3..."
  
  # Try to find an S3 bucket (check stack outputs first, then list buckets)
  BUCKET=$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
    --query 'Stacks[0].Outputs[?contains(OutputKey, `Bucket`) || contains(OutputKey, `bucket`)].OutputValue' \
    --output text 2>/dev/null | head -1)
  
  if [ -z "${BUCKET}" ] || [ "${BUCKET}" == "None" ]; then
    # Try to find any helpmaton-related bucket
    BUCKET=$(aws s3 ls 2>/dev/null | grep -i helpmaton | head -1 | awk '{print $3}')
  fi
  
  if [ -z "${BUCKET}" ]; then
    echo "❌ Error: Could not find S3 bucket for template upload"
    echo "   Please specify a bucket or create one for CloudFormation templates"
    exit 1
  fi
  
  echo "   Using S3 bucket: ${BUCKET}"
  
  # Upload template to S3
  TEMPLATE_KEY="cloudformation-templates/${STACK_NAME}-modified-$(date +%Y%m%d-%H%M%S).json"
  TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/${TEMPLATE_KEY}"
  
  echo "   Uploading to: s3://${BUCKET}/${TEMPLATE_KEY}..."
  
  if ! aws s3 cp "${MODIFIED_TEMPLATE_FILE}" "s3://${BUCKET}/${TEMPLATE_KEY}" 2>&1; then
    echo "❌ Error: Failed to upload template to S3"
    exit 1
  fi
  
  echo "✅ Template uploaded successfully"
  echo "   Template URL: ${TEMPLATE_URL}"
  echo ""
  
  # Update CloudFormation stack with S3 template URL
  echo "🚀 Updating stack '${STACK_NAME}' with template from S3..."
  
  UPDATE_OUTPUT=$(aws cloudformation update-stack \
    --stack-name "${STACK_NAME}" \
    --template-url "${TEMPLATE_URL}" \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    2>&1)
  
  UPDATE_EXIT_CODE=$?
  
  if [ $UPDATE_EXIT_CODE -eq 0 ]; then
    echo "✅ Stack update initiated successfully"
    echo ""
    echo "📋 Update details:"
    echo "${UPDATE_OUTPUT}" | jq -r '.StackId // .' 2>/dev/null || echo "${UPDATE_OUTPUT}"
    echo ""
    echo "⏳ The stack update is in progress. You can monitor it with:"
    echo "   aws cloudformation describe-stacks --stack-name ${STACK_NAME} --query 'Stacks[0].StackStatus'"
    echo ""
    echo "   Or watch the events:"
    echo "   aws cloudformation describe-stack-events --stack-name ${STACK_NAME} --max-items 10"
    echo ""
    echo "💡 After the update completes, the stage will be removed and the authorizer cache cleared."
    echo "   On the next deployment, the stage will be recreated."
  else
    echo "❌ Stack update failed:"
    echo "${UPDATE_OUTPUT}"
    echo ""
    echo "⚠️  The modified template is still available at: ${MODIFIED_TEMPLATE_FILE}"
    echo "   And uploaded to: s3://${BUCKET}/${TEMPLATE_KEY}"
    echo "   You can try updating manually or use Architect to redeploy."
    exit 1
  fi
else
  echo "⏭️  Skipping stack update"
  echo ""
  echo "📋 Next steps:"
  echo "   Review: ${MODIFIED_TEMPLATE_FILE}"
  echo "   Deploy manually:"
  echo "   # Upload template to S3 first"
  echo "   aws s3 cp ${MODIFIED_TEMPLATE_FILE} s3://YOUR-BUCKET/template.json"
  echo "   # Then update stack"
  echo "   aws cloudformation update-stack \\"
  echo "     --stack-name ${STACK_NAME} \\"
  echo "     --template-url https://YOUR-BUCKET.s3.amazonaws.com/template.json \\"
  echo "     --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM"
  echo ""
  echo "   Or use Architect:"
  echo "   cd apps/backend && pnpm arc deploy --production --no-hydrate --verbose"
fi
