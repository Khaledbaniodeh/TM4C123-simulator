#!/usr/bin/env bash
# Prints Renode API facts needed by the peripheral models (runs in CI only).
# All monitor output is reported as GitHub annotations (chunked).
set -uo pipefail

renode="$(node -e 'import("./scripts/lib/tools.mjs").then(m => console.log(m.renodeBinary()))')"
out="$(mktemp)"

cat > "$RUNNER_TEMP/probe.py" <<'PY'
import clr
from Antmicro.Renode.Peripherals.Timers import LimitTimer
from Antmicro.Renode.Peripherals.IRQControllers import NVIC
from Antmicro.Renode.Peripherals.CPU import BaseCPU
from Antmicro.Renode.Core import IMachine

def names(t, flt=lambda m: True):
    return sorted(set([m.Name for m in clr.GetClrType(t).GetMembers() if flt(m)]))

print("LT_CTOR " + " || ".join([str(c) for c in clr.GetClrType(LimitTimer).GetConstructors()]))
print("LT_MEMBERS " + ", ".join(names(LimitTimer, lambda m: m.DeclaringType == clr.GetClrType(LimitTimer))))
print("NVIC_CTOR " + " || ".join([str(c) for c in clr.GetClrType(NVIC).GetConstructors()]))
print("NVIC_PROPS " + ", ".join(sorted(set([p.Name + ":" + p.PropertyType.Name for p in clr.GetClrType(NVIC).GetProperties()]))))
print("CPU_PROPS " + ", ".join(sorted(set([p.Name + ":" + p.PropertyType.Name for p in clr.GetClrType(BaseCPU).GetProperties() if "Perf" in p.Name or "Mips" in p.Name or "Freq" in p.Name]))))
print("MACHINE_CLOCK " + ", ".join(sorted(set([p.Name + ":" + p.PropertyType.FullName for p in clr.GetClrType(IMachine).GetProperties() if "Clock" in p.Name]))))
print("MACHINE_METHODS " + ", ".join(sorted(set([m.Name for m in clr.GetClrType(IMachine).GetMethods() if "Peripheral" in m.Name]))))
PY

printf '%s\n' "include @$RUNNER_TEMP/probe.py" 'quit' \
  | timeout 120 "$renode" --console --disable-gui --plain --hide-log > "$out" 2>&1
echo "renode exit: $?"

# Chunk the whole output into at most 10 annotations of ~3500 characters.
python3 - "$out" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
text = text.replace("%", "%25").replace("\r", "")
chunks = [text[i:i + 3500] for i in range(0, len(text), 3500)][:10]
for n, chunk in enumerate(chunks, 1):
    print(f"::notice title=Renode probe ({n}/{len(chunks)})::" + chunk.replace("\n", "%0A"))
PY
