import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";

// STAGED DEPLOYMENT: profile-service and job-service are included now that
// both have been code-reviewed. tailoring-service (plus the bedrock:InvokeModel
// grant it needs for generation, and its routes) is fully written on `develop`
// in git history — it gets added back into this file and redeployed once it
// passes review. Don't deploy unreviewed Lambda code just because it's sitting
// in the repo.

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

    const jobDescriptionsTable = new dynamodb.Table(this, "JobDescriptionsTable", {
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "job_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const bedrockEmbeddingPolicy = new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/${BEDROCK_EMBEDDING_MODEL_ID}`,
      ],
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
    profileServiceHandler.addToRolePolicy(bedrockEmbeddingPolicy);

    // --- Job description service Lambda ---
    const jobDescriptionServiceHandler = new Function(
      this,
      "JobDescriptionServiceHandler",
      {
        runtime: Runtime.PYTHON_3_12,
        handler: "index.handler",
        code: Code.fromAsset("lambda/job-service"),
        timeout: cdk.Duration.seconds(15),
        environment: {
          JOB_DESCRIPTIONS_TABLE_NAME: jobDescriptionsTable.tableName,
          BEDROCK_EMBEDDING_MODEL_ID,
        },
      },
    );
    jobDescriptionsTable.grantReadWriteData(jobDescriptionServiceHandler);
    jobDescriptionServiceHandler.addToRolePolicy(bedrockEmbeddingPolicy);

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

    api.addRoutes({
      path: "/job-description",
      methods: [
        cdk.aws_apigatewayv2.HttpMethod.GET,
        cdk.aws_apigatewayv2.HttpMethod.PUT,
      ],
      integration: new HttpLambdaIntegration(
        "JobDescriptionHandlerIntegration",
        jobDescriptionServiceHandler,
      ),
    });

    api.addRoutes({
      path: "/job-description/list",
      methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "JobDescriptionListIntegration",
        jobDescriptionServiceHandler,
      ),
    });

    new cdk.CfnOutput(this, "HttpApiUrl", {
      value: api.apiEndpoint,
    });
  }
}
