//
// TM4C123 Simulator — 16/32-bit General-Purpose Timer (GPTM) model.
//
// One instance per TIMER0-5 (TM4C123GH6PM datasheet SPMS376E, chapter 11).
// Built on Renode's LimitTimer, which counts in emulation virtual time.
//
// Modeled:
//   - GPTMCFG 0x0 (32-bit, timer A only) and 0x4 (16-bit, A and B split)
//   - One-shot and periodic modes, down (default) and up count (TnCDIR)
//   - 16-bit prescaler GPTMTnPR as a true clock divider (period =
//     (TnILR + 1) * (TnPR + 1) system clocks); ignored in 32-bit mode
//   - Timeout interrupts: GPTMIMR / RIS / MIS / ICR, separate NVIC lines for
//     timer A and timer B; one-shot mode clears TnEN at timeout
//   - Counter read-back GPTMTnR / GPTMTnV, writable GPTMTnV
//   - Clock gating (SYSCTL RCGCTIMER / legacy RCGC1): unclocked access is a
//     precise bus fault, as for the GPIO model
//   - Counting at the live system clock (SYSCTL.SystemClockChanged)
//
// Not modeled (reported as `unsupported-feature`, never silently accepted):
//   capture modes, PWM, RTC mode, match interrupts, wait-on-trigger, ADC
//   trigger output, snapshot mode, stall-on-debug, synchronized start.
//
// Simplifications (documented in docs/PERIPHERAL_MODELS.md):
//   - Writing TnILR while running reloads the counter immediately.
//   - In 16-bit prescaled mode, GPTMTnPV reads 0 (prescaler phase not exposed).
//
using System;

using Antmicro.Renode.Core;
using Antmicro.Renode.Logging;
using Antmicro.Renode.Peripherals.Bus;
using Antmicro.Renode.Peripherals.Miscellaneous;
using Antmicro.Renode.Time;

namespace Antmicro.Renode.Peripherals.Timers
{
    [AllowedTranslations(AllowedTranslation.ByteToDoubleWord | AllowedTranslation.WordToDoubleWord)]
    public class TM4C123GeneralPurposeTimer : IDoubleWordPeripheral, IKnownSize
    {
        public TM4C123GeneralPurposeTimer(IMachine machine, TM4C123SystemControl systemControl, int timerIndex)
        {
            if(timerIndex < 0 || timerIndex > 5)
            {
                throw new ArgumentOutOfRangeException(nameof(timerIndex));
            }
            this.machine = machine;
            this.systemControl = systemControl;
            this.timerIndex = timerIndex;
            name = "TIMER" + timerIndex;
            IRQA = new GPIO();
            IRQB = new GPIO();
            halves = new[] { new Half(this, 'A'), new Half(this, 'B') };
            systemControl.SystemClockChanged += hz =>
            {
                foreach(var half in halves)
                {
                    half.Counter.Frequency = (ulong)Math.Max(1, hz);
                }
            };
            Reset();
        }

        public long Size => 0x1000;

        public GPIO IRQA { get; }

        public GPIO IRQB { get; }

        public void Reset()
        {
            config = 0;
            ctl = 0;
            imr = 0;
            ris = 0;
            foreach(var half in halves)
            {
                half.Reset();
            }
            UpdateInterrupts();
        }

        public uint ReadDoubleWord(long offset)
        {
            RequireClock(offset, "read", 0);
            switch((Registers)offset)
            {
            case Registers.CFG: return config;
            case Registers.TAMR: return halves[0].ModeRegister;
            case Registers.TBMR: return halves[1].ModeRegister;
            case Registers.CTL: return ctl;
            case Registers.IMR: return imr;
            case Registers.RIS: return ris;
            case Registers.MIS: return ris & imr;
            case Registers.TAILR: return halves[0].Interval;
            case Registers.TBILR: return halves[1].Interval;
            case Registers.TAMATCHR: return halves[0].Match;
            case Registers.TBMATCHR: return halves[1].Match;
            case Registers.TAPR: return halves[0].Prescale;
            case Registers.TBPR: return halves[1].Prescale;
            case Registers.TAPMR: return halves[0].PrescaleMatch;
            case Registers.TBPMR: return halves[1].PrescaleMatch;
            case Registers.TAR:
            case Registers.TAV: return halves[0].CounterValue;
            case Registers.TBR:
            case Registers.TBV: return halves[1].CounterValue;
            case Registers.TAPV:
            case Registers.TBPV: return 0;
            case Registers.PP: return 0; // 16/32-bit timer (SIZE = 0)
            case Registers.ICR:
                ReportUnsupported(offset, "read", 0, "GPTMICR is write-only");
                return 0;
            default:
                ReportUnsupported(offset, "read", 0, "register not modeled");
                return 0;
            }
        }

