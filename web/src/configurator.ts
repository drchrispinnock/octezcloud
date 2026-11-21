import {
  AWS_INSTANCE_TYPES,
  AWS_REGIONS,
  createStackCommand,
  launchStackUrl,
  validateStackName,
  type AwsDeployParams,
} from "./aws.ts";
import { estimateAwsMonthly, formatUsd } from "./cost.ts";
import { MANIFEST, RELEASES_BASE_URL, isDeployable, templateUrl, type Release } from "./releases.ts";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function fillSelect(sel: HTMLSelectElement, opts: { value: string; label: string; disabled?: boolean }[]) {
  const prev = sel.value;
  sel.replaceChildren(
    ...opts.map((o) => el("option", { value: o.value, textContent: o.label, disabled: !!o.disabled })),
  );
  const keep = opts.find((o) => o.value === prev && !o.disabled);
  const first = opts.find((o) => !o.disabled);
  sel.value = (keep ?? first)?.value ?? "";
}

function init() {
  const form = $<HTMLFormElement>("configurator");
  const releaseSel = $<HTMLSelectElement>("release");
  const networkSel = $<HTMLSelectElement>("network");
  const octezSel = $<HTMLSelectElement>("octez-version");
  const regionSel = $<HTMLSelectElement>("region");
  const instanceSel = $<HTMLSelectElement>("instance-type");
  const diskInput = $<HTMLInputElement>("disk-size");
  const dalInput = $<HTMLInputElement>("role-dal");
  const bakerInput = $<HTMLInputElement>("role-baker");
  const stackInput = $<HTMLInputElement>("stack-name");
  const stackError = $<HTMLElement>("stack-name-error");

  const launchBtn = $<HTMLAnchorElement>("launch-stack");
  const launchNote = $<HTMLElement>("launch-note");
  const templateUrlOut = $<HTMLElement>("template-url");
  const templateShaOut = $<HTMLElement>("template-sha");
  const verifyCmdOut = $<HTMLElement>("verify-cmd");
  const sourceLink = $<HTMLAnchorElement>("source-link");
  const pcr0Out = $<HTMLElement>("pcr0");
  const cliOut = $<HTMLElement>("cli-cmd");
  const costTable = $<HTMLTableSectionElement>("cost-lines");
  const costTotal = $<HTMLElement>("cost-total");
  const costCaveats = $<HTMLUListElement>("cost-caveats");

  fillSelect(
    releaseSel,
    MANIFEST.releases.map((r) => ({ value: r.version, label: `${r.version} (${r.status})` })),
  );
  fillSelect(regionSel, AWS_REGIONS.map((r) => ({ value: r.id, label: `${r.label} — ${r.id}` })));
  fillSelect(
    instanceSel,
    AWS_INSTANCE_TYPES.map((t) => ({
      value: t.id,
      label: `${t.id} — ${t.arch === "arm64" ? "Graviton" : "x86"}, ${t.vcpu} vCPU, ${t.memoryGiB} GiB${t.note ? ` (${t.note})` : ""}`,
    })),
  );

  const currentRelease = (): Release =>
    MANIFEST.releases.find((r) => r.version === releaseSel.value) ?? MANIFEST.releases[0]!;

  function onReleaseChange() {
    const r = currentRelease();
    fillSelect(
      networkSel,
      r.networks.map((n) => ({
        value: n.id,
        label: n.disabledReason ? `${n.label} — ${n.disabledReason}` : n.label,
        disabled: !!n.disabledReason,
      })),
    );
    fillSelect(octezSel, r.octezVersions.map((v) => ({ value: v, label: v })));
    update();
  }

  function update() {
    const r = currentRelease();
    const aws = r.aws;
    const instance = AWS_INSTANCE_TYPES.find((t) => t.id === instanceSel.value) ?? AWS_INSTANCE_TYPES[0]!;
    const disk = Math.max(100, Math.min(4000, Number(diskInput.value) || 300));

    const stackErr = validateStackName(stackInput.value);
    stackError.textContent = stackErr ?? "";
    stackInput.setAttribute("aria-invalid", stackErr ? "true" : "false");

    const url = aws ? templateUrl(RELEASES_BASE_URL, r, aws.template) : "";
    const params: AwsDeployParams = {
      region: regionSel.value,
      stackName: stackInput.value,
      templateUrl: url,
      network: networkSel.value,
      octezVersion: octezSel.value,
      instanceType: instance.id,
      diskSizeGiB: disk,
      enableDal: dalInput.checked,
      enableBaker: bakerInput.checked,
    };

    templateUrlOut.textContent = url || "—";
    templateShaOut.textContent = aws?.templateSha256 ?? "—";
    verifyCmdOut.textContent = url ? `curl -fsSL '${url}' | shasum -a 256` : "";
    const enclave = aws?.enclave[instance.arch];
    pcr0Out.textContent = enclave ? `${enclave.pcr0} (${instance.arch})` : "—";
    sourceLink.href = `${r.sourceUrl}/tree/v${r.version}/templates/aws`;
    cliOut.textContent = url ? createStackCommand(params) : "";

    const reasons: string[] = [];
    if (!isDeployable(r)) reasons.push(`Release ${r.version} is ${r.status} and cannot be deployed yet.`);
    if (!RELEASES_BASE_URL) reasons.push("This build of the site has no release bucket configured.");
    if (!aws) reasons.push("This release has no AWS template.");
    else if (!enclave) reasons.push(`This release has no ${instance.arch} enclave image. Pick another instance type.`);
    if (stackErr) reasons.push("Fix the stack name.");
    if (!networkSel.value) reasons.push("Choose a network.");

    if (reasons.length === 0) {
      launchBtn.href = launchStackUrl(params);
      launchBtn.removeAttribute("aria-disabled");
      launchNote.textContent =
        "Opens the AWS console in your account. Review every resource before you click Create stack.";
    } else {
      launchBtn.removeAttribute("href");
      launchBtn.setAttribute("aria-disabled", "true");
      launchNote.textContent = reasons.join(" ");
    }

    const est = estimateAwsMonthly(instance, disk);
    costTable.replaceChildren(
      ...est.lines.map((l) =>
        el("tr", {}, [el("td", { textContent: l.label }), el("td", { textContent: formatUsd(l.usdPerMonth) })]),
      ),
    );
    costTotal.textContent = formatUsd(est.totalUsdPerMonth);
    costCaveats.replaceChildren(...est.caveats.map((c) => el("li", { textContent: c })));
  }

  releaseSel.addEventListener("change", onReleaseChange);
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", (e) => e.preventDefault());

  for (const btn of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
    btn.addEventListener("click", async () => {
      const target = document.getElementById(btn.dataset.copy!);
      if (!target?.textContent) return;
      try {
        await navigator.clipboard.writeText(target.textContent);
        const old = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = old), 1500);
      } catch {
        /* clipboard unavailable: the text is still selectable */
      }
    });
  }

  onReleaseChange();
}

init();
