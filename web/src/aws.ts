// AWS deploy-link generation. Pure functions so they can be unit tested.

export interface AwsRegion {
  id: string;
  label: string;
}

// Commercial regions with Nitro Enclave-capable instance families.
export const AWS_REGIONS: AwsRegion[] = [
  { id: "us-east-1", label: "US East (N. Virginia)" },
  { id: "us-east-2", label: "US East (Ohio)" },
  { id: "us-west-2", label: "US West (Oregon)" },
  { id: "ca-central-1", label: "Canada (Central)" },
  { id: "eu-west-1", label: "Europe (Ireland)" },
  { id: "eu-west-2", label: "Europe (London)" },
  { id: "eu-west-3", label: "Europe (Paris)" },
  { id: "eu-central-1", label: "Europe (Frankfurt)" },
  { id: "eu-north-1", label: "Europe (Stockholm)" },
  { id: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { id: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { id: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
  { id: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { id: "sa-east-1", label: "South America (São Paulo)" },
];

export type Arch = "arm64" | "x86_64";

export interface InstanceType {
  id: string;
  arch: Arch;
  vcpu: number;
  memoryGiB: number;
  /** Approximate us-east-1 Linux on-demand price, USD per hour. */
  usdPerHour: number;
  note?: string;
}

// Nitro Enclaves need at least 4 vCPUs on the parent (2 are carved out for
// the enclave), so the smallest usable size is xlarge. Graviton (arm64) is the
// default: about 20% cheaper, and Octez packages are built for it. The first entry is the default.
export const AWS_INSTANCE_TYPES: InstanceType[] = [
  { id: "m7g.xlarge", arch: "arm64", vcpu: 4, memoryGiB: 16, usdPerHour: 0.1632, note: "Testnets" },
  { id: "m6g.xlarge", arch: "arm64", vcpu: 4, memoryGiB: 16, usdPerHour: 0.154, note: "Testnets, lowest cost" },
  { id: "r7g.xlarge", arch: "arm64", vcpu: 4, memoryGiB: 32, usdPerHour: 0.2142, note: "Testnets, more headroom" },
  { id: "m7g.2xlarge", arch: "arm64", vcpu: 8, memoryGiB: 32, usdPerHour: 0.3264, note: "Mainnet" },
  { id: "m6i.xlarge", arch: "x86_64", vcpu: 4, memoryGiB: 16, usdPerHour: 0.192, note: "Testnets, x86" },
  { id: "m6i.2xlarge", arch: "x86_64", vcpu: 8, memoryGiB: 32, usdPerHour: 0.384, note: "Mainnet, x86" },
];

export interface AwsDeployParams {
  region: string;
  stackName: string;
  templateUrl: string;
  network: string;
  octezVersion: string;
  instanceType: string;
  diskSizeGiB: number;
  enableDal: boolean;
  enableBaker: boolean;
}

const STACK_NAME_RE = /^[A-Za-z][A-Za-z0-9-]{0,127}$/;

export function validateStackName(name: string): string | null {
  if (!STACK_NAME_RE.test(name)) {
    return "Must start with a letter and contain only letters, digits and hyphens (max 128).";
  }
  return null;
}

/** CloudFormation template parameters, in a stable order. */
export function templateParameters(p: AwsDeployParams): [string, string][] {
  return [
    ["Network", p.network],
    ["OctezVersion", p.octezVersion],
    ["InstanceType", p.instanceType],
    ["DataVolumeSizeGiB", String(p.diskSizeGiB)],
    ["EnableDalNode", p.enableDal ? "true" : "false"],
    ["EnableBaker", p.enableBaker ? "true" : "false"],
  ];
}

/** Console "quick-create" link: opens the Launch Stack page with everything prefilled. */
export function launchStackUrl(p: AwsDeployParams): string {
  const q = new URLSearchParams();
  q.set("templateURL", p.templateUrl);
  q.set("stackName", p.stackName);
  for (const [k, v] of templateParameters(p)) q.set(`param_${k}`, v);
  const region = encodeURIComponent(p.region);
  return (
    `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}` +
    `#/stacks/quickcreate?${q.toString()}`
  );
}

function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./:=,@+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Equivalent AWS CLI command, for people who prefer not to use the console. */
export function createStackCommand(p: AwsDeployParams): string {
  const params = templateParameters(p)
    .map(([k, v]) => `    ParameterKey=${k},ParameterValue=${shellQuote(v)}`)
    .join(" \\\n");
  return [
    "aws cloudformation create-stack \\",
    `  --region ${shellQuote(p.region)} \\`,
    `  --stack-name ${shellQuote(p.stackName)} \\`,
    `  --template-url ${shellQuote(p.templateUrl)} \\`,
    "  --capabilities CAPABILITY_IAM \\",
    "  --parameters \\",
    params,
  ].join("\n");
}
