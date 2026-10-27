import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface EmailStackProps extends StackProps {
  readonly senderEmail: string;
}

export class EmailStack extends Stack {
  public readonly senderIdentity: ses.EmailIdentity;
  public readonly deliveryDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    this.deliveryDlq = new sqs.Queue(this, 'SesFailureQueue', {
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });

    this.senderIdentity = new ses.EmailIdentity(this, 'SenderIdentity', {
      identity: ses.Identity.email(props.senderEmail),
    });

    new CfnOutput(this, 'SenderEmailIdentity', {
      value: props.senderEmail,
    });
  }
}
