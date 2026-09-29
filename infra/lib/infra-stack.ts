import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";

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
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production environments
    });

    // Multi-item replacement for `profilesTable` -- PK user_id, SK
    // entity_key ("PROFILE" | "PROJECT#<id>" | "EXPERIENCE#<id>"). See
    // docs/superpowers/specs/2026-09-28-profile-multi-item-schema-design.md.
    // `profilesTable` above is kept, unused once cutover lands, as a
    // rollback safety net -- do not delete it here.
    const profilesTableV2 = new dynamodb.Table(this, "ProfilesTableV2", {
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "entity_key", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production environments
    });

    const jobDescriptionsTable = new dynamodb.Table(this, "JobDescriptionsTable", {
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "job_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Tailored CVs, one item per CV. The sort key is the CV's own id rather
    // than `job_id` because a user can hold several tailored CVs for the same
    // posting (regenerate, reword, try a different template, compare before
    // exporting) — keying by job would collapse those into one row that each
    // edit overwrites. `job_id` is kept as a plain attribute for attribution;
    // "which CVs exist for job X" is answered client-side by filtering
    // GET /cv/list, which is why there's no GSI on it. See
    // docs/superpowers/specs/2026-09-27-cv-persistence-design.md.
    const cvsTable = new dynamodb.Table(this, "CvsTable", {
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "cv_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- Authentication ---
    // Hosted UI handles sign-up, sign-in, and email verification as one flow —
    // no custom Lambda triggers needed. See
    // docs/superpowers/specs/2026-09-21-cognito-authentication-design.md.

    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production environments
    });

    // ALLOW_ADMIN_USER_PASSWORD_AUTH is enabled purely so this pool can be
    // verified from the CLI (see Task 3) without needing a browser — Hosted
    // UI (Authorization Code + PKCE) is the actual sign-in flow real users
    // go through, added in Phase 2.
    const userPoolClient = userPool.addClient("UserPoolClient", {
      generateSecret: false,
      authFlows: { adminUserPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
        callbackUrls: ["http://localhost:5173/auth/callback"],
        logoutUrls: ["http://localhost:5173/"],
      },
    });

    // Cognito-provided domain prefix (no custom domain needed). Must be
    // globally unique — the account ID guarantees that.
    const userPoolDomain = userPool.addDomain("UserPoolDomain", {
      cognitoDomain: { domainPrefix: `cv-tailor-${this.account}` },
    });

    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "UserPoolDomain", {
      value: `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
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

    // --- Intake service Lambda ---
    // Turns free-form profile text into the profile-service JSON schema via one
    // Claude call. Never touches DynamoDB — it returns the parsed structure for
    // the user to review, and the frontend then hands the approved version to
    // PUT /profile. So: generation model only, no table access.
    const intakeServiceHandler = new Function(this, "IntakeServiceHandler", {
      runtime: Runtime.PYTHON_3_12,
      handler: "index.handler",
      code: Code.fromAsset("lambda/intake-service"),
      timeout: cdk.Duration.seconds(30), // one Converse call, input can be long
      environment: { BEDROCK_MODEL_ID },
    });
    intakeServiceHandler.addToRolePolicy(bedrockGenerationPolicy);

    // --- CV service Lambda ---
    // Pure CRUD over CvsTable — no Bedrock, no other tables. The dashboard
    // autosaves this on a debounce, so the timeout is generous rather than
    // tuned to a model call the way the other services' are.
    //
    // No bedrockEmbeddingPolicy/bedrockGenerationPolicy here on purpose: a
    // tailored CV is generated by tailoring-service, and this service only
    // stores the result the user then edits. Adding a Bedrock grant would
    // widen the blast radius for no benefit.
    const cvServiceHandler = new Function(this, "CvServiceHandler", {
      runtime: Runtime.PYTHON_3_12,
      handler: "index.handler",
      code: Code.fromAsset("lambda/cv-service"),
      timeout: cdk.Duration.seconds(15),
      environment: {
        CVS_TABLE_NAME: cvsTable.tableName,
      },
    });
    cvsTable.grantReadWriteData(cvServiceHandler);

    // --- HTTP API Gateway ---
    const api = new HttpApi(this, "ProfileServiceApi", {
      apiName: "profileservice-http-api",
      corsPreflight: {
        allowHeaders: ["*"],
        allowMethods: [cdk.aws_apigatewayv2.CorsHttpMethod.ANY],
        allowOrigins: ["*"],
      },
    });

    const jwtAuthorizer = new HttpJwtAuthorizer(
      "CognitoAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );

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
      authorizer: jwtAuthorizer,
    });

    api.addRoutes({
      path: "/profile/parse",
      methods: [cdk.aws_apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "IntakeServiceHandlerIntegration",
        intakeServiceHandler,
      ),
      authorizer: jwtAuthorizer,
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
      authorizer: jwtAuthorizer,
    });

    api.addRoutes({
      path: "/job-description/list",
      methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "JobDescriptionListIntegration",
        jobDescriptionServiceHandler,
      ),
      authorizer: jwtAuthorizer,
    });

    api.addRoutes({
      path: "/tailor-preview",
      methods: [cdk.aws_apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "TailoringServiceHandlerIntegration",
        tailoringServiceHandler,
      ),
      authorizer: jwtAuthorizer,
    });

    api.addRoutes({
      path: "/tailor-generate",
      methods: [cdk.aws_apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "TailoringGenerateIntegration",
        tailoringServiceHandler,
      ),
      authorizer: jwtAuthorizer,
    });

    api.addRoutes({
      path: "/cv",
      methods: [
        cdk.aws_apigatewayv2.HttpMethod.GET,
        cdk.aws_apigatewayv2.HttpMethod.PUT,
        cdk.aws_apigatewayv2.HttpMethod.DELETE,
      ],
      integration: new HttpLambdaIntegration(
        "CvServiceHandlerIntegration",
        cvServiceHandler,
      ),
      authorizer: jwtAuthorizer,
    });

    api.addRoutes({
      path: "/cv/list",
      methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "CvServiceListIntegration",
        cvServiceHandler,
      ),
      authorizer: jwtAuthorizer,
    });

    new cdk.CfnOutput(this, "HttpApiUrl", {
      value: api.apiEndpoint,
    });
  }
}
