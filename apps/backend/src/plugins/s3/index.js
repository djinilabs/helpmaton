const S3rver = require('@20minutes/s3rver');
const { sync: mkdirpSync } = require('mkdirp');
const { join } = require('path');
const { readFileSync: file } = require('fs');

let s3rver;

const port =
  Number((process.env.HELPMATON_S3_ENDPOINT || 'localhost:4568').split(':')[1]) ||
  4568;

// Use fixed directory path for persistence between server runs
// Default to apps/backend/.s3rver_data, or use HELPMATON_S3_DATA_DIR env var
const directory = process.env.HELPMATON_S3_DATA_DIR || join(__dirname, '../../.s3rver_data');
mkdirpSync(directory);

console.log(`s3rver storing data in ${directory}`);

const bucketName = process.env.HELPMATON_S3_BUCKET || 'workspace.documents';
const vectordbBucketName = process.env.HELPMATON_VECTORDB_S3_BUCKET_STAGING || 'vectordb.staging';

const options = {
  port,
  directory,
  configureBuckets: [
    {
      name: bucketName,
      configs: [file(join(__dirname, 'cors-config.xml'))],
    },
    {
      name: vectordbBucketName,
      configs: [file(join(__dirname, 'cors-config.xml'))],
    },
  ],
  silent: process.env.NODE_ENV === 'production',
};

function pkg({
  cloudformation,
}) {
  const { Resources } = cloudformation;
  const bucketName = process.env.HELPMATON_S3_BUCKET || 'workspace.documents';

  // Find or create S3 bucket resource
  // Architect may create the bucket automatically, so we need to find it or create it
  let bucketResourceId = null;
  for (const [resourceId, resource] of Object.entries(Resources)) {
    if (
      resource.Type === 'AWS::S3::Bucket' &&
      resource.Properties &&
      (resource.Properties.BucketName === bucketName ||
        resource.Properties.BucketName === undefined)
    ) {
      bucketResourceId = resourceId;
      break;
    }
  }

  // If bucket doesn't exist, create it
  if (!bucketResourceId) {
    bucketResourceId = 'ConversationFilesBucket';
    Resources[bucketResourceId] = {
      Type: 'AWS::S3::Bucket',
      Properties: {
        BucketName: bucketName,
      },
    };
  }

  // Add lifecycle configuration to bucket
  const lifecycleConfigId = 'ConversationFilesLifecycleConfiguration';
  Resources[lifecycleConfigId] = {
    Type: 'AWS::S3::BucketLifecycleConfiguration',
    Properties: {
      Bucket: { Ref: bucketResourceId },
      LifecycleConfiguration: {
        Rules: [
          {
            Id: 'DeleteConversationFilesAfter30Days',
            Status: 'Enabled',
            Prefix: 'conversation-files/',
            ExpirationInDays: 30,
          },
        ],
      },
    },
  };

  console.log(
    `[s3] Added lifecycle policy for conversation-files/ prefix (30 days expiration)`
  );

  return cloudformation;
}

function start({ arc, inventory, invokeFunction, services }) {
  console.log('starting s3rver...', options);
  s3rver = new S3rver(options);
  return s3rver.run();
}

function end({ arc, inventory, services }, callback) {
  console.log('stopping s3rver...');
  if (!s3rver) {
    return callback();
  }
  s3rver.close(callback);
  s3rver = undefined;
}

const sandbox = { start, end };

module.exports = {
  package: pkg,
  sandbox,
};

