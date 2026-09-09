import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";

// Verify these against the Bedrock console's model catalog for your account/region
// before deploying — Bedrock model IDs are not guaranteed stable across regions.
//
// Claude Haiku 4.5 can't be invoked by its bare foundation-model ID — Bedrock
// requires a cross-region inference profile ARN instead (confirmed via a real
// `converse` call; the bare ID fails with "on-demand throughput isn't
// supported"). `aws bedrock get-inference-profile` shows this profile routes
// to the model in us-east-1, us-east-2, and us-west-2 — IAM needs to grant
// both the profile ARN itself AND each of those regional foundation-model
// ARNs, since the profile can dispatch to any of them.
const BEDROCK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const BEDROCK_MODEL_UNDERLYING_ID = "anthropic.claude-haiku-4-5-20251001-v1:0";
const BEDROCK_MODEL_REGIONS = ["us-east-1", "us-east-2", "us-west-2"];
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

    // --- Bedrock access, split by what each service actually needs ---
    // Embeddings are used by all three Lambdas; generation (Claude Haiku 4.5)
    // is only ever called by tailoring-service, so it gets its own policy
    // rather than being bundled into one grant handed to every Lambda.

    const bedrockEmbeddingPolicy = new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/${BEDROCK_EMBEDDING_MODEL_ID}`,
      ],
    });

    const bedrockGenerationPolicy = new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${BEDROCK_MODEL_ID}`,
        ...BEDROCK_MODEL_REGIONS.map(
          (region) => `arn:aws:bedrock:${region}::foundation-model/${BEDROCK_MODEL_UNDERLYING_ID}`,
        ),
      ],
    });

    const embeddingEnv = { BEDROCK_EMBEDDING_MODEL_ID };
    const generationEnv = { BEDROCK_MODEL_ID, BEDROCK_EMBEDDING_MODEL_ID };

    // --- Profile service Lambda ---
    const profileServiceHandler = new Function(this, "ProfileServiceHandler", {
      runtime: Runtime.PYTHON_3_12,
      handler: "index.handler",
      code: Code.fromAsset("lambda/profile-service"),
      timeout: cdk.Duration.seconds(15), // occasional single embedding call on save
      environment: {
        PROFILES_TABLE_NAME: profilesTable.tableName,
        ...embeddingEnv,
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
          ...embeddingEnv,
        },
      },
    );
    jobDescriptionsTable.grantReadWriteData(jobDescriptionServiceHandler);
    jobDescriptionServiceHandler.addToRolePolicy(bedrockEmbeddingPolicy);

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
          ...generationEnv,
        },
      },
    );
    profilesTable.grantReadData(tailoringServiceHandler);
    jobDescriptionsTable.grantReadData(tailoringServiceHandler);
    tailoringServiceHandler.addToRolePolicy(bedrockEmbeddingPolicy);
    tailoringServiceHandler.addToRolePolicy(bedrockGenerationPolicy);

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
