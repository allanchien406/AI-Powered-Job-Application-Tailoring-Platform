import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const profileServiceHandler = new Function(this, "ProfileServiceHandler", {
      runtime: Runtime.PYTHON_3_12,
      handler: "index.handler",
      code: Code.fromAsset("lambda/profile-service"),
    });

    const api = new HttpApi(this, "ProfileServiceApi", {
      apiName: "profileservice-http-api",
    });

    api.addRoutes({
      path: "/profile",
      methods: [cdk.aws_apigatewayv2.HttpMethod.PUT],
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
