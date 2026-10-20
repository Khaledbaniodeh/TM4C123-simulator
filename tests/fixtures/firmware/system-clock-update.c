/*
 * TM4C123 Simulator test fixture — system-clock-update.c
 *
 * Records SystemCoreClock after SystemInit() and after SystemCoreClockUpdate()
 * for several RCC/RCC2 configurations. The test compares each value with the
 * data-sheet result and with the simulator's own system-clock-changed event.
 */
#include "TM4C123.h"

#define RCC2_USERCC2  (1u << 31)
#define RCC2_DIV400   (1u << 30)
#define RCC2_BYPASS2  (1u << 11)
#define RCC_BYPASS    (1u << 11)
#define RCC_PWRDN     (1u << 13)
#define RCC_USESYSDIV (1u << 22)

volatile uint32_t g_results[6];
volatile uint32_t g_done;

int main(void)
{
    g_results[0] = SystemCoreClock;                       /* SystemInit: 50 MHz */

    SYSCTL->RCC2 = (SYSCTL->RCC2 & ~(0x7Fu << 22)) | (4u << 22);
    SystemCoreClockUpdate();
    g_results[1] = SystemCoreClock;                       /* 400 / 5 = 80 MHz */

    SYSCTL->RCC2 = (SYSCTL->RCC2 & ~(RCC2_DIV400 | (0x7Fu << 22))) | (4u << 23);
    SystemCoreClockUpdate();
    g_results[2] = SystemCoreClock;                       /* 200 / 5 = 40 MHz */

    SYSCTL->RCC2 |= RCC2_BYPASS2;
    SystemCoreClockUpdate();
    g_results[3] = SystemCoreClock;                       /* MOSC 16 MHz */

    /* Legacy RCC only: PLL from MOSC, SYSDIV = 9 -> 200 / 10 = 20 MHz. */
    SYSCTL->RCC2 &= ~RCC2_USERCC2;
    SYSCTL->RCC = (SYSCTL->RCC & ~((0xFu << 23) | (3u << 4) | RCC_BYPASS | RCC_PWRDN)) | (9u << 23) | RCC_USESYSDIV;
    SystemCoreClockUpdate();
    g_results[4] = SystemCoreClock;

    /* PIOSC / 4, bypassing the PLL, no divider -> 4 MHz. */
    SYSCTL->RCC = (SYSCTL->RCC & ~((3u << 4) | RCC_USESYSDIV)) | (2u << 4) | RCC_BYPASS;
    SystemCoreClockUpdate();
    g_results[5] = SystemCoreClock;

    g_done = 1u;
    for (;;)
    {
    }
}