        public void WriteDoubleWord(long offset, uint value)
        {
            RequireClock(offset, "write", value);
            switch((Registers)offset)
            {
            case Registers.CFG:
                if((ctl & (CtlTaen | CtlTben)) != 0)
                {
                    ReportUnsupportedFeature("cfg-while-enabled", "GPTMCFG written while a timer is enabled; the datasheet requires disabling first (ignored)");
                    return;
                }
                config = value & 0x7;
                if(config != 0 && config != 4)
                {
                    ReportUnsupportedFeature("rtc-or-reserved-config", $"GPTMCFG=0x{config:X} (RTC or reserved) is not modeled");
                }
                break;
            case Registers.TAMR:
                halves[0].SetMode(value);
                break;
            case Registers.TBMR:
                halves[1].SetMode(value);
                break;
            case Registers.CTL:
                SetControl(value);
                break;
            case Registers.IMR:
                imr = value & ImrImplemented;
                var unsupported = imr & ~(ImrTatoim | ImrTbtoim);
                if(unsupported != 0)
                {
                    ReportUnsupportedFeature("interrupt-source", $"GPTMIMR bits 0x{unsupported:X} (capture/match/RTC/write-update) are not modeled; only timeout interrupts fire");
                }
                UpdateInterrupts();
                break;
            case Registers.ICR:
                ris &= ~value; // write 1 to clear
                UpdateInterrupts();
                break;
            case Registers.TAILR:
                halves[0].SetInterval(value);
                break;
            case Registers.TBILR:
                halves[1].SetInterval(value);
                break;
            case Registers.TAMATCHR:
                halves[0].Match = value;
                break;
            case Registers.TBMATCHR:
                halves[1].Match = value;
                break;
            case Registers.TAPR:
                halves[0].SetPrescale(value & 0xFF);
                break;
            case Registers.TBPR:
                halves[1].SetPrescale(value & 0xFF);
                break;
            case Registers.TAPMR:
                halves[0].PrescaleMatch = value & 0xFF;
                break;
            case Registers.TBPMR:
                halves[1].PrescaleMatch = value & 0xFF;
                break;
            case Registers.TAV:
                halves[0].SetCounter(value);
                break;
            case Registers.TBV:
                halves[1].SetCounter(value);
                break;
            case Registers.SYNC:
                ReportUnsupportedFeature("synchronized-start", "GPTMSYNC is not modeled");
                break;
            case Registers.RIS:
            case Registers.MIS:
            case Registers.TAR:
            case Registers.TBR:
                ReportUnsupported(offset, "write", value, "register is read-only");
                break;
            default:
                ReportUnsupported(offset, "write", value, "register not modeled");
                break;
            }
        }

        // --- Behavior ---------------------------------------------------------

        private bool Is32Bit => config == 0;

        private void SetControl(uint value)
        {
            var previous = ctl;
            ctl = value & 0x0000_7F7F;
            var unsupported = ctl & (CtlTaote | CtlTbote | CtlRtcen | CtlTapwml | CtlTbpwml | CtlTaevent | CtlTbevent);
            if(unsupported != 0)
            {
                ReportUnsupportedFeature("control-bits", $"GPTMCTL bits 0x{unsupported:X} (ADC trigger, RTC, PWM, capture events) are not modeled");
            }
            halves[0].SetEnabled((ctl & CtlTaen) != 0, (previous & CtlTaen) == 0);
            // In 32-bit mode timer B is unused; TBEN has no effect.
            halves[1].SetEnabled(!Is32Bit && (ctl & CtlTben) != 0, (previous & CtlTben) == 0);
        }

        private void OnTimeout(Half half)
        {
            ris |= half.Name == 'A' ? RisTatoris : RisTbtoris;
            if(half.OneShot)
            {
                ctl &= half.Name == 'A' ? ~CtlTaen : ~CtlTben;
                half.Counter.Enabled = false;
            }
            UpdateInterrupts();
        }

        private void UpdateInterrupts()
        {
            var masked = ris & imr;
            SetLine(IRQA, ref irqA, (masked & 0x00FF) != 0, 'A', masked);
            SetLine(IRQB, ref irqB, (masked & 0xFF00) != 0, 'B', masked);
        }

        private void SetLine(GPIO line, ref bool current, bool asserted, char half, uint masked)
        {
            if(asserted == current)
            {
                return;
            }
            current = asserted;
            line.Set(asserted);
            TM4C123EventSink.Emit(machine, "interrupt-line-changed",
                "\"peripheral\":" + TM4C123EventSink.Str(name + half) +
                ",\"asserted\":" + (asserted ? "true" : "false") +
                ",\"mis\":" + TM4C123EventSink.Hex(masked));
        }

