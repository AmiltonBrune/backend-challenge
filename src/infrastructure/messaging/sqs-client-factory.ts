import { SQSClient } from '@aws-sdk/client-sqs';
import type { AppConfig } from '@infrastructure/config/app-config.ts';

export function buildSqsClient(config: AppConfig): SQSClient {
  return new SQSClient({
    endpoint: config.awsEndpointUrl,
    region: config.awsRegion,
    credentials: {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
    },
  });
}
