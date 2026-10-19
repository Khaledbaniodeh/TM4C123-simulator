//
// TM4C123 Simulator — System Control (SYSCTL) model: clock gating and the
// run-mode clock tree.
//
// Base address 0x400FE000 (TM4C123GH6PM datasheet SPMS376E, chapter 5).
//
// Modeled registers:
//   0x050 RIS        raw interrupt status: PLLLRIS (bit 6) on PLL lock
//   0x054 IMC        interrupt mask (stored; SYSCTL interrupt not modeled)
//   0x058 MISC       masked status / write-1-to-clear RIS bits
//   0x060 RCC        run-mode clock configuration
//   0x070 RCC2       run-mode clock configuration 2 (USERCC2 overrides RCC)
//   0x104 RCGC1      legacy gating, bits 16-19 = TIMER0-3
//   0x108 RCGC2      legacy gating, bits 5:0 = GPIO ports A-F
//   0x168 PLLSTAT    PLL lock status (bit 0)
//   0x604 RCGCTIMER  16/32-bit timer gating, bits 5:0 = TIMER0-5
//   0x608 RCGCGPIO   GPIO gating, bits 5:0 = ports A-F
//   0xA04 PRTIMER    timer peripheral-ready (read-only)
//   0xA08 PRGPIO     GPIO peripheral-ready (read-only)
//
// Clock model (docs/PERIPHERAL_MODELS.md):
//   - System clock follows the datasheet's RCC/RCC2 rules: oscillator
//     source (MOSC from the XTAL field, PIOSC 16 MHz, PIOSC/4, LFIOSC,
//     32.768 kHz), PLL 400 MHz VCO (200 MHz after the /2 unless DIV400),
//     and the SYSDIV/SYSDIV2(+LSB) divider.
//   - The PLL locks immediately when powered: PLLLRIS is set on power-up and
//     on every RCC/RCC2 write while powered (TivaWare and CMSIS SystemInit
//     clear it and wait for it); PLLSTAT.LOCK = powered.
//   - The CPU instruction rate (Renode MIPS) and the SysTick core clock
//     follow the system clock; GPTM timers subscribe to SystemClockChanged.
//   - Every other offset is unsupported: reads return 0, writes are ignored,
//     both emit `unsupported-register-access`.
//
using System;
using System.Linq;
using System.Reflection;

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

        /// <summary>Raised whenever the effective timer clock-gate mask changes.</summary>
        public event Action TimerClocksChanged;

        /// <summary>Raised with the new frequency (Hz) whenever the system clock changes.</summary>
        public event Action<long> SystemClockChanged;

        public bool IsGpioClockEnabled(int port)
        {
            return (EffectiveGpioClocks & (1u << port)) != 0;
        }

        public bool IsTimerClockEnabled(int timer)
        {
            return (EffectiveTimerClocks & (1u << timer)) != 0;
        }

        public uint EffectiveGpioClocks => (rcgcgpio | rcgc2) & GpioPortMask;

        /// <summary>RCGCTIMER bits 5:0, OR legacy RCGC1 bits 19:16 (TIMER0-3).</summary>
        public uint EffectiveTimerClocks => (rcgctimer | ((rcgc1 >> 16) & 0xF)) & TimerMask;

        /// <summary>Current system clock in Hz (derived from RCC/RCC2).</summary>
        public long SystemClockHz { get; private set; }

        public string SystemClockSource { get; private set; } = "PIOSC";

        public void Reset()
        {
            rcgcgpio = 0;
            rcgc2 = 0;
            rcgc1 = 0;
            rcgctimer = 0;
            rcc = RccReset;
            rcc2 = Rcc2Reset;
            ris = 0;
            imc = 0;
            SystemClockHz = 0;
            GpioClocksChanged?.Invoke();
            TimerClocksChanged?.Invoke();
            UpdateSystemClock("reset");
        }

        public uint ReadDoubleWord(long offset)
        {
            switch((Registers)offset)
            {
            case Registers.RIS: return ris;
            case Registers.IMC: return imc;
            case Registers.MISC: return ris & imc;
            case Registers.RCC: return rcc;
            case Registers.RCC2: return rcc2;
            case Registers.RCGC1: return rcgc1;
            case Registers.RCGC2: return rcgc2;
            case Registers.PLLSTAT: return PllPowered ? 1u : 0u;
            case Registers.RCGCTIMER: return rcgctimer;
            case Registers.RCGCGPIO: return rcgcgpio;
            case Registers.PRTIMER: return EffectiveTimerClocks;
            case Registers.PRGPIO: return EffectiveGpioClocks;
            default:
                ReportUnsupported(offset, "read", 0);
                return 0;
            }
        }

        public void WriteDoubleWord(long offset, uint value)
        {
            var gpioBefore = EffectiveGpioClocks;
            var timerBefore = EffectiveTimerClocks;
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
            case Registers.RCGC1:
                rcgc1 = value;
                if((value & ~0x000F0000u) != 0)
                {
                    this.Log(LogLevel.Warning, "RCGC1 bits 0x{0:X} gate peripherals that are not modeled", value & ~0x000F0000u);
                }
                break;
            case Registers.RCGCGPIO:
                rcgcgpio = value & GpioPortMask;
                break;
            case Registers.RCGCTIMER:
                rcgctimer = value & TimerMask;
                break;
            case Registers.IMC:
                imc = value & RisMask;
                if(imc != 0)
                {
                    ReportUnsupported(offset, "write", value, "the system-control interrupt is not modeled (IMC stored only)");
                }
                return;
            case Registers.MISC:
                ris &= ~(value & RisMask); // write 1 to clear
                return;
            case Registers.RCC:
            {
                var wasPowered = PllPowered;
                rcc = value;
                OnClockRegisterWritten(wasPowered);
                return;
            }
            case Registers.RCC2:
            {
                var wasPowered = PllPowered;
                rcc2 = value;
                OnClockRegisterWritten(wasPowered);
                return;
            }
            case Registers.RIS:
            case Registers.PLLSTAT:
            case Registers.PRGPIO:
            case Registers.PRTIMER:
                ReportUnsupported(offset, "write", value, "register is read-only");
                return;
            default:
                ReportUnsupported(offset, "write", value);
                return;
            }

            EmitGateChanges(gpioBefore, EffectiveGpioClocks, "GPIO", 6, (port) => "GPIO" + (char)('A' + port));
            EmitGateChanges(timerBefore, EffectiveTimerClocks, "TIMER", 6, (timer) => "TIMER" + timer);
            if(gpioBefore != EffectiveGpioClocks)
            {
                GpioClocksChanged?.Invoke();
            }
            if(timerBefore != EffectiveTimerClocks)
            {
                TimerClocksChanged?.Invoke();
            }
        }

        /// <summary>Monitor helper: echoes its argument so a controller can detect command completion.</summary>
        public string Marker(string id)
        {
            return id;
        }

        // --- Clock tree -------------------------------------------------------

        private bool UseRcc2 => (rcc2 & Rcc2UseRcc2) != 0;

        private bool PllPowered => UseRcc2 ? (rcc2 & Rcc2Pwrdn2) == 0 : (rcc & RccPwrdn) == 0;

        private void OnClockRegisterWritten(bool wasPowered)
        {
            // The PLL re-locks after it powers up or its configuration changes.
            if(PllPowered)
            {
                ris |= RisPllLock;
            }
            UpdateSystemClock(wasPowered || !PllPowered ? "clock-register" : "pll-powered");
        }

        private void UpdateSystemClock(string cause)
        {
            string source;
            var hz = ComputeSystemClock(out source, out var pll, out var divisor, out var warning);
            if(warning != null)
            {
                this.Log(LogLevel.Warning, "Clock configuration: {0}", warning);
                TM4C123EventSink.Emit(machine, "clock-configuration-warning",
                    "\"peripheral\":\"SYSCTL\",\"detail\":" + TM4C123EventSink.Str(warning) +
                    ",\"rcc\":" + TM4C123EventSink.Hex(rcc) + ",\"rcc2\":" + TM4C123EventSink.Hex(rcc2));
            }
            if(hz == SystemClockHz && source == SystemClockSource)
            {
                return;
            }
            SystemClockHz = hz;
            SystemClockSource = source;
            TM4C123EventSink.Emit(machine, "system-clock-changed",
                "\"peripheral\":\"SYSCTL\"" +
                ",\"hz\":" + TM4C123EventSink.Num(hz) +
                ",\"source\":" + TM4C123EventSink.Str(source) +
                ",\"pll\":" + (pll ? "true" : "false") +
                ",\"divisor\":" + TM4C123EventSink.Num(divisor) +
                ",\"cause\":" + TM4C123EventSink.Str(cause));
            ApplyClockToCore(hz);
            SystemClockChanged?.Invoke(hz);
        }

        /// <summary>Datasheet RCC/RCC2 rules (SPMS376E §5.2.5, Tables 5-4 to 5-6).</summary>
        private long ComputeSystemClock(out string source, out bool pll, out long divisor, out string warning)
        {
            warning = null;
            var mainOscHz = XtalHz((rcc >> 6) & 0x1F);
            var mainOscDisabled = (rcc & RccMoscDis) != 0;
            long sourceHz;
            int oscsrc;
            bool bypass;

            if(UseRcc2)
            {
                oscsrc = (int)((rcc2 >> 4) & 0x7);
                bypass = (rcc2 & Rcc2Bypass2) != 0;
            }
            else
            {
                oscsrc = (int)((rcc >> 4) & 0x3);
                bypass = (rcc & RccBypass) != 0;
            }

            switch(oscsrc)
            {
            case 0:
                source = "MOSC";
                sourceHz = mainOscHz;
                if(mainOscDisabled)
                {
                    warning = "main oscillator selected while RCC.MOSCDIS=1 (the clock would stop on silicon)";
                }
                break;
            case 1:
                source = "PIOSC";
                sourceHz = 16_000_000;
                break;
            case 2:
                source = "PIOSC/4";
                sourceHz = 4_000_000;
                break;
            case 3:
                source = "LFIOSC";
                sourceHz = 30_000; // nominal; datasheet range 10-90 kHz
                break;
            case 7:
                source = "32.768 kHz";
                sourceHz = 32_768;
                break;
            default:
                source = "reserved";
                sourceHz = 16_000_000;
                warning = $"reserved OSCSRC2 value {oscsrc}";
                break;
            }

            pll = !bypass;
            var useSysDiv = (rcc & RccUseSysDiv) != 0;
            if(pll)
            {
                if(!PllPowered)
                {
                    warning = "PLL selected (BYPASS=0) while powered down; using the oscillator";
                    pll = false;
                }
                else if(oscsrc != 0 && oscsrc != 1)
                {
                    warning = $"PLL reference must be MOSC or PIOSC (OSCSRC={oscsrc})";
                }
                else if(oscsrc == 0 && mainOscHz < 5_000_000)
                {
                    warning = "PLL reference crystal below 5 MHz is not supported";
                }
            }

            if(pll)
            {
                // The system divider is always used with the PLL.
                long vcoHz;
                if(UseRcc2 && (rcc2 & Rcc2Div400) != 0)
                {
                    vcoHz = 400_000_000;
                    divisor = (((rcc2 >> 23) & 0x3F) << 1 | ((rcc2 >> 22) & 0x1)) + 1;
                }
                else
                {
                    vcoHz = 200_000_000;
                    divisor = UseRcc2 ? ((rcc2 >> 23) & 0x3F) + 1 : ((rcc >> 23) & 0xF) + 1;
                }
                var hz = vcoHz / divisor;
                if(hz > 80_000_000)
                {
                    warning = $"PLL divider gives {hz} Hz; the TM4C123GH6PM maximum is 80 MHz";
                }
                source = "PLL(" + source + ")";
                return hz;
            }

            divisor = 1;
            if(useSysDiv)
            {
                divisor = UseRcc2 ? ((rcc2 >> 23) & 0x3F) + 1 : ((rcc >> 23) & 0xF) + 1;
            }
            return sourceHz / divisor;
        }

        /// <summary>RCC.XTAL encoding (SPMS376E Table 5-4 / RCC register description).</summary>
        private static long XtalHz(uint xtal)
        {
            switch(xtal)
            {
            case 0x06: return 4_000_000;
            case 0x07: return 4_096_000;
            case 0x08: return 4_915_200;
            case 0x09: return 5_000_000;
            case 0x0A: return 5_120_000;
            case 0x0B: return 6_000_000;
            case 0x0C: return 6_144_000;
            case 0x0D: return 7_372_800;
            case 0x0E: return 8_000_000;
            case 0x0F: return 8_192_000;
            case 0x10: return 10_000_000;
            case 0x11: return 12_000_000;
            case 0x12: return 12_288_000;
            case 0x13: return 13_560_000;
            case 0x14: return 14_318_180;
            case 0x15: return 16_000_000;
            case 0x16: return 16_384_000;
            case 0x17: return 18_000_000;
            case 0x18: return 20_000_000;
            case 0x19: return 24_000_000;
            case 0x1A: return 25_000_000;
            default: return 16_000_000;
            }
        }

        /// <summary>
        /// Makes the CPU instruction rate (1 instruction per cycle) and the
        /// SysTick core clock follow the system clock. Uses reflection so the
        /// model does not depend on Renode member names at compile time; a
        /// missing member is reported instead of silently ignored.
        /// </summary>
        private void ApplyClockToCore(long hz)
        {
            var mips = Math.Max(1, hz / 1_000_000);
            foreach(var cpu in machine.SystemBus.GetCPUs())
            {
                if(!SetNumericProperty(cpu, "PerformanceInMips", mips))
                {
                    ReportClockApplyFailure("CPU", "PerformanceInMips");
                }
            }
            var nvic = machine.GetPeripheralsOfType<IPeripheral>().FirstOrDefault(p => p.GetType().Name == "NVIC");
            if(nvic != null && !SetNumericProperty(nvic, "Frequency", hz) && !SetNumericProperty(nvic, "SystickFrequency", hz))
            {
                ReportClockApplyFailure("NVIC SysTick", "Frequency");
            }
        }

        private static bool SetNumericProperty(object target, string name, long value)
        {
            var property = target.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if(property == null || !property.CanWrite)
            {
                return false;
            }
            property.SetValue(target, Convert.ChangeType(value, property.PropertyType));
            return true;
        }

        private void ReportClockApplyFailure(string target, string member)
        {
            TM4C123EventSink.Emit(machine, "unsupported-feature",
                "\"peripheral\":\"SYSCTL\",\"feature\":\"clock-propagation\",\"detail\":" +
                TM4C123EventSink.Str($"could not apply the system clock to {target} ({member} not found)"));
        }

        // --- Reporting --------------------------------------------------------

        private void EmitGateChanges(uint before, uint after, string kind, int count, Func<int, string> name)
        {
            if(before == after)
            {
                return;
            }
            for(var index = 0; index < count; index++)
            {
                var mask = 1u << index;
                if((before & mask) != (after & mask))
                {
                    TM4C123EventSink.Emit(machine, "clock-gate-changed",
                        "\"peripheral\":" + TM4C123EventSink.Str(name(index)) +
                        ",\"enabled\":" + ((after & mask) != 0 ? "true" : "false"));
                }
            }
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
        private uint rcgc1;
        private uint rcgctimer;
        private uint rcc;
        private uint rcc2;
        private uint ris;
        private uint imc;

        private readonly IMachine machine;

        private const long BaseAddress = 0x400FE000;
        private const uint GpioPortMask = 0x3F;
        private const uint TimerMask = 0x3F;
        // RCGC2 implemented bits on TM4C123GH6PM: GPIO A-F [5:0], UDMA [13], USB0 [16].
        private const uint Rcgc2WritableMask = 0x0001203F;

        private const uint RccReset = 0x078E3AD1;
        private const uint Rcc2Reset = 0x07C06810;
        private const uint RccMoscDis = 1u << 0;
        private const uint RccBypass = 1u << 11;
        private const uint RccPwrdn = 1u << 13;
        private const uint RccUseSysDiv = 1u << 22;
        private const uint Rcc2Bypass2 = 1u << 11;
        private const uint Rcc2Pwrdn2 = 1u << 13;
        private const uint Rcc2Div400 = 1u << 30;
        private const uint Rcc2UseRcc2 = 1u << 31;
        private const uint RisPllLock = 1u << 6;
        private const uint RisMask = 0x00000052; // BOR1, MOFRIS, PLLLRIS and friends; only PLLLRIS is ever set

        private enum Registers : long
        {
            RIS = 0x050,
            IMC = 0x054,
            MISC = 0x058,
            RCC = 0x060,
            RCC2 = 0x070,
            RCGC1 = 0x104,
            RCGC2 = 0x108,
            PLLSTAT = 0x168,
            RCGCTIMER = 0x604,
            RCGCGPIO = 0x608,
            PRTIMER = 0xA04,
            PRGPIO = 0xA08,
        }
    }
}
