import { describe, it, expect } from "vitest";
import {
  validateDependencies,
  formatCycles,
  detectCycles,
} from "../validate-dependencies.js";

describe("validateDependencies", () => {
  it("should return valid for empty CloudFormation template", () => {
    const cloudformation = {
      Resources: {},
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(true);
    expect(result.cycles).toEqual([]);
  });

  it("should return valid for template with no dependencies", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::S3::Bucket",
          Properties: {
            BucketName: "test-bucket",
          },
        },
        Resource2: {
          Type: "AWS::Lambda::Function",
          Properties: {
            FunctionName: "test-function",
          },
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(true);
    expect(result.cycles).toEqual([]);
  });

  it("should return valid for linear dependencies", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::S3::Bucket",
        },
        Resource2: {
          Type: "AWS::Lambda::Function",
          DependsOn: "Resource1",
        },
        Resource3: {
          Type: "AWS::ApiGateway::Method",
          DependsOn: "Resource2",
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(true);
    expect(result.cycles).toEqual([]);
  });

  it("should detect simple circular dependency", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::Lambda::Function",
          DependsOn: "Resource2",
        },
        Resource2: {
          Type: "AWS::ApiGateway::Method",
          DependsOn: "Resource1",
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(false);
    expect(result.cycles.length).toBeGreaterThan(0);
    expect(result.cycles[0]).toContain("Resource1");
    expect(result.cycles[0]).toContain("Resource2");
  });

  it("should detect circular dependency via Ref", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::Lambda::Function",
          Properties: {
            FunctionName: { Ref: "Resource2" },
          },
        },
        Resource2: {
          Type: "AWS::ApiGateway::Method",
          Properties: {
            AuthorizerId: { Ref: "Resource1" },
          },
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(false);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  it("should detect circular dependency via Fn::GetAtt", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::Lambda::Function",
          Properties: {
            Environment: {
              Variables: {
                API_ID: { "Fn::GetAtt": ["Resource2", "RestApiId"] },
              },
            },
          },
        },
        Resource2: {
          Type: "AWS::ApiGateway::RestApi",
          Properties: {
            Name: { "Fn::GetAtt": ["Resource1", "FunctionName"] },
          },
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(false);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  it("should detect complex circular dependency chain", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::Lambda::Function",
          DependsOn: "Resource2",
        },
        Resource2: {
          Type: "AWS::ApiGateway::Method",
          DependsOn: "Resource3",
        },
        Resource3: {
          Type: "AWS::ApiGateway::Deployment",
          DependsOn: "Resource1",
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(false);
    expect(result.cycles.length).toBeGreaterThan(0);
    // Cycle should include all three resources
    const cycle = result.cycles[0];
    expect(cycle).toContain("Resource1");
    expect(cycle).toContain("Resource2");
    expect(cycle).toContain("Resource3");
  });

  it("should handle array DependsOn", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::Lambda::Function",
        },
        Resource2: {
          Type: "AWS::S3::Bucket",
        },
        Resource3: {
          Type: "AWS::ApiGateway::Method",
          DependsOn: ["Resource1", "Resource2"],
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(true);
    expect(result.cycles).toEqual([]);
  });

  it("should detect cycle with array DependsOn", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::Lambda::Function",
          DependsOn: ["Resource2", "Resource3"],
        },
        Resource2: {
          Type: "AWS::ApiGateway::Method",
          DependsOn: "Resource1",
        },
        Resource3: {
          Type: "AWS::S3::Bucket",
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(false);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  it("should handle nested Ref in Properties", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::Lambda::Function",
          Properties: {
            Environment: {
              Variables: {
                API_ID: { Ref: "Resource2" },
              },
            },
          },
        },
        Resource2: {
          Type: "AWS::ApiGateway::RestApi",
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(true);
    expect(result.cycles).toEqual([]);
  });

  it("should handle nested Fn::GetAtt in Properties", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::Lambda::Function",
          Properties: {
            Code: {
              S3Bucket: { "Fn::GetAtt": ["Resource2", "BucketName"] },
            },
          },
        },
        Resource2: {
          Type: "AWS::S3::Bucket",
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(true);
    expect(result.cycles).toEqual([]);
  });

  it("should handle Fn::Sub with Ref", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::Lambda::Function",
          Properties: {
            FunctionName: {
              "Fn::Sub": [
                "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${FunctionName}",
                {
                  FunctionName: { Ref: "Resource2" },
                },
              ],
            },
          },
        },
        Resource2: {
          Type: "AWS::ApiGateway::RestApi",
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(true);
    expect(result.cycles).toEqual([]);
  });

  it("should ignore Ref to non-existent resources", () => {
    const cloudformation = {
      Resources: {
        Resource1: {
          Type: "AWS::Lambda::Function",
          Properties: {
            FunctionName: { Ref: "NonExistentResource" },
          },
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(true);
    expect(result.cycles).toEqual([]);
  });

  it("should detect multiple independent cycles", () => {
    const cloudformation = {
      Resources: {
        // Cycle 1: Resource1 <-> Resource2
        Resource1: {
          Type: "AWS::Lambda::Function",
          DependsOn: "Resource2",
        },
        Resource2: {
          Type: "AWS::ApiGateway::Method",
          DependsOn: "Resource1",
        },
        // Cycle 2: Resource3 <-> Resource4
        Resource3: {
          Type: "AWS::S3::Bucket",
          DependsOn: "Resource4",
        },
        Resource4: {
          Type: "AWS::DynamoDB::Table",
          DependsOn: "Resource3",
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(false);
    expect(result.cycles.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle real-world API Gateway scenario", () => {
    const cloudformation = {
      Resources: {
        LambdaFunction: {
          Type: "AWS::Lambda::Function",
        },
        ApiAuthorizer: {
          Type: "AWS::ApiGateway::Authorizer",
          Properties: {
            AuthorizerUri: {
              "Fn::Sub": [
                "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${AuthorizerFunctionArn}/invocations",
                {
                  AuthorizerFunctionArn: {
                    "Fn::GetAtt": ["LambdaFunction", "Arn"],
                  },
                },
              ],
            },
          },
          DependsOn: "LambdaFunction",
        },
        ApiMethod: {
          Type: "AWS::ApiGateway::Method",
          Properties: {
            AuthorizerId: { Ref: "ApiAuthorizer" },
          },
        },
      },
    };

    const result = validateDependencies(cloudformation);

    expect(result.valid).toBe(true);
    expect(result.cycles).toEqual([]);
  });
});

describe("formatCycles", () => {
  it("should format empty cycles", () => {
    const cycles = [];
    const formatted = formatCycles(cycles);
    expect(formatted).toBe("No cycles found");
  });

  it("should format single cycle", () => {
    const cycles = [["Resource1", "Resource2", "Resource1"]];
    const formatted = formatCycles(cycles);
    expect(formatted).toContain("Cycle 1");
    expect(formatted).toContain("Resource1");
    expect(formatted).toContain("Resource2");
  });

  it("should format multiple cycles", () => {
    const cycles = [
      ["Resource1", "Resource2", "Resource1"],
      ["Resource3", "Resource4", "Resource3"],
    ];
    const formatted = formatCycles(cycles);
    expect(formatted).toContain("Cycle 1");
    expect(formatted).toContain("Cycle 2");
  });
});

describe("detectCycles", () => {
  it("should detect no cycles in empty graph", () => {
    const graph = new Map();
    const cycles = detectCycles(graph);
    expect(cycles).toEqual([]);
  });

  it("should detect no cycles in linear graph", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["C"])],
      ["C", new Set()],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles).toEqual([]);
  });

  it("should detect simple cycle", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]).toContain("A");
    expect(cycles[0]).toContain("B");
  });

  it("should detect longer cycle", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["C"])],
      ["C", new Set(["A"])],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
    const cycle = cycles[0];
    expect(cycle).toContain("A");
    expect(cycle).toContain("B");
    expect(cycle).toContain("C");
  });

  it("should detect multiple independent cycles", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
      ["C", new Set(["D"])],
      ["D", new Set(["C"])],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThanOrEqual(2);
  });
});

