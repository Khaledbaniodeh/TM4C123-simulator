/*
 * TM4C123 Simulator — system clock setup for TM4C123GH6PM (CMSIS-style API).
 *
 * Original project code. Linked automatically when the firmware includes
 * TM4C123.h or TM4C123GH6PM.h; the startup code calls SystemInit() after
 * initializing .data and .bss, then main().
 *
 * SystemInit() configures the clock that TM4C123 lab material assumes:
 * 16 MHz main oscillator -> PLL (400 MHz) -> /8 -> 50 MHz, following the
 * data sheet's RCC2 initialization sequence (SPMS376E section 5.3).
 * SystemCoreClockUpdate() derives the clock from RCC/RCC2 with the data
 * sheet's rules, so firmware that reconfigures the clock can call it.
 */
#include "TM4C123GH6PM.h"

#define RIS_PLLLRIS        (1UL << 6)

#define RCC_MOSCDIS        (1UL << 0)
#define RCC_OSCSRC_Pos     4U
#define RCC_OSCSRC_Msk     (3UL << RCC_OSCSRC_Pos)
#define RCC_XTAL_Pos       6U
#define RCC_XTAL_Msk       (0x1FUL << RCC_XTAL_Pos)
#define RCC_BYPASS         (1UL << 11)
#define RCC_PWRDN          (1UL << 13)
#define RCC_USESYSDIV      (1UL << 22)
#define RCC_SYSDIV_Pos     23U
#define RCC_SYSDIV_Msk     (0xFUL << RCC_SYSDIV_Pos)

#define RCC2_OSCSRC2_Pos   4U
#define RCC2_OSCSRC2_Msk   (7UL << RCC2_OSCSRC2_Pos)
#define RCC2_BYPASS2       (1UL << 11)
#define RCC2_PWRDN2        (1UL << 13)
#define RCC2_SYSDIV2LSB    (1UL << 22)
#define RCC2_SYSDIV2_Pos   23U
#define RCC2_SYSDIV2_Msk   (0x3FUL << RCC2_SYSDIV2_Pos)
#define RCC2_DIV400        (1UL << 30)
#define RCC2_USERCC2       (1UL << 31)

#define XTAL_16MHZ         0x15UL
/* 400 MHz / (SYSDIV2:SYSDIV2LSB + 1) with the 7-bit divider = 7 -> 50 MHz */
#define SYSDIV400_50MHZ    7UL

#define PIOSC_HZ           16000000UL
#define LFIOSC_HZ          30000UL      /* nominal; data sheet range 10-90 kHz */
#define HIB_OSC_HZ         32768UL

uint32_t SystemCoreClock = PIOSC_HZ;    /* reset clock until SystemInit() runs */

/** RCC.XTAL encoding to crystal frequency (0 for reserved encodings). */
static uint32_t xtal_hz(uint32_t xtal)
{
    static const uint32_t table[] = {
        4000000UL, 4096000UL, 4915200UL, 5000000UL, 5120000UL, 6000000UL, 6144000UL,
        7372800UL, 8000000UL, 8192000UL, 10000000UL, 12000000UL, 12288000UL, 13560000UL,
        14318180UL, 16000000UL, 16384000UL, 18000000UL, 20000000UL, 24000000UL, 25000000UL,
    };
    if (xtal < 0x06UL || xtal > 0x1AUL)
    {
        return 0UL;
    }
    return table[xtal - 0x06UL];
}

void SystemCoreClockUpdate(void)
{
    uint32_t rcc = SYSCTL->RCC;
    uint32_t rcc2 = SYSCTL->RCC2;
    int use_rcc2 = (rcc2 & RCC2_USERCC2) != 0UL;
    uint32_t oscsrc = use_rcc2 ? (rcc2 & RCC2_OSCSRC2_Msk) >> RCC2_OSCSRC2_Pos
                               : (rcc & RCC_OSCSRC_Msk) >> RCC_OSCSRC_Pos;
    int bypass = use_rcc2 ? (rcc2 & RCC2_BYPASS2) != 0UL : (rcc & RCC_BYPASS) != 0UL;
    uint32_t source_hz;

    switch (oscsrc)
    {
    case 0U: source_hz = xtal_hz((rcc & RCC_XTAL_Msk) >> RCC_XTAL_Pos); break;
    case 1U: source_hz = PIOSC_HZ; break;
    case 2U: source_hz = PIOSC_HZ / 4UL; break;
    case 3U: source_hz = LFIOSC_HZ; break;
    case 7U: source_hz = HIB_OSC_HZ; break;
    default: source_hz = 0UL; break;
    }

    if (!bypass)
    {
        /* PLL: the system divider is always applied. */
        if (use_rcc2 && (rcc2 & RCC2_DIV400) != 0UL)
        {
            uint32_t divisor = ((((rcc2 & RCC2_SYSDIV2_Msk) >> RCC2_SYSDIV2_Pos) << 1)
                               | ((rcc2 & RCC2_SYSDIV2LSB) != 0UL ? 1UL : 0UL)) + 1UL;
            SystemCoreClock = 400000000UL / divisor;
        }
        else
        {
            uint32_t divisor = (use_rcc2 ? (rcc2 & RCC2_SYSDIV2_Msk) >> RCC2_SYSDIV2_Pos
                                         : (rcc & RCC_SYSDIV_Msk) >> RCC_SYSDIV_Pos) + 1UL;
            SystemCoreClock = 200000000UL / divisor;
        }
        return;
    }

    if ((rcc & RCC_USESYSDIV) != 0UL)
    {
        uint32_t divisor = (use_rcc2 ? (rcc2 & RCC2_SYSDIV2_Msk) >> RCC2_SYSDIV2_Pos
                                     : (rcc & RCC_SYSDIV_Msk) >> RCC_SYSDIV_Pos) + 1UL;
        source_hz /= divisor;
    }
    SystemCoreClock = source_hz;
}

void SystemInit(void)
{
    /* 1. Use RCC2 and bypass the PLL while it is reconfigured. */
    SYSCTL->RCC2 |= RCC2_USERCC2;
    SYSCTL->RCC2 |= RCC2_BYPASS2;

    /* 2. 16 MHz crystal, main oscillator enabled and selected, PLL powered. */
    SYSCTL->RCC = (SYSCTL->RCC & ~RCC_XTAL_Msk) | (XTAL_16MHZ << RCC_XTAL_Pos);
    SYSCTL->RCC &= ~RCC_MOSCDIS;
    SYSCTL->RCC2 &= ~RCC2_OSCSRC2_Msk;
    SYSCTL->MISC = RIS_PLLLRIS;                 /* clear a stale lock flag */
    SYSCTL->RCC2 &= ~RCC2_PWRDN2;

    /* 3. 400 MHz PLL output divided by 8. */
    SYSCTL->RCC2 |= RCC2_DIV400;
    SYSCTL->RCC2 = (SYSCTL->RCC2 & ~(RCC2_SYSDIV2_Msk | RCC2_SYSDIV2LSB)) | (SYSDIV400_50MHZ << 22);

    /* 4. Wait for the PLL to lock, then 5. switch the system clock to it. */
    while ((SYSCTL->RIS & RIS_PLLLRIS) == 0UL)
    {
    }
    SYSCTL->RCC2 &= ~RCC2_BYPASS2;

    SystemCoreClockUpdate();
}
