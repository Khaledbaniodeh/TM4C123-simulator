//
// TM4C123 Simulator — ADC model (ADC0 / ADC1).
//
// TM4C123GH6PM data sheet (SPMS376E), chapter 13 "Analog-to-Digital
// Converter (ADC)". One instance per module; both sample the same 12 analog
// inputs (AIN0-AIN11) and the internal temperature sensor.
//
// Modeled:
//   - Clock gating (SYSCTL RCGCADC / legacy RCGC0): unclocked access is a
//     precise bus fault, as for GPIO and the timers.
//   - Sample sequencers SS0-SS3 (8/4/4/1 steps, FIFO depth 8/4/4/1):
//     ACTSS, SSMUXn, SSCTLn (END, IE, TS), SSFIFOn, SSFSTATn, processor
//     trigger (PSSI) and continuous trigger (EMUX = 0xF).
//   - Conversion time from ADCPC (125/250/500 ksps, 1 Msps) and hardware
//     averaging (ADCSAC), in emulation virtual time.
//   - RIS / IM / ISC interrupts on one NVIC line per sequencer; OSTAT/USTAT
//     FIFO overflow/underflow flags.
//   - 12-bit results: code = round(V / 3.3 V * 4095), clamped. The pin must
//     be configured as an analog input in its GPIO port (AMSEL = 1,
//     DEN = 0); otherwise the sample reads 0 and a warning event is emitted.
//   - Temperature sensor: the data sheet's transfer function
//     TEMP = 147.5 - 75 * 3.3 * code / 4096 (deg C), inverted.
//
// Inputs come from outside the MCU: SetAnalogInputMillivolts() (the
// workspace's potentiometer or the API) and SetDieTemperatureMillidegrees().
// Both keep their values across an MCU reset.
//
// Not modeled (reported as `unsupported-feature`, never silently accepted):
// differential sampling, digital comparators, external VREF, triggers other
// than processor/always (comparator, GPIO, timer, PWM), GSYNC/SYNCWAIT,
// sample phase control, uDMA. Noise and INL/DNL are not modeled: a constant
// input gives a constant code.
//
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

using Antmicro.Renode.Core;
using Antmicro.Renode.Logging;
using Antmicro.Renode.Peripherals.Bus;
using Antmicro.Renode.Peripherals.GPIOPort;
using Antmicro.Renode.Peripherals.Miscellaneous;
using Antmicro.Renode.Peripherals.Timers;
using Antmicro.Renode.Time;

namespace Antmicro.Renode.Peripherals.Analog
{
    [AllowedTranslations(AllowedTranslation.ByteToDoubleWord | AllowedTranslation.WordToDoubleWord)]
    public class TM4C123ADC : IDoubleWordPeripheral, IKnownSize
    {
        public TM4C123ADC(IMachine machine, TM4C123SystemControl systemControl, int adcIndex,
            TM4C123GPIO portB, TM4C123GPIO portD, TM4C123GPIO portE)
        {
            if(adcIndex < 0 || adcIndex > 1)
            {
                throw new ArgumentOutOfRangeException(nameof(adcIndex));
            }
            this.machine = machine;
            this.systemControl = systemControl;
            this.adcIndex = adcIndex;
            name = "ADC" + adcIndex;
            ports = new Dictionary<char, TM4C123GPIO> { { 'B', portB }, { 'D', portD }, { 'E', portE } };
            IRQ0 = new GPIO();
            IRQ1 = new GPIO();
            IRQ2 = new GPIO();
            IRQ3 = new GPIO();
            lines = new[] { IRQ0, IRQ1, IRQ2, IRQ3 };
            sequencers = new[] { new Sequencer(this, 0, 8), new Sequencer(this, 1, 4), new Sequencer(this, 2, 4), new Sequencer(this, 3, 1) };
            for(var channel = 0; channel < ChannelCount; channel++)
            {
                inputMillivolts[channel] = -1; // not connected
            }
            Reset();
        }

        public long Size => 0x1000;

        public GPIO IRQ0 { get; }
        public GPIO IRQ1 { get; }
        public GPIO IRQ2 { get; }
        public GPIO IRQ3 { get; }

        // --- External inputs (monitor-callable) --------------------------------

