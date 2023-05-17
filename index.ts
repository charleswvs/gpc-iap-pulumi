import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as random from "@pulumi/random";
const REGION = gcp.config.region || "us-central1";

// Create a new VPC network
const network = new gcp.compute.Network("network");

// Create a VPC Access connector
const vpcConnector = new gcp.vpcaccess.Connector("connector", {
  region: REGION,
  ipCidrRange: "10.8.0.0/28",
  network: network.selfLink,
});

// Create a Cloud Run service in the VPC
const cloudRunService = new gcp.cloudrun.Service("cloud-run-service", {
  location: REGION,
  template: {
    spec: {
      containers: [
        {
          image: "gcr.io/cloudrun/hello",
        },
      ],
    },
    metadata: {
      annotations: {
        "run.googleapis.com/vpc-access-connector": vpcConnector.selfLink,
      },
    },
  },
});

// Create a Cloud HTTPS Load Balancer
const healthCheck = new gcp.compute.HealthCheck("health-check", {
  checkIntervalSec: 1,
  timeoutSec: 1,
  healthyThreshold: 3,
  unhealthyThreshold: 4,
  httpHealthCheck: {
    port: 80,
  },
});

const backendService = new gcp.compute.BackendService("backend-service", {
  healthChecks: healthCheck.selfLink,
  // protocol: "HTTP2",
  timeoutSec: 60,
  // region: REGION,
  // customRequestHeaders: ["X-Cloud-Run-Pulumi-Stack:" + pulumi.getStack()],
});

const serviceRLE = new gcp.cloudrun.IamMember("service-rle", {
  location: cloudRunService.location,
  project: cloudRunService.project,
  service: cloudRunService.name,
  role: "roles/run.invoker",
  member: "allAuthenticatedUsers",
});

const randomSuffix = new random.RandomString("random-suffix", {
  length: 4,
  special: false,
  upper: false,
  number: true,
});

const urlMap = new gcp.compute.URLMap("url-map", {
  defaultService: backendService.selfLink,
});

const targetHttpProxy = new gcp.compute.TargetHttpProxy("target-http-proxy", {
  urlMap: urlMap.selfLink,
});

const ipAddress = new gcp.compute.GlobalAddress("ip-address", {
  // region: REGION,
});
const forwardingRule = new gcp.compute.GlobalForwardingRule("forwarding-rule", {
  ipAddress: ipAddress.address,
  target: targetHttpProxy.selfLink,
  portRange: "80",
});

// Enable Identity Aware Proxy (IAP)
const iapPolicy = new gcp.iap.WebBackendServiceIamPolicy("iap-policy", {
  webBackendService: backendService.id,
  policyData: pulumi
    .all([backendService.id, serviceRLE.member])
    .apply(([backendServiceId, iapMember]) => {
      return JSON.stringify({
        bindings: [
          {
            members: [iapMember],
            role: "roles/iap.httpsResourceAccessor",
          },
        ],
      });
    }),
});

// Export the Cloud Run service URL
export const serviceUrl = cloudRunService.statuses[0].url;
