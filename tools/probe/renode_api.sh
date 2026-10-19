#!/usr/bin/env bash
# Prints Renode API facts needed by the peripheral models (runs in CI only).
# Output lines from the embedded Python are turned into GitHub annotations.
set -euo pipefail

renode="$(node -e 'import("./scripts/lib/tools.mjs").then(m => console.log(m.renodeBinary()))')"

commands=(
  'python "import clr; from Antmicro.Renode.Peripherals.Timers import LimitTimer; print \"LT_CTOR \" + \" || \".join([str(c) for c in clr.GetClrType(LimitTimer).GetConstructors()])"'
  'python "import clr; from Antmicro.Renode.Peripherals.Timers import LimitTimer; t=clr.GetClrType(LimitTimer); print \"LT_MEMBERS \" + \", \".join(sorted(set([m.Name for m in t.GetMembers() if m.DeclaringType == t])))"'
  'python "import clr; from Antmicro.Renode.Peripherals.IRQControllers import NVIC; t=clr.GetClrType(NVIC); print \"NVIC_PROPS \" + \", \".join(sorted(set([p.Name + \":\" + p.PropertyType.Name for p in t.GetProperties()])))"'
  'python "import clr; from Antmicro.Renode.Peripherals.IRQControllers import NVIC; t=clr.GetClrType(NVIC); print \"NVIC_CTOR \" + \" || \".join([str(c) for c in t.GetConstructors()])"'
  'python "import clr; from Antmicro.Renode.Peripherals.CPU import BaseCPU; t=clr.GetClrType(BaseCPU); print \"CPU_PROPS \" + \", \".join(sorted(set([p.Name + \":\" + p.PropertyType.Name for p in t.GetProperties() if \"Perf\" in p.Name or \"Mips\" in p.Name or \"Freq\" in p.Name])))"'
  'python "import clr; from Antmicro.Renode.Core import IMachine; t=clr.GetClrType(IMachine); print \"MACHINE_CLOCK \" + \", \".join(sorted(set([p.Name + \":\" + p.PropertyType.FullName for p in t.GetProperties() if \"Clock\" in p.Name])))"'
  'mach create "probe"'
  'machine LoadPlatformDescriptionFromString "nvic: IRQControllers.NVIC @ sysbus 0xE000E000 { -> cpu@0 }; cpu: CPU.CortexM @ sysbus { cpuType: \"cortex-m4f\"; nvic: nvic }"'
  'python "n=self.Machine[\"sysbus.nvic\"]; print \"NVIC_INSTANCE \" + \", \".join([m for m in dir(n) if \"req\" in m.lower() or \"tick\" in m.lower()])"'
  'quit'
)

printf '%s\n' "${commands[@]}" | timeout 120 "$renode" --console --disable-gui --plain --hide-log 2>&1 \
  | grep -E '^(LT_|NVIC_|CPU_|MACHINE_)|error|Error' \
  | while IFS= read -r line; do
      escaped="${line//'%'/'%25'}"
      echo "::notice title=${line%% *}::${escaped:0:3800}"
    done