        /// <summary>Sets the voltage on AINn in millivolts; a negative value disconnects the input.</summary>
        public void SetAnalogInputMillivolts(int channel, int millivolts)
        {
            if(channel < 0 || channel >= ChannelCount)
            {
                throw new ArgumentOutOfRangeException(nameof(channel));
            }
            inputMillivolts[channel] = millivolts;
            warnedInputs.Remove("AIN" + channel);
        }

        /// <summary>Die temperature seen by the internal sensor, in millidegrees Celsius.</summary>
        public void SetDieTemperatureMillidegrees(int millidegrees)
        {
            dieMillidegrees = millidegrees;
        }

        public int GetAnalogInputMillivolts(int channel)
        {
            return inputMillivolts[channel];
        }

        public int GetDieTemperatureMillidegrees()
        {
            return dieMillidegrees;
        }

        // --- Bus interface ------------------------------------------------------

        public void Reset()
        {
            actss = 0;
            ris = 0;
            im = 0;
            ostat = 0;
            ustat = 0;
            emux = 0;
            tssel = 0;
            sspri = 0x3210;
            spc = 0;
            sac = 0;
            ctl = 0;
            pc = 0x7;
            cc = 0;
            foreach(var sequencer in sequencers)
            {
                sequencer.Reset();
            }
            UpdateInterrupts();
        }

        public uint ReadDoubleWord(long offset)
        {
            RequireClock(offset, "read", 0);
            if(offset >= SequencerBase && offset < SequencerBase + 4 * SequencerStride)
            {
                var sequencer = sequencers[(offset - SequencerBase) / SequencerStride];
                switch((offset - SequencerBase) % SequencerStride)
                {
                case 0x00: return sequencer.Mux;
                case 0x04: return sequencer.Control;
                case 0x08: return sequencer.Pop();
                case 0x0C: return sequencer.FifoStatus;
                case 0x10: return sequencer.Operation;
                case 0x14: return sequencer.DigitalComparatorSelect;
                default: break;
                }
            }
            switch((Registers)offset)
            {
            case Registers.ACTSS: return actss | (AnyBusy ? ActssBusy : 0u);
            case Registers.RIS: return ris;
            case Registers.IM: return im;
            case Registers.ISC: return ris & im & 0xF;
            case Registers.OSTAT: return ostat;
            case Registers.EMUX: return emux;
            case Registers.USTAT: return ustat;
            case Registers.TSSEL: return tssel;
            case Registers.SSPRI: return sspri;
            case Registers.SPC: return spc;
            case Registers.PSSI: return 0;
            case Registers.SAC: return sac;
            case Registers.DCISC: return 0;
            case Registers.CTL: return ctl;
            case Registers.PC: return pc;
            case Registers.CC: return cc;
            default:
                ReportUnsupported(offset, "read", 0, "register not modeled");
                return 0;
            }
        }

