//
// TM4C123 Simulator — placeholder for TM4C123 peripherals that exist on the
// silicon but are not modeled yet (UART, timers, ADC, ...).
//
// Mapping these regions explicitly means firmware that touches an
// unimplemented peripheral produces a named, structured
// `unimplemented-peripheral-access` event instead of an anonymous bus
// warning. Reads return 0 and writes are ignored — the event makes that
// visible to the user rather than letting the access silently "succeed".
//
// To keep busy polling loops from flooding the event stream, each distinct
// (offset, access) pair is reported once per reset; the total count is
// available through the AccessCount monitor property.
//
using System.Collections.Generic;

using Antmicro.Renode.Core;
using Antmicro.Renode.Logging;
using Antmicro.Renode.Peripherals.Bus;

namespace Antmicro.Renode.Peripherals.Miscellaneous
{
    [AllowedTranslations(AllowedTranslation.ByteToDoubleWord | AllowedTranslation.WordToDoubleWord)]
    public class TM4C123UnimplementedPeripheral : IDoubleWordPeripheral, IKnownSize
    {
        public TM4C123UnimplementedPeripheral(IMachine machine, string peripheralName, long baseAddress, long size = 0x1000)
        {
            this.machine = machine;
            this.peripheralName = peripheralName;
            this.baseAddress = baseAddress;
            Size = size;
        }

        public long Size { get; }

        public long AccessCount { get; private set; }

        public void Reset()
        {
            reported.Clear();
            AccessCount = 0;
        }

        public uint ReadDoubleWord(long offset)
        {
            Report(offset, "read", 0);
            return 0;
        }

        public void WriteDoubleWord(long offset, uint value)
        {
            Report(offset, "write", value);
        }

        private void Report(long offset, string access, uint value)
        {
            AccessCount++;
            if(!reported.Add(offset * 2 + (access == "write" ? 1 : 0)))
            {
                return;
            }
            var address = (ulong)(baseAddress + offset);
            this.Log(LogLevel.Warning, "{0} is not modeled: {1} at 0x{2:X8} (value 0x{3:X8}) ignored", peripheralName, access, address, value);
            TM4C123EventSink.Emit(machine, "unimplemented-peripheral-access",
                "\"peripheral\":" + TM4C123EventSink.Str(peripheralName) +
                ",\"address\":" + TM4C123EventSink.Hex(address) +
                ",\"offset\":" + TM4C123EventSink.Hex((ulong)offset) +
                ",\"access\":" + TM4C123EventSink.Str(access) +
                ",\"value\":" + TM4C123EventSink.Hex(value) +
                ",\"reason\":" + TM4C123EventSink.Str(peripheralName + " is not modeled yet; reads return 0 and writes are ignored"));
        }

        private readonly HashSet<long> reported = new HashSet<long>();
        private readonly IMachine machine;
        private readonly string peripheralName;
        private readonly long baseAddress;
    }
}
