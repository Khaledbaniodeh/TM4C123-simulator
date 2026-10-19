//
// TM4C123 Simulator — System Control (SYSCTL) model, GPIO clock-gating subset.
//
// Base address 0x400FE000 (TM4C123GH6PM datasheet SPMS376E, chapter 5).
//
// Modeled registers:
//   0x108 RCGC2     legacy run-mode clock gating, bits [5:0] = GPIO ports A-F
//   0x608 RCGCGPIO  run-mode clock gating for GPIO ports A-F, bits [5:0]
//   0xA08 PRGPIO    GPIO peripheral-ready, read-only
//
// Modeling assumptions (documented in docs/PERIPHERAL_MODELS.md):
//   - A GPIO port is clocked when its RCGCGPIO bit OR its legacy RCGC2 bit
//     is set. The datasheet discourages mixing the two register sets.
//   - PRGPIO reports a port ready immediately after its clock is enabled.
//     Real silicon needs a few system clocks; firmware that polls PRGPIO
//     behaves the same either way.
//   - Every other offset is unsupported: reads return 0, writes are
//     ignored, and both emit an `unsupported-register-access` event.
//
using System;

using Antmicro.Renode.Core;
using Antmicro.Renode.Logging;
using Antmicro.Renode.Peripherals.Bus;

namespace Antmicro.Renode.Peripherals.Miscellaneous
{
    [AllowedTranslations(AllowedTranslation.ByteToDoubleWord | AllowedTranslation.WordToDoubleWord)]
    public class TM4C123SystemControl : IDoubleWordPeripheral, IKnownSize
    {
        public TM4C123SystemControl(IMachine machine)
        {
            this.machine = machine;
            Reset();
        }

        public long Size => 0x1000;

        /// <summary>Raised whenever the effective GPIO clock-gate mask changes.</summary>
        public event Action GpioClocksChanged;

        public bool IsGpioClockEnabled(int port)
        {
            return (EffectiveGpioClocks & (1u << port)) != 0;
        }

        public uint EffectiveGpioClocks => (rcgcgpio | rcgc2) & GpioPortMask;

        public void Reset()
        {
            rcgcgpio = 0;
            rcgc2 = 0;
            GpioClocksChanged?.Invoke();
        }

        public uint ReadDoubleWord(long offset)
        {
            switch((Registers)offset)
            {
            case Registers.RCGC2:
                return rcgc2;
            case Registers.RCGCGPIO:
                return rcgcgpio;
            case Registers.PRGPIO:
                return EffectiveGpioClocks;
            default:
                ReportUnsupported(offset, "read", 0);
                return 0;
            }
        }

        public void WriteDoubleWord(long offset, uint value)
        {
            var before = EffectiveGpioClocks;
            switch((Registers)offset)
            {
            case Registers.RCGC2:
                // Only the GPIO gates are modeled; other legacy bits are
                // stored for read-back so read-modify-write sequences work.
                rcgc2 = value & Rcgc2WritableMask;
                if((value & ~GpioPortMask) != 0)
                {
                    this.Log(LogLevel.Warning, "RCGC2 bits 0x{0:X} gate peripherals that are not modeled", value & ~GpioPortMask);
                }
                break;
            case Registers.RCGCGPIO:
                rcgcgpio = value & GpioPortMask;
                break;
            case Registers.PRGPIO:
                ReportUnsupported(offset, "write", value, "PRGPIO is read-only");
                return;
            default:
                ReportUnsupported(offset, "write", value);
                return;
            }

            var after = EffectiveGpioClocks;
            if(before != after)
            {
                for(var port = 0; port < GpioPortCount; port++)
                {
                    var mask = 1u << port;
                    if((before & mask) != (after & mask))
                    {
                        TM4C123EventSink.Emit(machine, "clock-gate-changed",
                            "\"peripheral\":" + TM4C123EventSink.Str("GPIO" + (char)('A' + port)) +
                            ",\"enabled\":" + ((after & mask) != 0 ? "true" : "false"));
                    }
                }
                GpioClocksChanged?.Invoke();
            }
        }

        /// <summary>Monitor helper: echoes its argument so a controller can detect command completion.</summary>
        public string Marker(string id)
        {
            return id;
        }

        private void ReportUnsupported(long offset, string access, uint value, string reason = "register not modeled")
        {
            this.Log(LogLevel.Warning, "Unsupported SYSCTL {0} at offset 0x{1:X3} (value 0x{2:X8}): {3}", access, offset, value, reason);
            TM4C123EventSink.Emit(machine, "unsupported-register-access",
                "\"peripheral\":\"SYSCTL\"" +
                ",\"address\":" + TM4C123EventSink.Hex((ulong)(BaseAddress + offset)) +
                ",\"offset\":" + TM4C123EventSink.Hex((ulong)offset) +
                ",\"access\":" + TM4C123EventSink.Str(access) +
                ",\"value\":" + TM4C123EventSink.Hex(value) +
                ",\"reason\":" + TM4C123EventSink.Str(reason));
        }

        private uint rcgcgpio;
        private uint rcgc2;

        private readonly IMachine machine;

        private const long BaseAddress = 0x400FE000;
        private const int GpioPortCount = 6;
        private const uint GpioPortMask = 0x3F;
        // RCGC2 implemented bits on TM4C123GH6PM: GPIO A-F [5:0], UDMA [13], USB0 [16].
        private const uint Rcgc2WritableMask = 0x0001203F;

        private enum Registers : long
        {
            RCGC2 = 0x108,
            RCGCGPIO = 0x608,
            PRGPIO = 0xA08,
        }
    }
}