        public void WriteDoubleWord(long offset, uint value)
        {
            RequireClock(offset, "write", value);
            if(offset >= SequencerBase && offset < SequencerBase + 4 * SequencerStride)
            {
                var sequencer = sequencers[(offset - SequencerBase) / SequencerStride];
                switch((offset - SequencerBase) % SequencerStride)
                {
                case 0x00: sequencer.Mux = value; return;
                case 0x04: sequencer.SetControl(value); return;
                case 0x08:
                case 0x0C:
                    ReportUnsupported(offset, "write", value, "register is read-only");
                    return;
                case 0x10:
                    sequencer.Operation = value;
                    if(value != 0)
                    {
                        ReportUnsupportedFeature("digital-comparator", $"ADCSSOP{sequencer.Index}=0x{value:X}: digital comparators are not modeled; samples still go to the FIFO");
                    }
                    return;
                case 0x14: sequencer.DigitalComparatorSelect = value; return;
                default: break;
                }
            }
            switch((Registers)offset)
            {
            case Registers.ACTSS:
                SetActive(value & 0xF);
                if((value & ~0xFu) != 0)
                {
                    ReportUnsupportedFeature("dma", $"ADCACTSS bits 0x{value & ~0xFu:X} (uDMA) are not modeled");
                }
                break;
            case Registers.IM:
                im = value & 0xF;
                if((value & ~0xFu) != 0)
                {
                    ReportUnsupportedFeature("digital-comparator", "ADCIM digital-comparator interrupt bits are not modeled");
                }
                UpdateInterrupts();
                break;
            case Registers.ISC:
                ris &= ~(value & 0xF); // write 1 to clear
                UpdateInterrupts();
                break;
            case Registers.OSTAT:
                ostat &= ~(value & 0xF);
                break;
            case Registers.USTAT:
                ustat &= ~(value & 0xF);
                break;
            case Registers.EMUX:
                emux = value & 0xFFFF;
                CheckTriggers();
                foreach(var sequencer in sequencers)
                {
                    sequencer.ContinueIfAlways();
                }
                break;
            case Registers.TSSEL:
                tssel = value;
                if(value != 0)
                {
                    ReportUnsupportedFeature("pwm-trigger", "ADCTSSEL (PWM trigger source) is not modeled");
                }
                break;
            case Registers.SSPRI:
                sspri = value & 0x3333;
                break;
            case Registers.SPC:
                spc = value & 0xF;
                if(spc != 0)
                {
                    ReportUnsupportedFeature("phase-delay", "ADCSPC sample phase delay is not modeled");
                }
                break;
            case Registers.PSSI:
                if((value & (PssiGsync | PssiSyncwait)) != 0)
                {
                    ReportUnsupportedFeature("synchronized-sampling", "ADCPSSI GSYNC/SYNCWAIT is not modeled");
                }
                for(var index = 0; index < 4; index++)
                {
                    if((value & (1u << index)) != 0)
                    {
                        sequencers[index].Trigger("processor");
                    }
                }
                break;
            case Registers.SAC:
                sac = Math.Min(value & 0x7, 6u);
                break;
            case Registers.CTL:
                ctl = value & 0x41;
                if((ctl & 0x1) != 0)
                {
                    ReportUnsupportedFeature("external-reference", "ADCCTL.VREF = 1 (external 3.0 V reference) is not modeled; conversions use 3.3 V");
                }
                break;
            case Registers.PC:
                pc = value & 0xF;
                if(pc != 0x1 && pc != 0x3 && pc != 0x5 && pc != 0x7)
                {
                    ReportUnsupported(offset, "write", value, "reserved ADCPC sample rate; 1 Msps is used");
                }
                break;
            case Registers.CC:
                cc = value & 0x3F;
                break;
            default:
                ReportUnsupported(offset, "write", value, "register not modeled");
                break;
            }
        }

        // --- Behavior -----------------------------------------------------------

        private bool AnyBusy
        {
            get
            {
                foreach(var sequencer in sequencers)
                {
                    if(sequencer.Busy)
                    {
                        return true;
                    }
                }
                return false;
            }
        }

        private void SetActive(uint value)
        {
            var previous = actss;
            actss = value;
            for(var index = 0; index < 4; index++)
            {
                var bit = 1u << index;
                if((previous & bit) != 0 && (value & bit) == 0)
                {
                    sequencers[index].Cancel();
                }
                else if((previous & bit) == 0 && (value & bit) != 0)
                {
                    CheckTrigger(index);
                    sequencers[index].ContinueIfAlways();
                }
            }
        }

        private uint TriggerOf(int sequencer)
        {
            return (emux >> (4 * sequencer)) & 0xF;
        }

        private void CheckTriggers()
        {
            for(var index = 0; index < 4; index++)
            {
                CheckTrigger(index);
            }
        }

        private void CheckTrigger(int index)
        {
            var trigger = TriggerOf(index);
            if((actss & (1u << index)) != 0 && trigger != TriggerProcessor && trigger != TriggerAlways)
            {
                ReportUnsupportedFeature("trigger", $"ADCEMUX trigger 0x{trigger:X} for SS{index} (comparator, GPIO, timer, or PWM) is not modeled; use the processor (PSSI) or always trigger");
            }
        }

        private long SamplePeriodNs
        {
            get
            {
                switch(pc)
                {
                case 0x1: return 8000;  // 125 ksps
                case 0x3: return 4000;  // 250 ksps
                case 0x5: return 2000;  // 500 ksps
                default: return 1000;   // 1 Msps
                }
            }
        }

        private int Averaging => 1 << (int)sac;

