import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  CONNECTION_TIMEOUT_MS,
  DEFAULT_S3_REGION,
  getS3BucketName,
} from "../config";

describe("config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ARC_ENV;
    delete process.env.NODE_ENV;
    delete process.env.HELPMATON_VECTORDB_S3_BUCKET_PRODUCTION;
    delete process.env.HELPMATON_VECTORDB_S3_BUCKET_STAGING;
    delete process.env.HELPMATON_S3_BUCKET_PRODUCTION;
    delete process.env.HELPMATON_S3_BUCKET_STAGING;
  });

  describe("getS3BucketName", () => {
    it("should return production bucket in production environment", () => {
      process.env.ARC_ENV = "production";
      process.env.HELPMATON_VECTORDB_S3_BUCKET_PRODUCTION = "prod-bucket";
      const bucket = getS3BucketName();
      expect(bucket).toBe("prod-bucket");
    });

    it("should return staging bucket in non-production environment", () => {
      process.env.ARC_ENV = "staging";
      process.env.HELPMATON_VECTORDB_S3_BUCKET_STAGING = "staging-bucket";
      const bucket = getS3BucketName();
      expect(bucket).toBe("staging-bucket");
    });

    it("should fallback to HELPMATON_S3_BUCKET_PRODUCTION in production", () => {
      process.env.ARC_ENV = "production";
      process.env.HELPMATON_S3_BUCKET_PRODUCTION = "fallback-prod-bucket";
      const bucket = getS3BucketName();
      expect(bucket).toBe("fallback-prod-bucket");
    });

    it("should fallback to HELPMATON_S3_BUCKET_STAGING in staging", () => {
      process.env.ARC_ENV = "staging";
      process.env.HELPMATON_S3_BUCKET_STAGING = "fallback-staging-bucket";
      const bucket = getS3BucketName();
      expect(bucket).toBe("fallback-staging-bucket");
    });

    it("should throw error if bucket not configured", () => {
      process.env.ARC_ENV = "production";
      expect(() => getS3BucketName()).toThrow("S3 bucket name not configured");
    });

    it("should use NODE_ENV as fallback for production detection", () => {
      process.env.NODE_ENV = "production";
      process.env.HELPMATON_VECTORDB_S3_BUCKET_PRODUCTION = "prod-bucket";
      const bucket = getS3BucketName();
      expect(bucket).toBe("prod-bucket");
    });

    it("should always use vectordb.staging in local testing mode (matches s3rver)", () => {
      process.env.ARC_ENV = "testing";
      // Even if environment variables are set, should use vectordb.staging
      process.env.HELPMATON_VECTORDB_S3_BUCKET_STAGING = "custom-bucket";
      const bucket = getS3BucketName();
      expect(bucket).toBe("vectordb.staging");
    });
  });

  describe("default constants", () => {
    it("should have correct default query limit", () => {
      expect(DEFAULT_QUERY_LIMIT).toBe(100);
    });

    it("should have correct max query limit", () => {
      expect(MAX_QUERY_LIMIT).toBe(1000);
    });

    it("should have correct connection timeout", () => {
      expect(CONNECTION_TIMEOUT_MS).toBe(30000);
    });

    it("should have correct default S3 region", () => {
      expect(DEFAULT_S3_REGION).toBe("eu-west-2");
    });
  });
});
