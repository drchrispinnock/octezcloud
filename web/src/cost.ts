// Rough monthly cost estimate. Deliberately conservative and clearly labelled
// as approximate: prices vary by region and change over time.

import type { InstanceType } from "./aws.ts";

export const HOURS_PER_MONTH = 730;

export interface CostLine {
  label: string;
  usdPerMonth: number;
}

export interface CostEstimate {
  lines: CostLine[];
  totalUsdPerMonth: number;
  caveats: string[];
}

const GP3_USD_PER_GIB_MONTH = 0.08;
const PUBLIC_IPV4_USD_PER_HOUR = 0.005;
const KMS_KEY_USD_PER_MONTH = 1;
// DynamoDB on-demand watermark table, CloudWatch Logs, SSM: small but non-zero.
const MISC_USD_PER_MONTH = 5;

export function estimateAwsMonthly(instance: InstanceType, diskSizeGiB: number): CostEstimate {
  const lines: CostLine[] = [
    { label: `EC2 ${instance.id} (on-demand)`, usdPerMonth: instance.usdPerHour * HOURS_PER_MONTH },
    { label: `EBS gp3, ${diskSizeGiB} GiB`, usdPerMonth: diskSizeGiB * GP3_USD_PER_GIB_MONTH },
    { label: "Public IPv4 address", usdPerMonth: PUBLIC_IPV4_USD_PER_HOUR * HOURS_PER_MONTH },
    { label: "KMS key (sealing)", usdPerMonth: KMS_KEY_USD_PER_MONTH },
    { label: "DynamoDB, CloudWatch Logs, SSM", usdPerMonth: MISC_USD_PER_MONTH },
  ];
  const total = lines.reduce((s, l) => s + l.usdPerMonth, 0);
  return {
    lines,
    totalUsdPerMonth: total,
    caveats: [
      "Based on approximate us-east-1 on-demand prices. Other regions are usually 5–20% higher.",
      "Excludes data transfer out. P2P traffic from a node can add a lot to this, depending on the network.",
      "Savings Plans or Reserved Instances can cut the EC2 line by 30–60%.",
    ],
  };
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}