        /// <summary>Samples one input; returns the 12-bit code and the voltage it represents.</summary>
        private uint Sample(int channel, bool temperature, out double volts, out string input)
        {
            if(temperature)
            {
                input = "TS";
                var celsius = dieMillidegrees / 1000.0;
                var code = Clamp(Math.Round((147.5 - celsius) * 4096.0 / (75.0 * ReferenceVolts), MidpointRounding.AwayFromZero));
                volts = code * ReferenceVolts / 4095.0;
                return code;
            }
            input = "AIN" + channel;
            var pin = ChannelPins[channel];
            var problem = ports[pin.Port].AnalogInputProblem(pin.Pin);
            if(problem != null)
            {
                WarnInput(input, $"{input} (P{pin.Port}{pin.Pin}) sampled but not set up as an analog input: {problem}. The sample reads 0.", "not-analog");
                volts = 0;
                return 0;
            }
            var millivolts = inputMillivolts[channel];
            if(millivolts < 0)
            {
                WarnInput(input, $"{input} (P{pin.Port}{pin.Pin}) is not connected to anything; on hardware the reading is undefined. The sample reads 0.", "unconnected");
                volts = 0;
                return 0;
            }
            volts = millivolts / 1000.0;
            if(volts > ReferenceVolts)
            {
                WarnInput(input, $"{input} is at {volts.ToString("0.000", CultureInfo.InvariantCulture)} V, above VDDA (3.3 V); the code saturates at 4095 and real hardware may be damaged.", "over-range");
            }
            return Clamp(Math.Round(volts / ReferenceVolts * 4095.0, MidpointRounding.AwayFromZero));
        }

        private static uint Clamp(double code)
        {
            return (uint)Math.Max(0, Math.Min(4095, code));
        }

        private void WarnInput(string input, string detail, string kind)
        {
            if(!warnedInputs.Add(input))
            {
                return;
            }
            this.Log(LogLevel.Warning, "{0}: {1}", name, detail);
            TM4C123EventSink.Emit(machine, "adc-input-warning",
                "\"peripheral\":" + TM4C123EventSink.Str(name) +
                ",\"input\":" + TM4C123EventSink.Str(input) +
                ",\"kind\":" + TM4C123EventSink.Str(kind) +
                ",\"detail\":" + TM4C123EventSink.Str(detail));
        }

        private void OnSequenceComplete(Sequencer sequencer, List<string> samples, string trigger, bool interrupt)
        {
            if(interrupt)
            {
                ris |= 1u << sequencer.Index;
                UpdateInterrupts();
            }
            if(trigger == "processor" || !sequencer.ReportedAlways)
            {
                sequencer.ReportedAlways |= trigger == "always";
                TM4C123EventSink.Emit(machine, "adc-sequence-complete",
                    "\"peripheral\":" + TM4C123EventSink.Str(name) +
                    ",\"sequencer\":" + TM4C123EventSink.Num(sequencer.Index) +
                    ",\"trigger\":" + TM4C123EventSink.Str(trigger) +
                    ",\"samples\":[" + string.Join(",", samples) + "]");
            }
        }

        private void UpdateInterrupts()
        {
            var masked = ris & im & 0xF;
            for(var index = 0; index < 4; index++)
            {
                var asserted = (masked & (1u << index)) != 0;
                if(asserted == lineStates[index])
                {
                    continue;
                }
                lineStates[index] = asserted;
                lines[index].Set(asserted);
                TM4C123EventSink.Emit(machine, "interrupt-line-changed",
                    "\"peripheral\":" + TM4C123EventSink.Str(name + "SS" + index) +
                    ",\"asserted\":" + (asserted ? "true" : "false") +
                    ",\"mis\":" + TM4C123EventSink.Hex(masked));
            }
        }

        private void RequireClock(long offset, string access, uint value)
        {
            if(systemControl.IsAdcClockEnabled(adcIndex))
            {
                return;
            }
            var address = BaseAddress + offset;
            this.Log(LogLevel.Warning, "{0}: {1} at 0x{2:X8} while the ADC clock is disabled -> bus fault", name, access, address);
            TM4C123EventSink.Emit(machine, "bus-fault",
                "\"peripheral\":" + TM4C123EventSink.Str(name) +
                ",\"address\":" + TM4C123EventSink.Hex((ulong)address) +
                ",\"access\":" + TM4C123EventSink.Str(access) +
                ",\"value\":" + TM4C123EventSink.Hex(value) +
                ",\"reason\":" + TM4C123EventSink.Str("ADC clock is disabled (SYSCTL RCGCADC)"));
            throw new BusAccessException(BusAccessError.AddressError);
        }

