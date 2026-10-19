//
// TM4C123 Simulator — GPIO port model (APB aperture).
//
// One instance per port (A-F). Register map and reset values follow the
// TM4C123GH6PM datasheet (SPMS376E), chapter 10 "General-Purpose
// Input/Outputs (GPIOs)", including Table 10-1 "GPIO Pins With Special
// Considerations" for the commit-protected pins.
//
// Modeled behavior:
//   - Clock gating: any register access while the port clock is disabled in
//     SYSCTL raises a precise bus fault, as on silicon.
//   - Masked DATA: offsets 0x000-0x3FC, address bits [9:2] select the bits.
//   - DIR, DEN, AFSEL, PUR/PDR (mutually exclusive), ODR, LOCK/CR commit
//     protection for AFSEL/PUR/PDR/DEN.
//   - Edge- and level-sensitive interrupts: IS, IBE, IEV, IM, RIS, MIS, ICR,
//     driving the port's NVIC line.
//   - Logical pin resolution: HIGH / LOW / FLOATING / CONFLICT from GPIO
//     output drivers, internal pulls, and external drivers (board switches).
//
// Not modeled (reported as `unsupported-feature` or
// `unsupported-register-access` events, never silently accepted):
//   - Alternate functions selected through AFSEL/PCTL, analog mode (AMSEL),
//     ADC/uDMA triggers, AHB aperture, drive-strength and slew effects,
//     peripheral/PrimeCell ID registers.
//
using System;
using System.Text;

using Antmicro.Renode.Core;
using Antmicro.Renode.Logging;
using Antmicro.Renode.Peripherals.Bus;
using Antmicro.Renode.Peripherals.Miscellaneous;

namespace Antmicro.Renode.Peripherals.GPIOPort
{
    [AllowedTranslations(AllowedTranslation.ByteToDoubleWord | AllowedTranslation.WordToDoubleWord)]
    public class TM4C123GPIO : IDoubleWordPeripheral, IKnownSize
    {
        public TM4C123GPIO(IMachine machine, TM4C123SystemControl systemControl, int portIndex)
        {
            if(portIndex < 0 || portIndex >= PortNames.Length)
            {
                throw new ArgumentOutOfRangeException(nameof(portIndex));
            }
            this.machine = machine;
            this.systemControl = systemControl;
            this.portIndex = portIndex;
            portName = "GPIO" + PortNames[portIndex];
            pinPrefix = "P" + PortNames[portIndex];

            switch(PortNames[portIndex])
            {
            case 'C':
                // PC[3:0] are JTAG/SWD pins: alternate function, digital,
                // pulled up, and commit-protected out of reset.
                protectedPins = 0x0F;
                resetAfsel = 0x0F;
                resetDen = 0x0F;
                resetPur = 0x0F;
                resetPctl = 0x00001111;
                break;
            case 'D':
                protectedPins = 0x80; // PD7 (NMI)
                break;
            case 'F':
                protectedPins = 0x01; // PF0 (NMI)
                break;
            }

            IRQ = new GPIO();
            levels = new PinLevel[PinCount];
            drives = new string[PinCount];
            systemControl.GpioClocksChanged += () => Update();
            ResetRegisters();
            Resolve(emitChanges: false);
            EmitSnapshot("power-on");
        }

        public long Size => 0x1000;

        public GPIO IRQ { get; }

        public void Reset()
        {
            ResetRegisters();
            externalDriven = 0;
            externalLevel = 0;
            Update();
            EmitSnapshot("reset");
        }

        public uint ReadDoubleWord(long offset)
        {
            RequireClock(offset, "read", 0);

            if(offset < DataApertureEnd)
            {
                var mask = (uint)((offset >> 2) & 0xFF);
                ReportFloatingReads(mask);
                return ReadDataValue() & mask;
            }

            switch((Registers)offset)
            {
            case Registers.Direction: return dir;
            case Registers.InterruptSense: return interruptSense;
            case Registers.InterruptBothEdges: return interruptBothEdges;
            case Registers.InterruptEvent: return interruptEvent;
            case Registers.InterruptMask: return interruptMask;
            case Registers.RawInterruptStatus: return rawInterruptStatus;
            case Registers.MaskedInterruptStatus: return rawInterruptStatus & interruptMask;
            case Registers.AlternateFunctionSelect: return afsel;
            case Registers.Drive2mA: return dr2r;
            case Registers.Drive4mA: return dr4r;
            case Registers.Drive8mA: return dr8r;
            case Registers.OpenDrain: return odr;
            case Registers.PullUp: return pur;
            case Registers.PullDown: return pdr;
            case Registers.SlewRate: return slr;
            case Registers.DigitalEnable: return den;
            case Registers.Lock: return locked ? 1u : 0u;
            case Registers.Commit: return commit;
            case Registers.AnalogModeSelect: return amsel;
            case Registers.PortControl: return pctl;
            case Registers.AdcControl: return adcctl;
            case Registers.DmaControl: return dmactl;
            case Registers.InterruptClear:
                ReportUnsupported(offset, "read", 0, "GPIOICR is write-only");
                return 0;
            default:
                ReportUnsupported(offset, "read", 0, "register not modeled");
                return 0;
            }
        }

