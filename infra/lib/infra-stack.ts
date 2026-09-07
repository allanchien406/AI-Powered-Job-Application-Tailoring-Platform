import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";

// STAGED DEPLOYMENT: only profile-service is included right now — it's the
// only one of the three Lambdas that has actually been code-reviewed so far.
// job-service and tailoring-service (plus JobDescriptionsTable, the
// bedrock:InvokeModel grants they need, and their routes) are fully written
// on `develop` in git history (see commit 3ad9372) — they get added back
// into this file and redeployed once each one passes review. Don't deploy
// unreviewed Lambda code just because it's sitting in the repo.

// Verify this against the Bedrock console's model catalog for your account/region
// before deploying — Bedrock model IDs are not guaranteed stable across regions.
// Confirmed working via a direct invoke-model test call in this account/region.
const BEDROCK_EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Storage ---
    const profilesTable = new dynamodb.Table(this, "ProfilesTable", {
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production environments
    });

    // --- Profile service Lambda ---
    const profileServiceHandler = new Function(this, "ProfileServiceHandler", {
      runtime: Runtime.PYTHON_3_12,
      handler: "index.handler",
      code: Code.fromAsset("lambda/profile-service"),
      timeout: cdk.Duration.seconds(15), // occasional single embedding call on save
      environment: {
        PROFILES_TABLE_NAME: profilesTable.tableName,
        BEDROCK_EMBEDDING_MODEL_ID,
      },
    });
    profilesTable.grantReadWriteData(profileServiceHandler);
    profileServiceHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/${BEDROCK_EMBEDDING_MODEL_ID}`,
        ],
      }),
    );

    // --- HTTP API Gateway ---
    const api = new HttpApi(this, "ProfileServiceApi", {
      apiName: "profileservice-http-api",
      corsPreflight: {
        allowHeaders: ["*"],
        allowMethods: [cdk.aws_apigatewayv2.CorsHttpMethod.ANY],
        allowOrigins: ["*"],
      },
    });

    api.addRoutes({
      path: "/profile",
      methods: [
        cdk.aws_apigatewayv2.HttpMethod.GET,
        cdk.aws_apigatewayv2.HttpMethod.PUT,
      ],
      integration: new HttpLambdaIntegration(
        "ProfileServiceHandlerIntegration",
        profileServiceHandler,
      ),
    });

    new cdk.CfnOutput(this, "HttpApiUrl", {
      value: api.apiEndpoint,
    });
  }
}
