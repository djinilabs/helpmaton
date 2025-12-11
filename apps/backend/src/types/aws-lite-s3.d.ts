declare module "@aws-lite/s3" {
  interface S3Plugin {
    name: string;
    service: string;
    property: string;
    methods: Record<string, unknown>;
  }
  const s3Plugin: S3Plugin;
  export default s3Plugin;
}

declare module "@aws-lite/client" {
  interface S3Config {
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    region?: string;
    plugins?: unknown[];
  }

  interface S3Client {
    HeadObject(params: { Bucket: string; Key: string }): Promise<void>;
    PutObject(params: {
      Bucket: string;
      Key: string;
      Body: Buffer | string;
      ContentType?: string;
    }): Promise<void>;
    GetObject(params: {
      Bucket: string;
      Key: string;
    }): Promise<{
      Body: Buffer | string | AsyncIterable<Uint8Array>;
    }>;
    DeleteObject(params: { Bucket: string; Key: string }): Promise<void>;
    CopyObject(params: {
      Bucket: string;
      CopySource: string;
      Key: string;
    }): Promise<void>;
  }

  interface AwsLiteClient {
    S3: S3Client;
    config: unknown;
    credentials: unknown;
  }

  function awsLite(config?: S3Config): Promise<AwsLiteClient>;
  export default awsLite;
}