        public void WriteDoubleWord(long offset, uint value)
        {
            RequireClock(offset, "write", value);

            if(offset < DataApertureEnd)
            {
                var mask = (uint)((offset >> 2) & 0xFF);
                data = (data & ~mask) | (value & mask);
                Update();
                return;
            }

            var raw = value;
            value &= 0xFF;
            switch((Registers)offset)
            {
            case Registers.Direction:
                dir = value;
                break;
            case Registers.InterruptSense:
                interruptSense = value;
                break;
            case Registers.InterruptBothEdges:
                interruptBothEdges = value;
                break;
            case Registers.InterruptEvent:
                interruptEvent = value;
                break;
            case Registers.InterruptMask:
                interruptMask = value;
                break;
            case Registers.InterruptClear:
                // Write-1-to-clear. Level-sensitive sources re-assert in Update().
                rawInterruptStatus &= ~value;
                break;
            case Registers.AlternateFunctionSelect:
                afsel = Committed("GPIOAFSEL", afsel, value);
                if(afsel != 0)
                {
                    ReportUnsupportedFeature("alternate-function", "AFSEL=0x" + afsel.ToString("X2") + ": alternate pin functions are not modeled; affected pins are not driven by GPIO");
                }
                break;
            case Registers.Drive2mA:
                // Selecting one drive strength clears the others (datasheet 10.5).
                dr2r = value; dr4r &= ~value; dr8r &= ~value;
                break;
            case Registers.Drive4mA:
                dr4r = value; dr2r &= ~value; dr8r &= ~value;
                break;
            case Registers.Drive8mA:
                dr8r = value; dr2r &= ~value; dr4r &= ~value;
                break;
            case Registers.OpenDrain:
                odr = value;
                break;
            case Registers.PullUp:
                pur = Committed("GPIOPUR", pur, value);
                pdr &= ~pur;
                break;
            case Registers.PullDown:
                pdr = Committed("GPIOPDR", pdr, value);
                pur &= ~pdr;
                break;
            case Registers.SlewRate:
                slr = value;
                break;
            case Registers.DigitalEnable:
                den = Committed("GPIODEN", den, value);
                break;
            case Registers.Lock:
                // The key is a full 32-bit value; any other write re-locks.
                locked = raw != UnlockKey;
                return;
            case Registers.Commit:
                if(locked)
                {
                    TM4C123EventSink.Emit(machine, "locked-register-write-ignored",
                        Peripheral() + ",\"register\":\"GPIOCR\",\"value\":" + TM4C123EventSink.Hex(value));
                    this.Log(LogLevel.Warning, "{0}: GPIOCR write 0x{1:X2} ignored while GPIOLOCK is locked", portName, value);
                    return;
                }
                // Only commit-protected pins have writable CR bits; others read 1.
                commit = (commit & ~protectedPins) | (value & protectedPins) | (0xFFu & ~protectedPins);
                return;
            case Registers.AnalogModeSelect:
                amsel = value;
                if(amsel != 0)
                {
                    ReportUnsupportedFeature("analog-mode", "AMSEL=0x" + amsel.ToString("X2") + ": analog pin functions are not modeled");
                }
                break;
            case Registers.PortControl:
                pctl = raw; // 4 bits per pin, all 32 bits are significant
                break;
            case Registers.AdcControl:
                adcctl = value;
                if(adcctl != 0)
                {
                    ReportUnsupportedFeature("adc-trigger", "GPIOADCCTL ADC triggers are not modeled");
                }
                break;
            case Registers.DmaControl:
                dmactl = value;
                if(dmactl != 0)
                {
                    ReportUnsupportedFeature("dma-trigger", "GPIODMACTL uDMA triggers are not modeled");
                }
                break;
            case Registers.RawInterruptStatus:
            case Registers.MaskedInterruptStatus:
                ReportUnsupported(offset, "write", value, "register is read-only");
                return;
            default:
                ReportUnsupported(offset, "write", value, "register not modeled");
                return;
            }
            Update();
        }