        private void RequireClock(long offset, string access, uint value)
        {
            if(systemControl.IsTimerClockEnabled(timerIndex))
            {
                return;
            }
            var address = BaseAddress + offset;
            this.Log(LogLevel.Warning, "{0}: {1} at 0x{2:X8} while the timer clock is disabled -> bus fault", name, access, address);
            TM4C123EventSink.Emit(machine, "bus-fault",
                "\"peripheral\":" + TM4C123EventSink.Str(name) +
                ",\"address\":" + TM4C123EventSink.Hex((ulong)address) +
                ",\"access\":" + TM4C123EventSink.Str(access) +
                ",\"value\":" + TM4C123EventSink.Hex(value) +
                ",\"reason\":" + TM4C123EventSink.Str("timer clock is disabled (SYSCTL RCGCTIMER)"));
            throw new BusAccessException(BusAccessError.AddressError);
        }

        private long BaseAddress => 0x40030000 + 0x1000 * timerIndex;

        private void ReportUnsupported(long offset, string access, uint value, string reason)
        {
            this.Log(LogLevel.Warning, "{0}: unsupported {1} at offset 0x{2:X3}: {3}", name, access, offset, reason);
            TM4C123EventSink.Emit(machine, "unsupported-register-access",
                "\"peripheral\":" + TM4C123EventSink.Str(name) +
                ",\"address\":" + TM4C123EventSink.Hex((ulong)(BaseAddress + offset)) +
                ",\"offset\":" + TM4C123EventSink.Hex((ulong)offset) +
                ",\"access\":" + TM4C123EventSink.Str(access) +
                ",\"value\":" + TM4C123EventSink.Hex(value) +
                ",\"reason\":" + TM4C123EventSink.Str(reason));
        }

        private void ReportUnsupportedFeature(string feature, string detail)
        {
            this.Log(LogLevel.Warning, "{0}: {1}", name, detail);
            TM4C123EventSink.Emit(machine, "unsupported-feature",
                "\"peripheral\":" + TM4C123EventSink.Str(name) +
                ",\"feature\":" + TM4C123EventSink.Str(feature) +
                ",\"detail\":" + TM4C123EventSink.Str(detail));
        }

        /// <summary>Timer A or B: mode, interval, prescaler, and the virtual-time counter.</summary>
        private sealed class Half
        {
            public Half(TM4C123GeneralPurposeTimer owner, char name)
            {
                this.owner = owner;
                Name = name;
                // (clockSource, frequency, owner, localName, limit, direction, enabled, workMode, eventEnabled, autoUpdate, divider)
                Counter = new LimitTimer(owner.machine.ClockSource, 16_000_000UL, owner, owner.name + name,
                    1UL, Direction.Descending, false, WorkMode.Periodic, true, true, 1UL);
                Counter.LimitReached += () => owner.OnTimeout(this);
            }

            public char Name { get; }

            public LimitTimer Counter { get; }

            public uint ModeRegister { get; private set; }

            public uint Interval { get; private set; }

            public uint Match { get; set; }

            public uint Prescale { get; private set; }

            public uint PrescaleMatch { get; set; }

            public bool OneShot => (ModeRegister & 0x3) == 1;

            private bool CountUp => (ModeRegister & ModeCdir) != 0;

            private bool Wide => Name == 'A' && owner.Is32Bit;

            private uint Mask => Wide ? 0xFFFF_FFFFu : 0xFFFFu;

            public void Reset()
            {
                Counter.Enabled = false;
                ModeRegister = 0;
                Interval = Name == 'A' ? 0xFFFF_FFFFu : 0xFFFFu;
                Match = Name == 'A' ? 0xFFFF_FFFFu : 0xFFFFu;
                Prescale = 0;
                PrescaleMatch = 0;
                Counter.Frequency = (ulong)Math.Max(1, owner.systemControl.SystemClockHz);
                Configure();
            }

            public void SetMode(uint value)
            {
                ModeRegister = value & 0xFFF;
                var mode = ModeRegister & 0x3;
                if(mode == 3 || mode == 0)
                {
                    owner.ReportUnsupportedFeature("capture-mode", $"GPTMT{Name}MR mode {mode} (capture/reserved) is not modeled");
                }
                var extras = ModeRegister & (ModeAms | ModeMie | ModeWot | ModePwmie | ModeCmr);
                if(extras != 0)
                {
                    owner.ReportUnsupportedFeature("mode-bits", $"GPTMT{Name}MR bits 0x{extras:X} (PWM, match interrupt, wait-on-trigger, capture) are not modeled");
                }
                Configure();
            }