        private long BaseAddress => 0x40038000 + 0x1000 * adcIndex;

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

        /// <summary>One sample sequencer: step configuration, FIFO, and conversion timer.</summary>
        private sealed class Sequencer
        {
            public Sequencer(TM4C123ADC owner, int index, int depth)
            {
                this.owner = owner;
                Index = index;
                this.depth = depth;
                // (clockSource, frequency, owner, localName, limit, direction, enabled, workMode, eventEnabled, autoUpdate, divider)
                timer = new LimitTimer(owner.machine.ClockSource, 1_000_000_000UL, owner, owner.name + "SS" + index,
                    1UL, Direction.Ascending, false, WorkMode.OneShot, true, true, 1UL);
                timer.LimitReached += Complete;
            }

            public int Index { get; }

            public uint Mux { get; set; }

            public uint Control { get; private set; }

            public uint Operation { get; set; }

            public uint DigitalComparatorSelect { get; set; }

            public bool Busy { get; private set; }

            public bool ReportedAlways { get; set; }

            public uint FifoStatus
            {
                get
                {
                    uint status = 0;
                    if(fifo.Count == 0)
                    {
                        status |= 1u << 8;  // EMPTY
                    }
                    if(fifo.Count >= depth)
                    {
                        status |= 1u << 12; // FULL
                    }
                    status |= (uint)((head & 0xF) << 4) | (uint)(tail & 0xF);
                    return status;
                }
            }

            public void Reset()
            {
                timer.Enabled = false;
                Mux = 0;
                Control = 0;
                Operation = 0;
                DigitalComparatorSelect = 0;
                Busy = false;
                pendingTrigger = null;
                ReportedAlways = false;
                fifo.Clear();
                head = 0;
                tail = 0;
            }

            public void SetControl(uint value)
            {
                Control = value;
                for(var step = 0; step < depth; step++)
                {
                    if(((value >> (4 * step)) & CtlDifferential) != 0)
                    {
                        owner.ReportUnsupportedFeature("differential", $"ADCSSCTL{Index} step {step}: differential sampling is not modeled; the step samples AIN{(Mux >> (4 * step)) & 0xF} single-ended");
                    }
                }
            }

            public void Trigger(string source)
            {
                if((owner.actss & (1u << Index)) == 0)
                {
                    owner.Log(LogLevel.Warning, "{0}: SS{1} triggered while disabled in ADCACTSS; ignored", owner.name, Index);
                    return;
                }
                if(Busy)
                {
                    pendingTrigger = source; // one trigger is remembered while converting
                    return;
                }
                Busy = true;
                trigger = source;
                var steps = StepCount(out _);
                timer.Limit = (ulong)(steps * owner.Averaging * owner.SamplePeriodNs);
                timer.ResetValue();
                timer.Enabled = true;
            }

            public void ContinueIfAlways()
            {
                if(!Busy && (owner.actss & (1u << Index)) != 0 && owner.TriggerOf(Index) == TriggerAlways)
                {
                    Trigger("always");
                }
            }

            public void Cancel()
            {
                timer.Enabled = false;
                Busy = false;
                pendingTrigger = null;
            }

            public uint Pop()
            {
                if(fifo.Count == 0)
                {
                    owner.ustat |= 1u << Index;
                    return lastRead;
                }
                lastRead = fifo.Dequeue();
                tail = (tail + 1) % depth;
                return lastRead;
            }

            /// <summary>Steps up to and including the first END step.</summary>
            private int StepCount(out bool endFound)
            {
                for(var step = 0; step < depth; step++)
                {
                    if(((Control >> (4 * step)) & CtlEnd) != 0)
                    {
                        endFound = true;
                        return step + 1;
                    }
                }
                endFound = false;
                return depth;
            }