        // --- External stimulus (board switches, test harness) ---------------

        /// <summary>An external source drives the pin to the given level.</summary>
        public void DriveInput(int pin, bool high)
        {
            CheckPin(pin);
            externalDriven |= 1u << pin;
            if(high)
            {
                externalLevel |= 1u << pin;
            }
            else
            {
                externalLevel &= ~(1u << pin);
            }
            Update();
        }

        /// <summary>The external source releases the pin (high impedance).</summary>
        public void ReleaseInput(int pin)
        {
            CheckPin(pin);
            externalDriven &= ~(1u << pin);
            externalLevel &= ~(1u << pin);
            Update();
        }

        /// <summary>Resolved logical state of a pin: high, low, floating, or conflict.</summary>
        public string PinState(int pin)
        {
            CheckPin(pin);
            return LevelName(levels[pin]);
        }

        // --- Internals ------------------------------------------------------

        private void ResetRegisters()
        {
            data = 0;
            dir = 0;
            interruptSense = 0;
            interruptBothEdges = 0;
            interruptEvent = 0;
            interruptMask = 0;
            rawInterruptStatus = 0;
            afsel = resetAfsel;
            dr2r = 0xFF;
            dr4r = 0;
            dr8r = 0;
            odr = 0;
            pur = resetPur;
            pdr = 0;
            slr = 0;
            den = resetDen;
            locked = true;
            commit = 0xFFu & ~protectedPins;
            amsel = 0;
            pctl = resetPctl;
            adcctl = 0;
            dmactl = 0;
        }

        private bool ClockEnabled => systemControl.IsGpioClockEnabled(portIndex);

        private void RequireClock(long offset, string access, uint value)
        {
            if(ClockEnabled)
            {
                return;
            }
            var address = BaseAddress(portIndex) + offset;
            this.Log(LogLevel.Warning, "{0}: {1} at 0x{2:X8} while the port clock is disabled -> bus fault", portName, access, address);
            TM4C123EventSink.Emit(machine, "bus-fault",
                Peripheral() +
                ",\"address\":" + TM4C123EventSink.Hex((ulong)address) +
                ",\"access\":" + TM4C123EventSink.Str(access) +
                ",\"value\":" + TM4C123EventSink.Hex(value) +
                ",\"reason\":" + TM4C123EventSink.Str("GPIO port clock is disabled (SYSCTL RCGCGPIO)"));
            throw new BusAccessException(BusAccessError.AddressError);
        }

        private uint Committed(string register, uint current, uint requested)
        {
            var blocked = (current ^ requested) & ~commit & 0xFF;
            if(blocked != 0)
            {
                TM4C123EventSink.Emit(machine, "commit-protected-write-ignored",
                    Peripheral() +
                    ",\"register\":" + TM4C123EventSink.Str(register) +
                    ",\"bits\":" + TM4C123EventSink.Hex(blocked) +
                    ",\"reason\":" + TM4C123EventSink.Str("GPIOCR does not commit these bits; unlock GPIOLOCK and set GPIOCR first"));
                this.Log(LogLevel.Warning, "{0}: {1} bits 0x{2:X2} not committed (GPIOCR=0x{3:X2})", portName, register, blocked, commit);
            }
            return (current & ~commit) | (requested & commit);
        }

        private void Update()
        {
            Resolve(emitChanges: true);
        }

