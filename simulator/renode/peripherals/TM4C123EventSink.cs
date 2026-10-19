//
// TM4C123 Simulator — structured runtime event sink.
//
// Writes one JSON object per line to the file named by the TM4C_EVENT_LOG
// environment variable. This is the authoritative machine-readable channel
// from the peripheral models to the orchestrator; the orchestrator never
// derives pin state from human-readable Renode log text.
//
// Every event carries:
//   type           event kind (see docs/RUNTIME_EVENTS.md)
//   sequence       strictly increasing per Renode process
//   virtualTimeNs  emulation virtual time as a decimal string
//
using System;
using System.Globalization;
using System.IO;
using System.Text;

using Antmicro.Renode.Core;
using Antmicro.Renode.Peripherals.CPU;

namespace Antmicro.Renode.Peripherals.Miscellaneous
{
    public static class TM4C123EventSink
    {
        static TM4C123EventSink()
        {
            var path = Environment.GetEnvironmentVariable("TM4C_EVENT_LOG");
            if(!string.IsNullOrEmpty(path))
            {
                var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
            }
        }

        /// <summary>Virtual time in nanoseconds, synchronized to the executing instruction when called from the CPU thread.</summary>
        public static ulong VirtualTimeNs(IMachine machine)
        {
            if(machine.SystemBus.TryGetCurrentCPU(out var cpu))
            {
                (cpu as BaseCPU)?.SyncTime();
            }
            return machine.LocalTimeSource.ElapsedVirtualTime.TotalNanoseconds;
        }

        /// <summary>
        /// Emits one event. <paramref name="fields"/> are pre-rendered JSON
        /// members (without braces), built with <see cref="Str"/> and friends.
        /// </summary>
        public static void Emit(IMachine machine, string type, string fields)
        {
            var time = VirtualTimeNs(machine);
            lock(sync)
            {
                sequence++;
                if(writer == null)
                {
                    return;
                }
                var line = new StringBuilder();
                line.Append("{\"type\":").Append(Str(type));
                line.Append(",\"sequence\":").Append(sequence.ToString(CultureInfo.InvariantCulture));
                line.Append(",\"virtualTimeNs\":").Append(Str(time.ToString(CultureInfo.InvariantCulture)));
                if(!string.IsNullOrEmpty(fields))
                {
                    line.Append(',').Append(fields);
                }
                line.Append('}');
                writer.WriteLine(line.ToString());
            }
        }

        public static string Str(string value)
        {
            var builder = new StringBuilder("\"");
            foreach(var c in value)
            {
                switch(c)
                {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if(c < 0x20)
                    {
                        builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        builder.Append(c);
                    }
                    break;
                }
            }
            return builder.Append('"').ToString();
        }

        public static string Hex(ulong value)
        {
            return Str("0x" + value.ToString("X8", CultureInfo.InvariantCulture));
        }

        public static string Num(long value)
        {
            return value.ToString(CultureInfo.InvariantCulture);
        }

        private static readonly object sync = new object();
        private static readonly StreamWriter writer;
        private static long sequence;
    }
}
