/**
 * Enable Scheduled Rules Plugin
 *
 * This plugin ensures all EventBridge scheduled rules are explicitly enabled
 * by setting State: ENABLED in the CloudFormation template.
 */

module.exports = {
  deploy: {
    start: async ({ cloudformation }) => {
      if (!cloudformation || !cloudformation.Resources) {
        return cloudformation;
      }

      const resources = cloudformation.Resources;
      let modified = false;

      // Find all EventBridge rules
      for (const [resourceId, resource] of Object.entries(resources)) {
        if (resource.Type === "AWS::Events::Rule") {
          // Ensure State is explicitly set to ENABLED
          if (!resource.Properties || resource.Properties.State !== "ENABLED") {
            if (!resource.Properties) {
              resource.Properties = {};
            }
            resource.Properties.State = "ENABLED";
            modified = true;
            console.log(
              `[enable-scheduled-rules] Enabled EventBridge rule: ${resourceId}`
            );
          }
        }
      }

      if (modified) {
        console.log(
          "[enable-scheduled-rules] Updated EventBridge rules to be explicitly enabled"
        );
      }

      return cloudformation;
    },
  },
};