        /// <summary>Recomputes pin levels, emits changes, and updates interrupt state.</summary>
        private void Resolve(bool emitChanges)
        {
            var clock = ClockEnabled;
            uint newInput = 0;

            for(var pin = 0; pin < PinCount; pin++)
            {
                var bit = 1u << pin;
                PinLevel level;
                string drive;

                var outputDriving = clock && (den & bit) != 0 && (afsel & bit) == 0 && (dir & bit) != 0
                    && !((odr & bit) != 0 && (data & bit) != 0); // open drain only sinks
                var externalDriving = (externalDriven & bit) != 0;

                if(outputDriving && externalDriving && ((data & bit) != 0) != ((externalLevel & bit) != 0))
                {
                    level = PinLevel.Conflict;
                    drive = "conflict";
                }
                else if(outputDriving)
                {
                    level = (data & bit) != 0 ? PinLevel.High : PinLevel.Low;
                    drive = "output";
                }
                else if(externalDriving)
                {
                    level = (externalLevel & bit) != 0 ? PinLevel.High : PinLevel.Low;
                    drive = "external";
                }
                else if(clock && (pur & bit) != 0)
                {
                    level = PinLevel.High;
                    drive = "pull-up";
                }
                else if(clock && (pdr & bit) != 0)
                {
                    level = PinLevel.Low;
                    drive = "pull-down";
                }
                else
                {
                    level = PinLevel.Floating;
                    drive = "none";
                }

                // The digital input buffer is enabled by DEN; a floating or
                // conflicting input is read as 0 (and reported on read).
                if(clock && (den & bit) != 0 && level == PinLevel.High)
                {
                    newInput |= bit;
                }

                if(emitChanges && (levels[pin] != level || drives[pin] != drive))
                {
                    TM4C123EventSink.Emit(machine, "digital-pin-changed",
                        "\"pin\":{\"partId\":\"board1\",\"pinId\":" + TM4C123EventSink.Str(pinPrefix + pin) + "}" +
                        ",\"level\":" + LevelJson(level) +
                        ",\"state\":" + TM4C123EventSink.Str(LevelName(level)) +
                        ",\"drive\":" + TM4C123EventSink.Str(drive));
                }
                levels[pin] = level;
                drives[pin] = drive;
            }

            if(emitChanges)
            {
                floatingReadReported &= ~(inputValue ^ newInput);
                UpdateInterrupts(inputValue, newInput);
            }
            inputValue = newInput;
        }

        private void UpdateInterrupts(uint oldInput, uint newInput)
        {
            var rising = ~oldInput & newInput & 0xFF;
            var falling = oldInput & ~newInput & 0xFF;
            var edgeSensitive = ~interruptSense & 0xFF;

            var bothEdges = (rising | falling) & interruptBothEdges;
            var singleEdge = ((rising & interruptEvent) | (falling & ~interruptEvent)) & ~interruptBothEdges;
            rawInterruptStatus |= (bothEdges | singleEdge) & edgeSensitive;

            // Level-sensitive: RIS follows the input while it matches IEV.
            var levelMatch = ~(newInput ^ interruptEvent) & 0xFF;
            rawInterruptStatus = (rawInterruptStatus & edgeSensitive) | (levelMatch & interruptSense);

            var asserted = (rawInterruptStatus & interruptMask) != 0;
            if(asserted != irqAsserted)
            {
                irqAsserted = asserted;
                IRQ.Set(asserted);
                TM4C123EventSink.Emit(machine, "interrupt-line-changed",
                    Peripheral() +
                    ",\"asserted\":" + (asserted ? "true" : "false") +
                    ",\"mis\":" + TM4C123EventSink.Hex(rawInterruptStatus & interruptMask));
            }
        }

        private uint ReadDataValue()
        {
            // Output pins read back the DATA register; input pins read the
            // input buffer; pins with DEN clear read 0.
            var outputs = dir & den & ~afsel;
            return ((data & outputs) | (inputValue & ~outputs)) & den & 0xFF;
        }

        private void ReportFloatingReads(uint mask)
        {
            uint floating = 0;
            for(var pin = 0; pin < PinCount; pin++)
            {
                var bit = 1u << pin;
                if((mask & bit) != 0 && (den & bit) != 0 && (dir & bit) == 0 && levels[pin] == PinLevel.Floating)
                {
                    floating |= bit;
                }
            }
            var fresh = floating & ~floatingReadReported;
            if(fresh != 0)
            {
                floatingReadReported |= fresh;
                TM4C123EventSink.Emit(machine, "floating-input-read",
                    Peripheral() + ",\"bits\":" + TM4C123EventSink.Hex(fresh) +
                    ",\"reason\":" + TM4C123EventSink.Str("input has no driver or pull resistor; value is undefined on silicon and read as 0 here"));
            }
        }

        private void EmitSnapshot(string cause)
        {
            var pins = new StringBuilder("[");
            for(var pin = 0; pin < PinCount; pin++)
            {
                if(pin > 0)
                {
                    pins.Append(',');
                }
                pins.Append("{\"pinId\":").Append(TM4C123EventSink.Str(pinPrefix + pin))
                    .Append(",\"level\":").Append(LevelJson(levels[pin]))
                    .Append(",\"state\":").Append(TM4C123EventSink.Str(LevelName(levels[pin])))
                    .Append(",\"drive\":").Append(TM4C123EventSink.Str(drives[pin])).Append('}');
            }
            pins.Append(']');
            TM4C123EventSink.Emit(machine, "port-snapshot",
                Peripheral() + ",\"partId\":\"board1\",\"cause\":" + TM4C123EventSink.Str(cause) + ",\"pins\":" + pins);
        }

