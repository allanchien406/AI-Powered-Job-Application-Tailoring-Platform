import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";

// Verify these against the Bedrock console's model catalog for your account/region
// before deploying — Bedrock model IDs are not guaranteed stable across regions.
const BEDROCK_MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0";
const BEDROCK_EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Storage ---
    // Both profiles and job descriptions are single-item-per-key JSON documents
    // with no relational joins between them anywhere in the app — DynamoDB fits
    // this better than RDS did, and drops the VPC/Secrets Manager machinery
    // that existed purely to let Lambdas reach Postgres.

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

    // --- Shared Bedrock access ---
    // Scoped to the two specific models this app uses, not bedrock:* / resource "*".

    const bedrockInvokePolicy = new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/${BEDROCK_MODEL_ID}`,
        `arn:aws:bedrock:${this.region}::foundation-model/${BEDROCK_EMBEDDING_MODEL_ID}`,
      ],
    });

    const bedrockEnv = {
      BEDROCK_MODEL_ID,
      BEDROCK_EMBEDDING_MODEL_ID,
    };

    // --- Profile service Lambda ---
    const profileServiceHandler = new Function(this, "ProfileServiceHandler", {
      runtime: Runtime.PYTHON_3_12,
      handler: "index.handler",
      code: Code.fromAsset("lambda/profile-service"),
      timeout: cdk.Duration.seconds(15), // occasional single embedding call on save
      environment: {
        PROFILES_TABLE_NAME: profilesTable.tableName,
        ...bedrockEnv,
      },
    });
    profilesTable.grantReadWriteData(profileServiceHandler);
    profileServiceHandler.addToRolePolicy(bedrockInvokePolicy);

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
          ...bedrockEnv,
        },
      },
    );
    jobDescriptionsTable.grantReadWriteData(jobDescriptionServiceHandler);
    jobDescriptionServiceHandler.addToRolePolicy(bedrockInvokePolicy);

    // --- Tailoring service Lambda ---
    // Read-only on both tables — it never writes a profile or a job description,
    // only looks them up.
    const tailoringServiceHandler = new Function(
      this,
      "TailoringServiceHandler",
      {
        runtime: Runtime.PYTHON_3_12,
        handler: "index.handler",
        code: Code.fromAsset("lambda/tailoring-service"),
        timeout: cdk.Duration.seconds(30), // generation call + at most one ad-hoc JD embedding
        environment: {
          PROFILES_TABLE_NAME: profilesTable.tableName,
          JOB_DESCRIPTIONS_TABLE_NAME: jobDescriptionsTable.tableName,
          ...bedrockEnv,
        },
      },
    );
    profilesTable.grantReadData(tailoringServiceHandler);
    jobDescriptionsTable.grantReadData(tailoringServiceHandler);
    tailoringServiceHandler.addToRolePolicy(bedrockInvokePolicy);

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

    api.addRoutes({
      path: "/tailor-preview",
      methods: [cdk.aws_apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "TailoringServiceHandlerIntegration",
        tailoringServiceHandler,
      ),
    });

    api.addRoutes({
      path: "/tailor-generate",
      methods: [cdk.aws_apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "TailoringGenerateIntegration",
        tailoringServiceHandler,
      ),
    });

    new cdk.CfnOutput(this, "HttpApiUrl", {
      value: api.apiEndpoint,
    });
  }
}
