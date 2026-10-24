/*
 * TM4C123 Simulator — system clock interface (CMSIS-style names).
 *
 * Original project code. Implemented in simulator/firmware/system_TM4C123.c,
 * which the build links only when the firmware includes TM4C123.h or
 * TM4C123GH6PM.h.
 */
#ifndef SYSTEM_TM4C123_H
#define SYSTEM_TM4C123_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Core clock in Hz; updated by SystemInit() and SystemCoreClockUpdate(). */
extern uint32_t SystemCoreClock;

/** Called by the startup code before main(): configures a 50 MHz PLL clock. */
void SystemInit(void);

/** Recomputes SystemCoreClock from the current RCC/RCC2 settings. */
void SystemCoreClockUpdate(void);

#ifdef __cplusplus
}
#endif

#endif /* SYSTEM_TM4C123_H */