        private void ReportUnsupported(long offset, string access, uint value, string reason)
        {
            var address = BaseAddress(portIndex) + offset;
            this.Log(LogLevel.Warning, "{0}: unsupported {1} at 0x{2:X8} (value 0x{3:X8}): {4}", portName, access, address, value, reason);
            TM4C123EventSink.Emit(machine, "unsupported-register-access",
                Peripheral() +
                ",\"address\":" + TM4C123EventSink.Hex((ulong)address) +
                ",\"offset\":" + TM4C123EventSink.Hex((ulong)offset) +
                ",\"access\":" + TM4C123EventSink.Str(access) +
                ",\"value\":" + TM4C123EventSink.Hex(value) +
                ",\"reason\":" + TM4C123EventSink.Str(reason));
        }

        private void ReportUnsupportedFeature(string feature, string detail)
        {
            this.Log(LogLevel.Warning, "{0}: {1}", portName, detail);
            TM4C123EventSink.Emit(machine, "unsupported-feature",
                Peripheral() + ",\"feature\":" + TM4C123EventSink.Str(feature) + ",\"detail\":" + TM4C123EventSink.Str(detail));
        }

        private string Peripheral()
        {
            return "\"peripheral\":" + TM4C123EventSink.Str(portName);
        }

        private static void CheckPin(int pin)
        {
            if(pin < 0 || pin >= PinCount)
            {
                throw new ArgumentOutOfRangeException(nameof(pin), "GPIO pin must be 0-7");
            }
        }

        private static long BaseAddress(int port)
        {
            // APB apertures: A-D at 0x40004000 + 0x1000 * n, E-F at 0x40024000 + 0x1000 * (n - 4).
            return port < 4 ? 0x40004000 + 0x1000 * port : 0x40024000 + 0x1000 * (port - 4);
        }

        private static string LevelName(PinLevel level)
        {
            switch(level)
            {
            case PinLevel.High: return "high";
            case PinLevel.Low: return "low";
            case PinLevel.Conflict: return "conflict";
            default: return "floating";
            }
        }

        private static string LevelJson(PinLevel level)
        {
            return level == PinLevel.High ? "1" : level == PinLevel.Low ? "0" : "null";
        }

        private uint data, dir, interruptSense, interruptBothEdges, interruptEvent, interruptMask, rawInterruptStatus;
        private uint afsel, dr2r, dr4r, dr8r, odr, pur, pdr, slr, den, commit, amsel, pctl, adcctl, dmactl;
        private bool locked;
        private uint externalDriven, externalLevel;
        private uint inputValue;
        private uint floatingReadReported;
        private bool irqAsserted;

        private readonly PinLevel[] levels;
        private readonly string[] drives;
        private readonly uint protectedPins;
        private readonly uint resetAfsel, resetDen, resetPur, resetPctl;

        private readonly IMachine machine;
        private readonly TM4C123SystemControl systemControl;
        private readonly int portIndex;
        private readonly string portName;
        private readonly string pinPrefix;

        private const int PinCount = 8;
        private const long DataApertureEnd = 0x400;
        private const uint UnlockKey = 0x4C4F434B;
        private const string PortNames = "ABCDEF";

        private enum PinLevel
        {
            Floating,
            Low,
            High,
            Conflict,
        }

        private enum Registers : long
        {
            Direction = 0x400,
            InterruptSense = 0x404,
            InterruptBothEdges = 0x408,
            InterruptEvent = 0x40C,
            InterruptMask = 0x410,
            RawInterruptStatus = 0x414,
            MaskedInterruptStatus = 0x418,
            InterruptClear = 0x41C,
            AlternateFunctionSelect = 0x420,
            Drive2mA = 0x500,
            Drive4mA = 0x504,
            Drive8mA = 0x508,
            OpenDrain = 0x50C,
            PullUp = 0x510,
            PullDown = 0x514,
            SlewRate = 0x518,
            DigitalEnable = 0x51C,
            Lock = 0x520,
            Commit = 0x524,
            AnalogModeSelect = 0x528,
            PortControl = 0x52C,
            AdcControl = 0x530,
            DmaControl = 0x534,
        }
    }
}
