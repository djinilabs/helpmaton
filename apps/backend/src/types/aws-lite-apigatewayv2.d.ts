declare module "@aws-lite/apigatewayv2" {
  interface ApiGatewayV2Plugin {
    name: string;
    service: string;
    property: string;
    methods: Record<string, unknown>;
  }
  const apiGatewayV2Plugin: ApiGatewayV2Plugin;
  export default apiGatewayV2Plugin;
}

