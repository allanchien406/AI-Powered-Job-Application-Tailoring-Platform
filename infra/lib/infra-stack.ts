import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "AppVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "PublicSubnet",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: "PrivateSubnet",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(
      this,
      "LambdaSecurityGroup",
      {
        vpc,
        description:
          "Security group for profile service Lambda function to access RDS",
        allowAllOutbound: true,
      },
    );

    const databaseSecurityGroup = new ec2.SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      {
        vpc,
        description:
          "Security group for RDS instance to allow access from Lambda",
        allowAllOutbound: true,
      },
    );

    databaseSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      "Allow Lambda to access RDS on port 5432",
    );

    const secretsManagerEndpointSecurityGroup = new ec2.SecurityGroup(
      this,
      "SecretsManagerEndpointSecurityGroup",
      {
        vpc,
        description:
          "Security group for Secrets Manager VPC endpoint to allow access from Lambda",
        allowAllOutbound: true,
      },
    );

    secretsManagerEndpointSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(443),
      "Allow Lambda to access Secrets Manager VPC endpoint on port 443",
    );

    vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [secretsManagerEndpointSecurityGroup],
      privateDnsEnabled: true,
    });

    const rdsInstance = new rds.DatabaseInstance(this, "ProfileDatabase", {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [databaseSecurityGroup],
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_6,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),

      credentials: rds.Credentials.fromGeneratedSecret("postgres"), // Auto-generate a secret for the database credentials
      databaseName: "jobtailor",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      publiclyAccessible: false,
      multiAz: false,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production environments
      deleteAutomatedBackups: true,
    });

    // Create the Lambda function for the profile service
    const profileServiceHandler = new Function(this, "ProfileServiceHandler", {
      runtime: Runtime.PYTHON_3_12,
      handler: "index.handler",
      code: Code.fromAsset("lambda/profile-service"),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      timeout: cdk.Duration.seconds(10),
      securityGroups: [lambdaSecurityGroup],
      environment: {
        DB_HOST: rdsInstance.dbInstanceEndpointAddress,
        DB_PORT: rdsInstance.dbInstanceEndpointPort,
        DB_NAME: "jobtailor",
        DB_SECRET_ARN: rdsInstance.secret?.secretArn || "", // Pass the RDS secret ARN to the Lambda function for secure access to database credentials
      },
    });

    const jobDescriptionServiceHandler = new Function(
      this,
      "JobDescriptionServiceHandler",
      {
        runtime: Runtime.PYTHON_3_12,
        handler: "index.handler",
        code: Code.fromAsset("lambda/job-service"),
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
        timeout: cdk.Duration.seconds(10),
        securityGroups: [lambdaSecurityGroup],
        environment: {
          DB_HOST: rdsInstance.dbInstanceEndpointAddress,
          DB_PORT: rdsInstance.dbInstanceEndpointPort,
          DB_NAME: "jobtailor",
          DB_SECRET_ARN: rdsInstance.secret?.secretArn || "",
        },
      },
    );

    rdsInstance.secret?.grantRead(profileServiceHandler); // Grant the Lambda function permission to read the RDS secret for database credentials
    rdsInstance.secret?.grantRead(jobDescriptionServiceHandler); // Grant the Lambda function permission to read the RDS secret for database credentials

    // Create the HTTP API Gateway and integrate it with the Lambda function
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

    new cdk.CfnOutput(this, "HttpApiUrl", {
      value: api.apiEndpoint,
    });
  }
}
