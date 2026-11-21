import { test } from "node:test";
import assert from "node:assert/strict";
import { createStackCommand, launchStackUrl, validateStackName, type AwsDeployParams } from "../src/aws.ts";
import { estimateAwsMonthly } from "../src/cost.ts";

const params: AwsDeployParams = {
  region: "eu-west-1",
  stackName: "tezos-baker",
  templateUrl: "https://example-releases.s3.eu-west-1.amazonaws.com/releases/1.0.0/aws/baker.yaml",
  network: "shadownet",
  octezVersion: "25.3-1",
  instanceType: "m7g.xlarge",
  diskSizeGiB: 300,
  enableDal: true,
  enableBaker: false,
};

test("launch stack URL targets the chosen region's quick-create page", () => {
  const u = new URL(launchStackUrl(params));
  assert.equal(u.host, "eu-west-1.console.aws.amazon.com");
  assert.equal(u.searchParams.get("region"), "eu-west-1");
  assert.ok(u.hash.startsWith("#/stacks/quickcreate?"));
});

test("launch stack URL carries template and parameters", () => {
  const u = new URL(launchStackUrl(params));
  const q = new URLSearchParams(u.hash.slice("#/stacks/quickcreate?".length));
  assert.equal(q.get("templateURL"), params.templateUrl);
  assert.equal(q.get("stackName"), "tezos-baker");
  assert.equal(q.get("param_Network"), "shadownet");
  assert.equal(q.get("param_OctezVersion"), "25.3-1");
  assert.equal(q.get("param_DataVolumeSizeGiB"), "300");
  assert.equal(q.get("param_EnableDalNode"), "true");
  assert.equal(q.get("param_EnableBaker"), "false");
});

test("stack name validation", () => {
  assert.equal(validateStackName("tezos-baker-1"), null);
  assert.notEqual(validateStackName("1abc"), null);
  assert.notEqual(validateStackName("has space"), null);
  assert.notEqual(validateStackName("a".repeat(129)), null);
});

test("CLI command quotes values that need it", () => {
  const cmd = createStackCommand({ ...params, octezVersion: "it's" });
  assert.match(cmd, /ParameterValue='it'\\''s'/);
  assert.match(cmd, /--template-url https:\/\/example-releases/);
});

test("cost estimate adds up its lines", () => {
  const e = estimateAwsMonthly({ id: "m6i.xlarge", arch: "x86_64", vcpu: 4, memoryGiB: 16, usdPerHour: 0.192 }, 300);
  const sum = e.lines.reduce((s, l) => s + l.usdPerMonth, 0);
  assert.equal(e.totalUsdPerMonth, sum);
  assert.ok(e.totalUsdPerMonth > 140 && e.totalUsdPerMonth < 200);
});

test("default instance is Graviton and every instance can host an enclave", async () => {
  const { AWS_INSTANCE_TYPES } = await import("../src/aws.ts");
  assert.equal(AWS_INSTANCE_TYPES[0]!.arch, "arm64");
  for (const t of AWS_INSTANCE_TYPES) assert.ok(t.vcpu >= 4, t.id);
});
