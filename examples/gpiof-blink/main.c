/*
 * TM4C123 Simulator — firmware example C
 *
 * Blink the red LED (PF1) using a software delay loop.
 *
 * Timing note: a busy-wait loop has no fixed duration in seconds. In the
 * simulator its period follows from the number of executed instructions
 * and the configured instruction rate (16 MIPS, approximating the 16 MHz
 * PIOSC default clock at one instruction per cycle). Real silicon adds
 * flash wait states and pipeline effects, so the simulated period is an
 * approximation. Use SysTick or a GPTM timer for precise timing.
 *
 * Writes go through the masked DATA address for PF1 only
 * (0x40025000 + (0x02 << 2) = 0x40025008), so no other Port F pin is
 * touched.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

#define SYSCTL_RCGCGPIO_R REG32(0x400FE608u)
#define SYSCTL_PRGPIO_R   REG32(0x400FEA08u)

#define GPIO_PORTF_DIR_R   REG32(0x40025400u)
#define GPIO_PORTF_DEN_R   REG32(0x4002551Cu)

/* Masked DATA alias: address bits [9:2] select which pins are affected. */
#define GPIO_PORTF_PF1_DATA_R REG32(0x40025000u + (0x02u << 2))

#define PF1_RED_LED (1u << 1)

static void delay(volatile uint32_t count)
{
    while (count-- > 0u)
    {
    }
}

int main(void)
{
    SYSCTL_RCGCGPIO_R |= (1u << 5);
    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u)
    {
    }

    GPIO_PORTF_DIR_R |= PF1_RED_LED;
    GPIO_PORTF_DEN_R |= PF1_RED_LED;

    while (1)
    {
        GPIO_PORTF_PF1_DATA_R ^= PF1_RED_LED;
        delay(100000u);
    }
}