            private void Complete()
            {
                timer.Enabled = false;
                Busy = false;
                var steps = StepCount(out var endFound);
                if(!endFound)
                {
                    owner.ReportUnsupportedFeature("missing-end", $"ADCSSCTL{Index} has no END bit; the data sheet requires one. All {depth} steps were sampled.");
                }
                var samples = new List<string>();
                var interrupt = false;
                for(var step = 0; step < steps; step++)
                {
                    var nibble = (Control >> (4 * step)) & 0xF;
                    var channel = (int)((Mux >> (4 * step)) & 0xF);
                    var temperature = (nibble & CtlTemperature) != 0;
                    if(!temperature && channel >= ChannelCount)
                    {
                        owner.ReportUnsupportedFeature("channel", $"ADCSSMUX{Index} step {step} selects AIN{channel}, which does not exist on TM4C123GH6PM; the sample reads 0");
                    }
                    double volts = 0;
                    var input = "AIN" + channel;
                    var code = channel < ChannelCount || temperature ? owner.Sample(channel, temperature, out volts, out input) : 0u;
                    if(fifo.Count >= depth)
                    {
                        owner.ostat |= 1u << Index; // overflow: the sample is lost
                    }
                    else
                    {
                        fifo.Enqueue(code);
                        head = (head + 1) % depth;
                    }
                    if((nibble & CtlInterrupt) != 0)
                    {
                        interrupt = true;
                    }
                    samples.Add("{\"step\":" + TM4C123EventSink.Num(step) +
                        ",\"input\":" + TM4C123EventSink.Str(input) +
                        ",\"volts\":" + volts.ToString("0.000", CultureInfo.InvariantCulture) +
                        ",\"code\":" + TM4C123EventSink.Num(code) + "}");
                }
                owner.OnSequenceComplete(this, samples, trigger, interrupt);

                if(pendingTrigger != null)
                {
                    var next = pendingTrigger;
                    pendingTrigger = null;
                    Trigger(next);
                }
                else
                {
                    ContinueIfAlways();
                }
            }

            private readonly TM4C123ADC owner;
            private readonly int depth;
            private readonly LimitTimer timer;
            private readonly Queue<uint> fifo = new Queue<uint>();
            private string trigger = "processor";
            private string pendingTrigger;
            private int head;
            private int tail;
            private uint lastRead;
        }

        private struct PinRef
        {
            public PinRef(char port, int pin)
            {
                Port = port;
                Pin = pin;
            }

            public char Port { get; }
            public int Pin { get; }
        }

        // AIN0-AIN11 pins (SPMS376E Table 13-1).
        private static readonly PinRef[] ChannelPins =
        {
            new PinRef('E', 3), new PinRef('E', 2), new PinRef('E', 1), new PinRef('E', 0),
            new PinRef('D', 3), new PinRef('D', 2), new PinRef('D', 1), new PinRef('D', 0),
            new PinRef('E', 5), new PinRef('E', 4), new PinRef('B', 4), new PinRef('B', 5),
        };

        private readonly IMachine machine;
        private readonly TM4C123SystemControl systemControl;
        private readonly int adcIndex;
        private readonly string name;
        private readonly Dictionary<char, TM4C123GPIO> ports;
        private readonly GPIO[] lines;
        private readonly bool[] lineStates = new bool[4];
        private readonly Sequencer[] sequencers;
        private readonly int[] inputMillivolts = new int[ChannelCount];
        private readonly HashSet<string> warnedInputs = new HashSet<string>();
        private int dieMillidegrees = 25000;

        private uint actss, ris, im, ostat, ustat, emux, tssel, sspri, spc, sac, ctl, pc, cc;

        private const int ChannelCount = 12;
        private const double ReferenceVolts = 3.3;
        private const long SequencerBase = 0x040;
        private const long SequencerStride = 0x020;
        private const uint ActssBusy = 1u << 16;
        private const uint PssiGsync = 1u << 31;
        private const uint PssiSyncwait = 1u << 27;
        private const uint TriggerProcessor = 0x0;
        private const uint TriggerAlways = 0xF;
        private const uint CtlDifferential = 1u << 0;
        private const uint CtlEnd = 1u << 1;
        private const uint CtlInterrupt = 1u << 2;
        private const uint CtlTemperature = 1u << 3;

        private enum Registers : long
        {
            ACTSS = 0x000,
            RIS = 0x004,
            IM = 0x008,
            ISC = 0x00C,
            OSTAT = 0x010,
            EMUX = 0x014,
            USTAT = 0x018,
            TSSEL = 0x01C,
            SSPRI = 0x020,
            SPC = 0x024,
            PSSI = 0x028,
            SAC = 0x030,
            DCISC = 0x034,
            CTL = 0x038,
            PC = 0xFC4,
            CC = 0xFC8,
        }
    }
}