            public void SetInterval(uint value)
            {
                Interval = value & (Name == 'A' ? 0xFFFF_FFFFu : 0xFFFFu);
                Configure();
                if(Counter.Enabled)
                {
                    Counter.ResetValue(); // reload immediately (TnILD = 0 behavior)
                }
            }

            public void SetPrescale(uint value)
            {
                Prescale = value;
                Configure();
            }

            public void SetCounter(uint value)
            {
                var counts = Math.Min((ulong)(value & Mask) + 1, Counter.Limit);
                Counter.Value = CountUp ? Counter.Limit - counts : counts;
            }

            public uint CounterValue
            {
                get
                {
                    if(!Counter.Enabled)
                    {
                        return Interval & Mask;
                    }
                    // Descending LimitTimer runs Limit..1 for counts ILR..0.
                    var value = CountUp ? Counter.Value : Counter.Value - 1;
                    return (uint)value & Mask;
                }
            }

            public void SetEnabled(bool enabled, bool rising)
            {
                if(enabled && (rising || !Counter.Enabled))
                {
                    Configure();
                    Counter.ResetValue();
                    Counter.Enabled = true;
                    var periodClocks = ((ulong)(Interval & Mask) + 1) * Counter.Divider;
                    TM4C123EventSink.Emit(owner.machine, "timer-started",
                        "\"peripheral\":" + TM4C123EventSink.Str(owner.name + Name) +
                        ",\"width\":" + (Wide ? "32" : "16") +
                        ",\"mode\":" + TM4C123EventSink.Str(OneShot ? "one-shot" : "periodic") +
                        ",\"direction\":" + TM4C123EventSink.Str(CountUp ? "up" : "down") +
                        ",\"intervalLoad\":" + TM4C123EventSink.Num(Interval & Mask) +
                        ",\"prescale\":" + TM4C123EventSink.Num((long)(Counter.Divider - 1)) +
                        ",\"periodClocks\":" + TM4C123EventSink.Num((long)periodClocks) +
                        ",\"clockHz\":" + TM4C123EventSink.Num((long)Counter.Frequency));
                }
                else if(!enabled)
                {
                    Counter.Enabled = false;
                }
            }

            private void Configure()
            {
                // Counts ILR..0 (ILR + 1 clocks per period); the prescaler divides in 16-bit mode.
                Counter.Limit = (ulong)(Interval & Mask) + 1;
                Counter.Divider = Wide ? 1UL : (ulong)Prescale + 1;
                Counter.Mode = OneShot ? WorkMode.OneShot : WorkMode.Periodic;
                Counter.Direction = CountUp ? Direction.Ascending : Direction.Descending;
            }

            private readonly TM4C123GeneralPurposeTimer owner;

            private const uint ModeCmr = 1u << 2;
            private const uint ModeAms = 1u << 3;
            private const uint ModeCdir = 1u << 4;
            private const uint ModeMie = 1u << 5;
            private const uint ModeWot = 1u << 6;
            private const uint ModePwmie = 1u << 9;
        }

        private uint config;
        private uint ctl;
        private uint imr;
        private uint ris;
        private bool irqA;
        private bool irqB;

        private readonly Half[] halves;
        private readonly IMachine machine;
        private readonly TM4C123SystemControl systemControl;
        private readonly int timerIndex;
        private readonly string name;

        private const uint CtlTaen = 1u << 0;
        private const uint CtlTaevent = 3u << 2;
        private const uint CtlRtcen = 1u << 4;
        private const uint CtlTaote = 1u << 5;
        private const uint CtlTapwml = 1u << 6;
        private const uint CtlTben = 1u << 8;
        private const uint CtlTbevent = 3u << 10;
        private const uint CtlTbote = 1u << 13;
        private const uint CtlTbpwml = 1u << 14;
        private const uint ImrTatoim = 1u << 0;
        private const uint ImrTbtoim = 1u << 8;
        private const uint ImrImplemented = 0x0001_0F1F;
        private const uint RisTatoris = 1u << 0;
        private const uint RisTbtoris = 1u << 8;

        private enum Registers : long
        {
            CFG = 0x000,
            TAMR = 0x004,
            TBMR = 0x008,
            CTL = 0x00C,
            SYNC = 0x010,
            IMR = 0x018,
            RIS = 0x01C,
            MIS = 0x020,
            ICR = 0x024,
            TAILR = 0x028,
            TBILR = 0x02C,
            TAMATCHR = 0x030,
            TBMATCHR = 0x034,
            TAPR = 0x038,
            TBPR = 0x03C,
            TAPMR = 0x040,
            TBPMR = 0x044,
            TAR = 0x048,
            TBR = 0x04C,
            TAV = 0x050,
            TBV = 0x054,
            TAPV = 0x064,
            TBPV = 0x068,
            PP = 0xFC0,
        }
    }
}
